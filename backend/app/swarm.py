"""The in-process four-agent AETHERGRID frequency-response swarm."""

from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional, Tuple

from .physics import MicrogridPhysicsEngine, PhysicsSnapshot, TierSpec


@dataclass(frozen=True)
class AgentLog:
    sequence: int
    time_s: float
    agent: str
    level: str
    message: str


@dataclass(frozen=True)
class SentinelAssessment:
    alert: bool
    frequency_breach: bool
    rocof_breach: bool
    reason: str


@dataclass(frozen=True)
class CurtailmentDecision:
    battery_injection_mw: float
    total_curtailment_mw: float
    tier_shed_mw: Mapping[str, float]
    residual_deficit_mw: float
    estimated_cost: float
    rationale: str


@dataclass(frozen=True)
class DispatchReceipt:
    battery_injection_mw: float
    tier_shed_mw: Mapping[str, float]
    requested_at_s: float
    dvfs_deadline_s: float
    inverter_latency_ms: float


@dataclass(frozen=True)
class AuditAssessment:
    status: str
    nadir_ok: bool
    recovery_ok: bool
    converged: bool
    detail: str


@dataclass(frozen=True)
class SwarmSnapshot:
    sentinel_state: str
    arbiter_state: str
    dispatcher_state: str
    auditor_state: str
    last_decision: Optional[CurtailmentDecision]
    last_dispatch: Optional[DispatchReceipt]
    audit: AuditAssessment
    logs: Tuple[AgentLog, ...]


class SentinelAgent:
    name = "SENTINEL"

    def __init__(self, frequency_threshold_hz: float = 59.9, rocof_threshold_hz_per_second: float = -0.15) -> None:
        self.frequency_threshold_hz = frequency_threshold_hz
        self.rocof_threshold_hz_per_second = rocof_threshold_hz_per_second
        self.alert_latched = False
        self.state = "MONITORING"

    def observe(self, snapshot: PhysicsSnapshot) -> SentinelAssessment:
        frequency_breach = snapshot.frequency_hz < self.frequency_threshold_hz
        rocof_breach = snapshot.rocof_hz_per_second < self.rocof_threshold_hz_per_second
        alert = frequency_breach or rocof_breach
        if alert:
            self.state = "ALERT"
            self.alert_latched = True
        else:
            self.state = "MONITORING"
            self.alert_latched = False
        reasons = []
        if frequency_breach:
            reasons.append(f"frequency {snapshot.frequency_hz:.5f} Hz < {self.frequency_threshold_hz:.2f} Hz")
        if rocof_breach:
            reasons.append(f"RoCoF {snapshot.rocof_hz_per_second:.5f} Hz/s < {self.rocof_threshold_hz_per_second:.2f} Hz/s")
        return SentinelAssessment(alert, frequency_breach, rocof_breach, "; ".join(reasons) or "frequency envelope nominal")

    def reset(self) -> None:
        self.alert_latched = False
        self.state = "MONITORING"


class ArbiterAgent:
    name = "ARBITER"

    def __init__(self, tier_specs: Tuple[TierSpec, ...], max_battery_injection_mw: float = 200.0) -> None:
        self.tier_specs = tier_specs
        self.max_battery_injection_mw = max_battery_injection_mw
        self.state = "STANDBY"
        self.last_decision: Optional[CurtailmentDecision] = None

    def decide(self, snapshot: PhysicsSnapshot) -> CurtailmentDecision:
        deficit_mw = max(0.0, -snapshot.power_balance_mw)
        battery_mw = min(deficit_mw, self.max_battery_injection_mw)
        remaining_mw = max(0.0, deficit_mw - battery_mw)
        allocation: Dict[str, float] = {tier.name: 0.0 for tier in self.tier_specs}

        # Lower blended financial and checkpoint cost tiers are curtailed first.
        ranked_tiers = sorted(
            self.tier_specs,
            key=lambda tier: tier.sla_penalty_per_mw + tier.checkpoint_cost_per_mw,
        )
        estimated_cost = 0.0
        for tier in ranked_tiers:
            amount = min(remaining_mw, tier.max_shed_mw)
            allocation[tier.name] = amount
            remaining_mw -= amount
            estimated_cost += tier.cost_for_shed(amount)
            if remaining_mw <= 1e-9:
                break

        total_curtailment = sum(allocation.values())
        self.state = "DELIBERATING" if deficit_mw > 0 else "STANDBY"
        rationale = (
            f"deficit={deficit_mw:.3f} MW; inverter={battery_mw:.3f} MW; "
            f"DVFS={total_curtailment:.3f} MW; residual={remaining_mw:.3f} MW"
        )
        self.last_decision = CurtailmentDecision(
            battery_injection_mw=battery_mw,
            total_curtailment_mw=total_curtailment,
            tier_shed_mw=allocation,
            residual_deficit_mw=remaining_mw,
            estimated_cost=estimated_cost,
            rationale=rationale,
        )
        if deficit_mw > 0:
            self.state = "COMMITTED" if remaining_mw <= 1e-9 else "CONSTRAINED"
        return self.last_decision

    def reset(self) -> None:
        self.state = "STANDBY"
        self.last_decision = None


