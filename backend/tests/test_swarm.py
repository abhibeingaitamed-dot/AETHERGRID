from dataclasses import replace

from backend.app.physics import MicrogridPhysicsEngine
from backend.app.swarm import FourAgentSwarm, SentinelAgent


def test_sentinel_thresholds_are_strict_and_actionable() -> None:
    engine = MicrogridPhysicsEngine()
    sentinel = SentinelAgent()
    nominal = engine.snapshot()

    assert not sentinel.observe(replace(nominal, rocof_hz_per_second=-0.15)).alert
    assert sentinel.observe(replace(nominal, rocof_hz_per_second=-0.1501)).rocof_breach
    assert sentinel.observe(replace(nominal, frequency_hz=59.899)).frequency_breach


def test_four_agent_swarm_communicates_a_full_counter_response() -> None:
    engine = MicrogridPhysicsEngine()
    swarm = FourAgentSwarm(engine)
    engine.apply_generator_trip(350.0)

    first = swarm.process(engine.snapshot())
    decision = first.last_decision

    assert decision is not None
    assert decision.battery_injection_mw == 200.0
    assert decision.total_curtailment_mw == 150.0
    assert decision.residual_deficit_mw == 0.0
    assert decision.tier_shed_mw == {"TIER_1": 20.0, "TIER_2": 50.0, "TIER_3": 80.0}
    assert {event.agent for event in first.logs} >= {"SENTINEL", "ARBITER", "DISPATCHER", "AUDITOR"}

    engine.advance(0.30)
    converged = swarm.process(engine.snapshot())

    assert converged.audit.converged
    assert converged.audit.nadir_ok
    assert converged.audit.recovery_ok
    assert tuple(event.sequence for event in swarm.auditor.immutable_event_log) == tuple(
        sorted(event.sequence for event in swarm.auditor.immutable_event_log)
    )


def test_arbiter_minimizes_sla_damage_before_touching_tier_one() -> None:
    engine = MicrogridPhysicsEngine()
    swarm = FourAgentSwarm(engine)
    engine.apply_generator_trip(250.0)

    decision = swarm.arbiter.decide(engine.snapshot())

    assert decision.battery_injection_mw == 200.0
    assert decision.total_curtailment_mw == 50.0
    assert decision.tier_shed_mw["TIER_3"] == 50.0
    assert decision.tier_shed_mw["TIER_2"] == 0.0
    assert decision.tier_shed_mw["TIER_1"] == 0.0
