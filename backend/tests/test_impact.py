import pytest

from backend.app.impact import ImpactConfig
from backend.app.runtime import RuntimeConfig, SimulationRuntime


def test_impact_defaults_are_auditable_and_configurable() -> None:
    config = ImpactConfig()

    assert config.catastrophic_outage_benchmark_usd == 10_000_000.0
    assert config.diesel_carbon_intensity_kg_per_kwh == 0.74
    assert config.battery_round_trip_efficiency == 0.92
    assert config.battery_cycle_life == 4_000.0
    assert config.battery_end_of_life_soh == 0.80
    with pytest.raises(ValueError):
        ImpactConfig(catastrophic_outage_benchmark_usd=9_999_999.0)


def test_prevented_contingency_accumulates_capital_sla_carbon_and_battery_metrics() -> None:
    runtime = SimulationRuntime(
        runtime_config=RuntimeConfig(
            publication_hz=20.0,
            auto_contingency_after_s=0.0,
            auto_contingency_trip_mw=350.0,
        )
    )

    envelope = runtime.step(0.05)
    assert envelope.financial.prevented_outages == 0
    assert envelope.financial.active_outage_exposure_usd == 10_000_000.0
    for _ in range(4):
        envelope = runtime.step(0.05)

    assert envelope.agents.auditor_state == "CONVERGED"
    assert envelope.financial.prevented_outages == 1
    assert envelope.financial.capital_preserved_usd == 10_000_000.0
    assert envelope.financial.avoided_sla_penalties_usd > 0
    assert envelope.financial.last_event_recovery_ms is not None
    assert envelope.financial.last_event_recovery_ms < 300.0
    assert envelope.environmental.avoided_carbon_tonnes > 0
    assert envelope.battery_lifecycle.equivalent_cycles > 0
    assert envelope.battery_lifecycle.state_of_health_percent < 100.0


def test_reset_preserves_session_impact_history_and_restores_live_reserve() -> None:
    runtime = SimulationRuntime(
        runtime_config=RuntimeConfig(
            publication_hz=20.0,
            auto_contingency_after_s=0.0,
            auto_contingency_trip_mw=350.0,
        )
    )
    for _ in range(4):
        runtime.step(0.05)
    before_reset = runtime.latest_envelope

    runtime.reset()
    after_reset = runtime.latest_envelope

    assert after_reset.grid.frequency_hz == 60.0
    assert after_reset.grid.contingency_active is False
    assert after_reset.financial.prevented_outages == before_reset.financial.prevented_outages
    assert after_reset.financial.capital_preserved_usd == before_reset.financial.capital_preserved_usd
    assert after_reset.battery_lifecycle.energy_remaining_mwh == after_reset.battery_lifecycle.nominal_capacity_mwh
