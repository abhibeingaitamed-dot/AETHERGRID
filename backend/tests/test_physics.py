import pytest

from backend.app.physics import MicrogridPhysicsEngine, PhysicsConfig


def test_per_unit_conversion_and_initial_swing_rocof() -> None:
    engine = MicrogridPhysicsEngine()

    assert engine.power_to_per_unit(1_000.0) == 1.0
    assert engine.power_to_per_unit(-350.0) == -0.35
    assert engine.frequency_deviation_per_unit(59.7) == pytest.approx(-0.005)
    assert engine.swing_rocof(-350.0, 60.0) == pytest.approx(-3.0)


def test_engine_integrates_at_one_millisecond_resolution() -> None:
    engine = MicrogridPhysicsEngine()

    snapshot = engine.advance(0.037)

    assert snapshot.time_s == pytest.approx(0.037)
    assert snapshot.frequency_hz == pytest.approx(60.0)
    assert snapshot.rocof_hz_per_second == pytest.approx(0.0)


def test_generator_trip_is_capped_and_fast_response_converges() -> None:
    engine = MicrogridPhysicsEngine()
    applied_trip = engine.apply_generator_trip(500.0)
    engine.apply_control(
        battery_injection_mw=200.0,
        tier_shed_mw={"TIER_1": 20.0, "TIER_2": 50.0, "TIER_3": 80.0},
    )

    assert applied_trip == 350.0
    snapshot = engine.advance(0.30)

    assert snapshot.generator_trip_mw == 350.0
    assert snapshot.battery_injection_mw == 200.0
    assert snapshot.compute_shed_mw == 150.0
    assert snapshot.nadir_hz > 59.70
    assert snapshot.recovery_time_s is not None
    assert snapshot.recovery_time_s < 0.300
    assert abs(snapshot.power_balance_mw) < 1e-9


def test_calibration_constants_are_explicit_and_exact() -> None:
    config = PhysicsConfig()

    assert config.nominal_frequency_hz == 60.0
    assert config.base_capacity_mw == 1_000.0
    assert config.inertia_constant_s == 3.5
    assert config.load_damping_pu_per_hz == 1.5
    assert config.total_gpu_count == 12_000
    assert config.total_compute_max_shed_mw == 150.0
