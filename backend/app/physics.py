"""Deterministic microgrid physics for the AETHERGRID mission deck.

The engine integrates the normalized swing equation at a 1 kHz internal
resolution and exposes a 20 Hz publication cadence to the orchestration layer.
All power values are expressed in MW at the 1,000 MW regional base unless a
method explicitly names per-unit values.
"""

from dataclasses import dataclass, field
import math
from typing import Dict, Iterable, Mapping, Optional, Tuple


@dataclass(frozen=True)
class TierSpec:
    name: str
    gpu_count: int
    nominal_power_mw: float
    max_shed_mw: float
    sla_penalty_per_mw: float
    checkpoint_cost_per_mw: float

    def __post_init__(self) -> None:
        if self.gpu_count <= 0:
            raise ValueError("gpu_count must be positive")
        if self.nominal_power_mw <= 0:
            raise ValueError("nominal_power_mw must be positive")
        if self.max_shed_mw < 0 or self.max_shed_mw > self.nominal_power_mw:
            raise ValueError("max_shed_mw must be within the tier's nominal power")
        if self.sla_penalty_per_mw < 0 or self.checkpoint_cost_per_mw < 0:
            raise ValueError("tier cost coefficients must be non-negative")

    @property
    def mw_per_gpu(self) -> float:
        return self.nominal_power_mw / self.gpu_count


DEFAULT_TIERS: Tuple[TierSpec, ...] = (
    TierSpec(
        name="TIER_1",
        gpu_count=4_000,
        nominal_power_mw=350.0,
        max_shed_mw=20.0,
        sla_penalty_per_mw=38.0,
        checkpoint_cost_per_mw=7.0,
    ),
    TierSpec(
        name="TIER_2",
        gpu_count=5_000,
        nominal_power_mw=300.0,
        max_shed_mw=50.0,
        sla_penalty_per_mw=14.0,
        checkpoint_cost_per_mw=3.0,
    ),
    TierSpec(
        name="TIER_3",
        gpu_count=3_000,
        nominal_power_mw=200.0,
        max_shed_mw=80.0,
        sla_penalty_per_mw=4.0,
        checkpoint_cost_per_mw=1.0,
    ),
)


@dataclass(frozen=True)
class PhysicsConfig:
    nominal_frequency_hz: float = 60.0
    base_capacity_mw: float = 1_000.0
    inertia_constant_s: float = 3.5
    load_damping_pu_per_hz: float = 1.5
    regional_static_load_mw: float = 150.0
    max_generator_trip_mw: float = 350.0
    max_battery_injection_mw: float = 200.0
    battery_response_delay_s: float = 0.005
    dvfs_response_window_s: float = 0.080
    internal_step_s: float = 0.001
    publication_hz: float = 20.0
    recovery_threshold_hz: float = 59.99
    recovery_rocof_threshold_hz_per_second: float = 0.15
    recovery_balance_tolerance_mw: float = 0.1
    tiers: Tuple[TierSpec, ...] = DEFAULT_TIERS

    def __post_init__(self) -> None:
        if self.nominal_frequency_hz <= 0:
            raise ValueError("nominal_frequency_hz must be positive")
        if self.base_capacity_mw <= 0:
            raise ValueError("base_capacity_mw must be positive")
        if self.inertia_constant_s <= 0:
            raise ValueError("inertia_constant_s must be positive")
        if self.load_damping_pu_per_hz < 0:
            raise ValueError("load_damping_pu_per_hz must be non-negative")
        if self.max_generator_trip_mw <= 0 or self.max_battery_injection_mw <= 0:
            raise ValueError("contingency and battery limits must be positive")
        if self.battery_response_delay_s < 0 or self.dvfs_response_window_s <= 0:
            raise ValueError("response times must be valid")
        if self.recovery_rocof_threshold_hz_per_second <= 0 or self.recovery_balance_tolerance_mw < 0:
            raise ValueError("recovery convergence limits must be valid")
        if self.internal_step_s <= 0 or self.publication_hz <= 0:
            raise ValueError("integration and publication rates must be positive")
        if not self.tiers:
            raise ValueError("at least one compute tier is required")
        if sum(tier.gpu_count for tier in self.tiers) != 12_000:
            raise ValueError("the calibrated compute cluster must contain exactly 12,000 GPUs")
        if sum(tier.max_shed_mw for tier in self.tiers) != 150.0:
            raise ValueError("the calibrated compute cluster must shed exactly 150 MW at maximum")

    @property
    def total_gpu_count(self) -> int:
        return sum(tier.gpu_count for tier in self.tiers)

    @property
    def total_compute_nominal_mw(self) -> float:
        return sum(tier.nominal_power_mw for tier in self.tiers)

    @property
    def total_compute_max_shed_mw(self) -> float:
        return sum(tier.max_shed_mw for tier in self.tiers)

    @property
    def initial_demand_mw(self) -> float:
        return self.regional_static_load_mw + self.total_compute_nominal_mw