class DispatcherAgent:
    name = "DISPATCHER"

    def __init__(self) -> None:
        self.state = "STANDBY"
        self.last_dispatch: Optional[DispatchReceipt] = None

    def dispatch(self, engine: MicrogridPhysicsEngine, decision: CurtailmentDecision) -> DispatchReceipt:
        engine.apply_control(decision.battery_injection_mw, decision.tier_shed_mw)
        requested_at = engine.snapshot().time_s
        receipt = DispatchReceipt(
            battery_injection_mw=decision.battery_injection_mw,
            tier_shed_mw=dict(decision.tier_shed_mw),
            requested_at_s=requested_at,
            dvfs_deadline_s=requested_at + engine.config.dvfs_response_window_s,
            inverter_latency_ms=engine.config.battery_response_delay_s * 1_000.0,
        )
        self.last_dispatch = receipt
        self.state = "EXECUTING"
        return receipt

    def update(self, snapshot: PhysicsSnapshot) -> None:
        if self.last_dispatch is None:
            self.state = "STANDBY"
            return
        if snapshot.compute_shed_mw + 1e-6 >= sum(self.last_dispatch.tier_shed_mw.values()):
            self.state = "HOLDING"
        else:
            self.state = "EXECUTING"

    def reset(self) -> None:
        self.state = "STANDBY"
        self.last_dispatch = None


class AuditorAgent:
    name = "AUDITOR"

    def __init__(self) -> None:
        self.state = "MONITORING"
        self._event_sequence = 0
        self._events: List[AgentLog] = []
        self._last_status = "MONITORING"
        self._contingency_started_s: Optional[float] = None

    @property
    def immutable_event_log(self) -> Tuple[AgentLog, ...]:
        return tuple(self._events)

    def record(self, time_s: float, agent: str, level: str, message: str) -> AgentLog:
        self._event_sequence += 1
        event = AgentLog(self._event_sequence, time_s, agent, level, message)
        self._events.append(event)
        return event

    def assess(self, snapshot: PhysicsSnapshot) -> AuditAssessment:
        nadir_ok = snapshot.nadir_hz > 59.70
        if snapshot.contingency_active and self._contingency_started_s is None:
            self._contingency_started_s = snapshot.time_s
        if not snapshot.contingency_active:
            self._contingency_started_s = None
            assessment = AuditAssessment("MONITORING", True, True, True, "no active contingency")
        elif snapshot.recovery_time_s is not None:
            recovery_ok = snapshot.recovery_time_s < 0.300
            assessment = AuditAssessment(
                "CONVERGED" if nadir_ok and recovery_ok else "VIOLATION",
                nadir_ok,
                recovery_ok,
                nadir_ok and recovery_ok,
                f"nadir={snapshot.nadir_hz:.5f} Hz; recovery={snapshot.recovery_time_s:.3f} s",
            )
        elif self._contingency_started_s is not None and snapshot.time_s - self._contingency_started_s >= 0.300:
            # A missing recovery timestamp after the hard response budget is a fault.
            assessment = AuditAssessment("VIOLATION", nadir_ok, False, False, "recovery deadline exceeded")
        else:
            assessment = AuditAssessment("ASSESSING", nadir_ok, False, False, "awaiting physical convergence")

        self.state = assessment.status
        if assessment.status != self._last_status:
            self.record(snapshot.time_s, self.name, "INFO" if assessment.converged else "WARN", assessment.detail)
            self._last_status = assessment.status
        return assessment

    def reset(self) -> None:
        self.state = "MONITORING"
        self._event_sequence = 0
        self._events.clear()
        self._last_status = "MONITORING"
        self._contingency_started_s = None


class FourAgentSwarm:
    """Coordinates the four agents without network hops or shared mutable queues."""

    def __init__(self, engine: MicrogridPhysicsEngine) -> None:
        self.engine = engine
        self.sentinel = SentinelAgent()
        self.arbiter = ArbiterAgent(engine.config.tiers, engine.config.max_battery_injection_mw)
        self.dispatcher = DispatcherAgent()
        self.auditor = AuditorAgent()
        self._logs_since_last_step: List[AgentLog] = []
        self._last_decision: Optional[CurtailmentDecision] = None
        self._last_dispatch: Optional[DispatchReceipt] = None

    def process(self, snapshot: PhysicsSnapshot) -> SwarmSnapshot:
        self._logs_since_last_step = []
        previous_alert = self.sentinel.alert_latched
        event_count_before_audit = len(self.auditor.immutable_event_log)
        sentinel = self.sentinel.observe(snapshot)
        if sentinel.alert and not previous_alert:
            self._logs_since_last_step.append(self.auditor.record(snapshot.time_s, self.sentinel.name, "ALERT", sentinel.reason))
        if sentinel.alert and not previous_alert:
            decision = self.arbiter.decide(snapshot)
            self._last_decision = decision
            self._logs_since_last_step.append(
                self.auditor.record(snapshot.time_s, self.arbiter.name, "DECISION", decision.rationale)
            )
            self._last_dispatch = self.dispatcher.dispatch(self.engine, decision)
            self._logs_since_last_step.append(
                self.auditor.record(
                    snapshot.time_s,
                    self.dispatcher.name,
                    "ACTION",
                    f"battery={decision.battery_injection_mw:.3f} MW; DVFS={decision.total_curtailment_mw:.3f} MW",
                )
            )
        self.dispatcher.update(snapshot)
        audit = self.auditor.assess(snapshot)
        self._logs_since_last_step.extend(self.auditor.immutable_event_log[event_count_before_audit:])
        unique_logs: List[AgentLog] = []
        seen = set()
        for event in self._logs_since_last_step:
            if event.sequence not in seen:
                unique_logs.append(event)
                seen.add(event.sequence)
        return SwarmSnapshot(
            sentinel_state=self.sentinel.state,
            arbiter_state=self.arbiter.state,
            dispatcher_state=self.dispatcher.state,
            auditor_state=self.auditor.state,
            last_decision=self._last_decision,
            last_dispatch=self._last_dispatch,
            audit=audit,
            logs=tuple(unique_logs),
        )

    def reset(self) -> None:
        self.sentinel.reset()
        self.arbiter.reset()
        self.dispatcher.reset()
        self.auditor.reset()
        self._logs_since_last_step = []
        self._last_decision = None
        self._last_dispatch = None
