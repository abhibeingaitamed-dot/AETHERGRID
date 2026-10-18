"""Async 20 Hz telemetry runtime and WebSocket-facing simulation adapter."""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Set, Tuple

from pydantic import ValidationError

from .contracts import (
    AgentLogTelemetry,
    AgentTelemetry,
    BatteryTelemetry,
    BatteryLifecycleTelemetry,
    CommandAck,
    CommandEnvelope,
    ComputeTelemetry,
    EnvironmentalTelemetry,
    FinancialTelemetry,
    GridTelemetry,
    TelemetryEnvelope,
    TierTelemetry,
)
from .physics import MicrogridPhysicsEngine, PhysicsConfig, PhysicsSnapshot
from .impact import ImpactConfig, ImpactSnapshot, ImpactTelemetryModel
from .swarm import FourAgentSwarm, SwarmSnapshot


@dataclass(frozen=True)
class RuntimeConfig:
    publication_hz: float = 20.0
    auto_contingency_after_s: Optional[float] = 3.0
    auto_contingency_trip_mw: float = 320.0
    transformer_overload_mw: float = 240.0
    renewable_drop_mw: float = 260.0


class SimulationRuntime:
    def __init__(
        self,
        physics_config: Optional[PhysicsConfig] = None,
        runtime_config: Optional[RuntimeConfig] = None,
        impact_config: Optional[ImpactConfig] = None,
    ) -> None:
        self.physics_config = physics_config or PhysicsConfig()
        self.runtime_config = runtime_config or RuntimeConfig(publication_hz=self.physics_config.publication_hz)
        self.engine = MicrogridPhysicsEngine(self.physics_config)
        self.swarm = FourAgentSwarm(self.engine)
        self.impact = ImpactTelemetryModel(self.physics_config, impact_config)
        self._sequence = 0
        self._last_event_sequence = 0
        self._auto_contingency_triggered = False
        self._subscribers: Set[asyncio.Queue] = set()
        self._task: Optional[asyncio.Task] = None
        self._last_swarm = self.swarm.process(self.engine.snapshot())
        self._last_impact = self.impact.observe(self.engine.snapshot(), self._last_swarm, 0.0)
        self._last_envelope = self._build_envelope(self.engine.snapshot(), self._last_swarm, self._last_impact, ())

    @property
    def latest_envelope(self) -> TelemetryEnvelope:
        return self._last_envelope

    def step(self, duration_s: Optional[float] = None) -> TelemetryEnvelope:
        step_s = duration_s or 1.0 / self.runtime_config.publication_hz
        if (
            not self._auto_contingency_triggered
            and self.runtime_config.auto_contingency_after_s is not None
            and self.engine.snapshot().time_s >= self.runtime_config.auto_contingency_after_s
        ):
            self.engine.apply_generator_trip(self.runtime_config.auto_contingency_trip_mw)
            self._auto_contingency_triggered = True

        before = self.engine.snapshot()
        self.swarm.process(before)
        self.engine.advance(step_s)
        after = self.engine.snapshot()
        swarm_state = self.swarm.process(after)
        events = tuple(
            event for event in self.swarm.auditor.immutable_event_log if event.sequence > self._last_event_sequence
        )
        if events:
            self._last_event_sequence = events[-1].sequence
        self._last_swarm = swarm_state
        self._last_impact = self.impact.observe(after, swarm_state, step_s)
        self._sequence += 1
        self._last_envelope = self._build_envelope(after, swarm_state, self._last_impact, events)
        return self._last_envelope

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="aethergrid-physics-20hz")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._subscribers.add(queue)
        queue.put_nowait(self._last_envelope)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    async def handle_command(self, raw_command: object) -> CommandAck:
        try:
            command = CommandEnvelope.model_validate(raw_command)
        except ValidationError as error:
            return CommandAck(
                type="ack",
                command="invalid",
                request_id=None,
                accepted=False,
                message=f"invalid command: {error.errors()[0]['msg']}",
            )

        if command.type == "ping":
            return CommandAck(type="ack", command="ping", request_id=command.request_id, accepted=True, message="telemetry bridge alive")
        if command.type == "reset":
            self.reset()
            return CommandAck(type="ack", command="reset", request_id=command.request_id, accepted=True, message="physics engine and swarm reset")

        if command.type == "transformer_overload":
            overload_mw = command.overload_mw if command.overload_mw is not None else self.runtime_config.transformer_overload_mw
            applied = self.engine.apply_transformer_overload(overload_mw)
            self._auto_contingency_triggered = True
            return CommandAck(
                type="ack",
                command="transformer_overload",
                request_id=command.request_id,
                accepted=True,
                message=f"transformer overload armed at {applied:.3f} MW derating",
            )

        if command.type == "renewable_drop":
            drop_mw = command.drop_mw if command.drop_mw is not None else self.runtime_config.renewable_drop_mw
            applied = self.engine.apply_renewable_drop(drop_mw)
            self._auto_contingency_triggered = True
            return CommandAck(
                type="ack",
                command="renewable_drop",
                request_id=command.request_id,
                accepted=True,
                message=f"renewable drop armed at {applied:.3f} MW loss",
            )

        trip_mw = command.trip_mw if command.trip_mw is not None else self.runtime_config.auto_contingency_trip_mw
        applied = self.engine.apply_generator_trip(trip_mw)
        self._auto_contingency_triggered = True
        return CommandAck(
            type="ack",
            command="contingency",
            request_id=command.request_id,
            accepted=True,
            message=f"generator trip armed at {applied:.3f} MW",
        )

    def reset(self) -> None:
        self.engine.reset()
        self.swarm.reset()
        self.impact.reset_active_event()
        self._sequence = 0
        self._last_event_sequence = 0
        self._auto_contingency_triggered = False
        self._last_swarm = self.swarm.process(self.engine.snapshot())
        self._last_impact = self.impact.observe(self.engine.snapshot(), self._last_swarm, 0.0)
        self._last_envelope = self._build_envelope(self.engine.snapshot(), self._last_swarm, self._last_impact, ())

    async def _run(self) -> None:
        period_s = 1.0 / self.runtime_config.publication_hz
        next_tick = asyncio.get_running_loop().time()
        while True:
            next_tick += period_s
            envelope = self.step(period_s)
            for queue in tuple(self._subscribers):
                while queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                try:
                    queue.put_nowait(envelope)
                except asyncio.QueueFull:
                    pass
            await asyncio.sleep(max(0.0, next_tick - asyncio.get_running_loop().time()))

    def _build_envelope(
        self,
        snapshot: PhysicsSnapshot,
        swarm_state: SwarmSnapshot,
        impact: ImpactSnapshot,
        events: Tuple[object, ...],
    ) -> TelemetryEnvelope:
        tiers = []
        for tier in self.physics_config.tiers:
            shed_mw = float(snapshot.tier_shed_mw.get(tier.name, 0.0))
            throttled = round(tier.gpu_count * shed_mw / tier.nominal_power_mw)
            tiers.append(
                TierTelemetry(
                    name=tier.name,
                    gpu_count=tier.gpu_count,
                    nominal_power_mw=tier.nominal_power_mw,
                    shed_mw=shed_mw,
                    throttled_gpu_count=throttled,
                )
            )
        event_models = [
            AgentLogTelemetry(
                sequence=event.sequence,
                time_s=event.time_s,
                agent=event.agent,
                level=event.level,
                message=event.message,
            )
            for event in events
        ]
        decision = swarm_state.last_decision
        return TelemetryEnvelope(
            type="telemetry",
            sequence=max(1, self._sequence),
            timestamp_utc=datetime.now(timezone.utc),
            simulation_time_ms=round(snapshot.time_s * 1_000.0),
            stream_hz=self.runtime_config.publication_hz,
            grid=GridTelemetry(
                frequency_hz=snapshot.frequency_hz,
                frequency_deviation_hz=snapshot.frequency_deviation_hz,
                rocof_hz_per_second=snapshot.rocof_hz_per_second,
                nominal_frequency_hz=self.physics_config.nominal_frequency_hz,
                generation_mw=snapshot.generation_mw,
                demand_mw=snapshot.demand_mw,
                balance_mw=snapshot.power_balance_mw,
                voltage_kv=snapshot.voltage_kv,
                generator_trip_mw=snapshot.generator_trip_mw,
                transformer_overload_mw=snapshot.transformer_overload_mw,
                renewable_drop_mw=snapshot.renewable_drop_mw,
                nadir_hz=snapshot.nadir_hz,
                transformer_temperature_celsius=snapshot.transformer_temperature_celsius,
                base_capacity_mw=self.physics_config.base_capacity_mw,
                inertia_constant_s=self.physics_config.inertia_constant_s,
                load_damping_pu_per_hz=self.physics_config.load_damping_pu_per_hz,
                contingency_active=snapshot.contingency_active,
            ),
            compute=ComputeTelemetry(
                total_gpu_count=self.physics_config.total_gpu_count,
                active_gpu_count=self.physics_config.total_gpu_count - snapshot.throttled_gpu_count,
                cluster_nominal_power_mw=self.physics_config.total_compute_nominal_mw,
                cluster_power_mw=snapshot.compute_load_mw,
                shed_mw=snapshot.compute_shed_mw,
                throttled_gpu_count=snapshot.throttled_gpu_count,
                thermal_celsius=snapshot.thermal_celsius,
                coolant_celsius=snapshot.coolant_celsius,
                tiers=tiers,
            ),
            battery=BatteryTelemetry(
                injection_mw=snapshot.battery_injection_mw,
                max_injection_mw=self.physics_config.max_battery_injection_mw,
                inverter_latency_ms=self.physics_config.battery_response_delay_s * 1_000.0,
                response_mode="SUB_CYCLE" if snapshot.battery_injection_mw > 0 else "STANDBY",
            ),
            agents=AgentTelemetry(
                sentinel_state=swarm_state.sentinel_state,
                arbiter_state=swarm_state.arbiter_state,
                dispatcher_state=swarm_state.dispatcher_state,
                auditor_state=swarm_state.auditor_state,
                sentinel_alert=swarm_state.sentinel_state == "ALERT",
                last_battery_dispatch_mw=decision.battery_injection_mw if decision else 0.0,
                last_compute_curtailment_mw=decision.total_curtailment_mw if decision else 0.0,
                auditor_nadir_ok=swarm_state.audit.nadir_ok,
                auditor_recovery_ok=swarm_state.audit.recovery_ok,
                auditor_detail=swarm_state.audit.detail,
            ),
            financial=FinancialTelemetry(
                outage_benchmark_usd=impact.outage_benchmark_usd,
                prevented_outages=impact.prevented_outages,
                capital_preserved_usd=impact.capital_preserved_usd,
                active_outage_exposure_usd=impact.active_outage_exposure_usd,
                avoided_sla_penalties_usd=impact.avoided_sla_penalties_usd,
                avoided_sla_by_tier_usd=dict(impact.avoided_sla_by_tier_usd),
                curtailment_cost_usd=impact.curtailment_cost_usd,
                last_event_avoided_sla_usd=impact.last_event_avoided_sla_usd,
                last_event_curtailed_mw=impact.last_event_curtailed_mw,
                last_event_recovery_ms=impact.last_event_recovery_ms,
            ),
            environmental=EnvironmentalTelemetry(
                avoided_diesel_energy_mwh=impact.avoided_diesel_energy_mwh,
                avoided_carbon_kg=impact.avoided_carbon_kg,
                avoided_carbon_tonnes=impact.avoided_carbon_tonnes,
                diesel_carbon_intensity_kg_per_kwh=impact.diesel_carbon_intensity_kg_per_kwh,
            ),
            battery_lifecycle=BatteryLifecycleTelemetry(
                round_trip_efficiency_percent=impact.battery_round_trip_efficiency_percent,
                nominal_capacity_mwh=impact.battery_nominal_capacity_mwh,
                energy_remaining_mwh=impact.battery_energy_remaining_mwh,
                energy_delivered_mwh=impact.battery_energy_delivered_mwh,
                equivalent_cycles=impact.battery_equivalent_cycles,
                state_of_health_percent=impact.battery_state_of_health_percent,
                cycle_life=impact.battery_cycle_life,
                end_of_life_soh_percent=impact.battery_end_of_life_soh_percent,
            ),
            events=event_models,
        )