@dataclass(frozen=True)
class PhysicsSnapshot:
    time_s: float
    frequency_hz: float
    frequency_deviation_hz: float
    rocof_hz_per_second: float
    generation_mw: float
    demand_mw: float
    compute_load_mw: float
    compute_shed_mw: float
    battery_injection_mw: float
    power_balance_mw: float
    generator_trip_mw: float
    voltage_kv: float
    thermal_celsius: float
    coolant_celsius: float
    nadir_hz: float
    recovery_time_s: Optional[float]
    contingency_active: bool
    tier_shed_mw: Mapping[str, float] = field(default_factory=dict)
    throttled_gpu_count: int = 0


@dataclass
class _ControlState:
    battery_target_mw: float = 0.0
    battery_current_mw: float = 0.0
    battery_apply_at_s: float = math.inf
    tier_targets_mw: Dict[str, float] = field(default_factory=dict)
    tier_current_mw: Dict[str, float] = field(default_factory=dict)


class MicrogridPhysicsEngine:
    """Numerically integrates the calibrated AETHERGRID microgrid.

    The normalized swing equation used for each internal step is:

        df/dt = f_nominal / (2H) * (DeltaP_pu - D * Deltaf_hz)

    where ``D`` is the configured frequency-dependent load damping in pu/Hz.
    A fourth-order Runge-Kutta step keeps the one millisecond loop stable while
    controls are ramping into the model.
    """

    def __init__(self, config: Optional[PhysicsConfig] = None) -> None:
        self.config = config or PhysicsConfig()
        self._tier_by_name = {tier.name: tier for tier in self.config.tiers}
        self._control = _ControlState(
            tier_targets_mw={tier.name: 0.0 for tier in self.config.tiers},
            tier_current_mw={tier.name: 0.0 for tier in self.config.tiers},
        )
        self.reset()

    def reset(self) -> None:
        self._time_s = 0.0
        self._frequency_hz = self.config.nominal_frequency_hz
        self._rocof_hz_per_second = 0.0
        self._generator_trip_mw = 0.0
        self._contingency_started_at_s: Optional[float] = None
        self._recovery_time_s: Optional[float] = None
        self._frequency_below_recovery_threshold = False
        self._nadir_hz = self.config.nominal_frequency_hz
        self._control.battery_target_mw = 0.0
        self._control.battery_current_mw = 0.0
        self._control.battery_apply_at_s = math.inf
        for tier in self.config.tiers:
            self._control.tier_targets_mw[tier.name] = 0.0
            self._control.tier_current_mw[tier.name] = 0.0

    def power_to_per_unit(self, power_mw: float) -> float:
        return power_mw / self.config.base_capacity_mw

    def frequency_deviation_per_unit(self, frequency_hz: float) -> float:
        return (frequency_hz - self.config.nominal_frequency_hz) / self.config.nominal_frequency_hz

    def swing_rocof(self, power_balance_mw: float, frequency_hz: Optional[float] = None) -> float:
        frequency = self._frequency_hz if frequency_hz is None else frequency_hz
        delta_frequency_hz = frequency - self.config.nominal_frequency_hz
        imbalance_pu = self.power_to_per_unit(power_balance_mw)
        return (self.config.nominal_frequency_hz / (2.0 * self.config.inertia_constant_s)) * (
            imbalance_pu - self.config.load_damping_pu_per_hz * delta_frequency_hz
        )

    def apply_generator_trip(self, trip_mw: float) -> float:
        requested_trip = max(0.0, trip_mw)
        applied_trip = min(requested_trip, self.config.max_generator_trip_mw)
        if applied_trip > 0 and self._generator_trip_mw == 0:
            self._contingency_started_at_s = self._time_s
            self._recovery_time_s = None
            self._nadir_hz = self._frequency_hz
        self._generator_trip_mw = applied_trip
        self._rocof_hz_per_second = self.swing_rocof(self._current_power_balance_mw())
        return applied_trip

    def clear_generator_trip(self) -> None:
        self._generator_trip_mw = 0.0
        self._rocof_hz_per_second = self.swing_rocof(self._current_power_balance_mw())

    def apply_control(self, battery_injection_mw: float, tier_shed_mw: Mapping[str, float]) -> None:
        self._control.battery_target_mw = min(max(0.0, battery_injection_mw), self.config.max_battery_injection_mw)
        self._control.battery_apply_at_s = self._time_s + self.config.battery_response_delay_s
        for tier in self.config.tiers:
            requested = float(tier_shed_mw.get(tier.name, 0.0))
            self._control.tier_targets_mw[tier.name] = min(max(0.0, requested), tier.max_shed_mw)

    def advance(self, duration_s: float) -> PhysicsSnapshot:
        if duration_s < 0:
            raise ValueError("duration_s must be non-negative")
        remaining = duration_s
        while remaining > 1e-12:
            step_s = min(self.config.internal_step_s, remaining)
            self._advance_internal(step_s)
            remaining -= step_s
        return self.snapshot()

    def snapshot(self) -> PhysicsSnapshot:
        tier_shed = dict(self._control.tier_current_mw)
        compute_shed = sum(tier_shed.values())
        compute_load = self.config.total_compute_nominal_mw - compute_shed
        generation = self.config.base_capacity_mw - self._generator_trip_mw
        demand = self.config.regional_static_load_mw + compute_load
        power_balance = generation + self._control.battery_current_mw - demand
        throttled_gpus = 0
        for tier in self.config.tiers:
            fraction = tier_shed[tier.name] / tier.nominal_power_mw
            throttled_gpus += round(tier.gpu_count * fraction)
        load_ratio = compute_load / self.config.total_compute_nominal_mw
        voltage = 345.0 - abs(power_balance) / self.config.base_capacity_mw * 13.0
        thermal = 53.0 + load_ratio * 32.0 + min(abs(self._rocof_hz_per_second) * 0.35, 5.0)
        coolant = 17.0 + load_ratio * 8.0
        return PhysicsSnapshot(
            time_s=self._time_s,
            frequency_hz=self._frequency_hz,
            frequency_deviation_hz=self._frequency_hz - self.config.nominal_frequency_hz,
            rocof_hz_per_second=self._rocof_hz_per_second,
            generation_mw=generation,
            demand_mw=demand,
            compute_load_mw=compute_load,
            compute_shed_mw=compute_shed,
            battery_injection_mw=self._control.battery_current_mw,
            power_balance_mw=power_balance,
            generator_trip_mw=self._generator_trip_mw,
            voltage_kv=voltage,
            thermal_celsius=thermal,
            coolant_celsius=coolant,
            nadir_hz=self._nadir_hz,
            recovery_time_s=self._recovery_time_s,
            contingency_active=self._generator_trip_mw > 0,
            tier_shed_mw=tier_shed,
            throttled_gpu_count=throttled_gpus,
        )

    def _advance_internal(self, step_s: float) -> None:
        self._advance_controls()
        balance = self.snapshot().power_balance_mw
        current_frequency = self._frequency_hz

        k1 = self.swing_rocof(balance, current_frequency)
        k2 = self.swing_rocof(balance, current_frequency + step_s * 0.5 * k1)
        k3 = self.swing_rocof(balance, current_frequency + step_s * 0.5 * k2)
        k4 = self.swing_rocof(balance, current_frequency + step_s * k3)
        self._frequency_hz += step_s * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0
        self._rocof_hz_per_second = self.swing_rocof(balance, self._frequency_hz)
        self._time_s += step_s
        self._nadir_hz = min(self._nadir_hz, self._frequency_hz)

        if self._frequency_hz < self.config.recovery_threshold_hz:
            self._frequency_below_recovery_threshold = True

        if (
            self._contingency_started_at_s is not None
            and self._recovery_time_s is None
            and self._time_s > self._contingency_started_at_s
            and (
                (
                    self._frequency_below_recovery_threshold
                    and self._frequency_hz >= self.config.recovery_threshold_hz
                    and abs(self._rocof_hz_per_second) < self.config.recovery_rocof_threshold_hz_per_second
                    and abs(self._current_power_balance_mw()) <= self.config.recovery_balance_tolerance_mw
                )
                or (
                    not self._frequency_below_recovery_threshold
                    and self._time_s - self._contingency_started_at_s >= self.config.dvfs_response_window_s
                    and abs(self._rocof_hz_per_second) < self.config.recovery_rocof_threshold_hz_per_second
                    and abs(self._current_power_balance_mw()) <= self.config.recovery_balance_tolerance_mw
                )
            )
        ):
            self._recovery_time_s = self._time_s - self._contingency_started_at_s

    def _advance_controls(self) -> None:
        if self._time_s >= self._control.battery_apply_at_s:
            self._control.battery_current_mw = self._control.battery_target_mw
        ramp_limit = self.config.internal_step_s / self.config.dvfs_response_window_s
        for tier in self.config.tiers:
            current = self._control.tier_current_mw[tier.name]
            target = self._control.tier_targets_mw[tier.name]
            change = target - current
            if abs(change) <= tier.max_shed_mw * ramp_limit:
                self._control.tier_current_mw[tier.name] = target
            else:
                self._control.tier_current_mw[tier.name] = current + math.copysign(tier.max_shed_mw * ramp_limit, change)

    def _current_power_balance_mw(self) -> float:
        compute_shed = sum(self._control.tier_current_mw.values())
        compute_load = self.config.total_compute_nominal_mw - compute_shed
        generation = self.config.base_capacity_mw - self._generator_trip_mw
        demand = self.config.regional_static_load_mw + compute_load
        return generation + self._control.battery_current_mw - demand


def iter_tiers(config: PhysicsConfig) -> Iterable[TierSpec]:
    return config.tiers
