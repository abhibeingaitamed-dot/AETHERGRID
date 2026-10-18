"""Financial, SLA, carbon, and battery lifecycle accounting for AETHERGRID."""

from dataclasses import dataclass, field
from typing import Dict, Mapping, Optional, Tuple

from .physics import PhysicsConfig, PhysicsSnapshot, TierSpec
from .swarm import SwarmSnapshot


@dataclass(frozen=True)
class ImpactConfig:
    catastrophic_outage_benchmark_usd: float = 10_000_000.0
    diesel_carbon_intensity_kg_per_kwh: float = 0.74
    sla_unit_usd: float = 400.0
    battery_nominal_capacity_mwh: float = 400.0
    battery_round_trip_efficiency: float = 0.92
    battery_cycle_life: float = 4_000.0
    battery_end_of_life_soh: float = 0.80

    def __post_init__(self) -> None:
        if self.catastrophic_outage_benchmark_usd < 10_000_000.0:
            raise ValueError("the outage benchmark must be at least $10,000,000")
        if self.diesel_carbon_intensity_kg_per_kwh <= 0:
            raise ValueError("diesel carbon intensity must be positive")
        if self.sla_unit_usd <= 0:
            raise ValueError("sla_unit_usd must be positive")
        if self.battery_nominal_capacity_mwh <= 0:
            raise ValueError("battery capacity must be positive")
        if not 0 < self.battery_round_trip_efficiency <= 1:
            raise ValueError("battery round-trip efficiency must be between zero and one")
        if self.battery_cycle_life <= 0 or not 0 < self.battery_end_of_life_soh <= 1:
            raise ValueError("battery lifecycle parameters must be valid")


@dataclass(frozen=True)
class ImpactSnapshot:
    outage_benchmark_usd: float
    prevented_outages: int
    capital_preserved_usd: float
    active_outage_exposure_usd: float
    avoided_sla_penalties_usd: float
    avoided_sla_by_tier_usd: Mapping[str, float]
    curtailment_cost_usd: float
    avoided_diesel_energy_mwh: float
    avoided_carbon_kg: float
    avoided_carbon_tonnes: float
    diesel_carbon_intensity_kg_per_kwh: float
    battery_round_trip_efficiency_percent: float
    battery_nominal_capacity_mwh: float
    battery_energy_remaining_mwh: float
    battery_energy_delivered_mwh: float
    battery_equivalent_cycles: float
    battery_state_of_health_percent: float
    battery_cycle_life: float
    battery_end_of_life_soh_percent: float
    last_event_avoided_sla_usd: float
    last_event_curtailed_mw: float
    last_event_recovery_ms: Optional[float]
    event_active: bool
    event_converged: bool


class ImpactTelemetryModel:
    """Accumulates auditable session impact from physics and swarm snapshots."""

    def __init__(self, physics_config: Optional[PhysicsConfig] = None, config: Optional[ImpactConfig] = None) -> None:
        self.physics_config = physics_config or PhysicsConfig()
        self.config = config or ImpactConfig()
        self._previous_time_s = 0.0
        self._event_active = False
        self._event_counted = False
        self._event_peak_shed_mw: Dict[str, float] = {tier.name: 0.0 for tier in self.physics_config.tiers}
        self._event_avoided_sla_usd = 0.0
        self._event_curtailment_cost_usd = 0.0
        self._event_recovery_ms: Optional[float] = None
        self._prevented_outages = 0
        self._capital_preserved_usd = 0.0
        self._avoided_sla_penalties_usd = 0.0
        self._avoided_sla_by_tier_usd: Dict[str, float] = {tier.name: 0.0 for tier in self.physics_config.tiers}
        self._curtailment_cost_usd = 0.0
        self._avoided_diesel_energy_mwh = 0.0
        self._avoided_carbon_kg = 0.0
        self._battery_energy_remaining_mwh = self.config.battery_nominal_capacity_mwh
        self._battery_energy_delivered_mwh = 0.0
        self._battery_equivalent_cycles = 0.0

    def observe(self, snapshot: PhysicsSnapshot, swarm: SwarmSnapshot, duration_s: float) -> ImpactSnapshot:
        if duration_s < 0:
            raise ValueError("duration_s must be non-negative")
        self._previous_time_s = snapshot.time_s
        event_active = snapshot.contingency_active
        if event_active and not self._event_active:
            self._event_active = True
            self._event_counted = False
            self._event_peak_shed_mw = {tier.name: 0.0 for tier in self.physics_config.tiers}
            self._event_avoided_sla_usd = 0.0
            self._event_curtailment_cost_usd = 0.0
            self._event_recovery_ms = None

        if event_active:
            for tier in self.physics_config.tiers:
                self._event_peak_shed_mw[tier.name] = max(
                    self._event_peak_shed_mw[tier.name],
                    float(snapshot.tier_shed_mw.get(tier.name, 0.0)),
                )
            battery_delivered_mwh = snapshot.battery_injection_mw * duration_s / 3_600.0
            shed_energy_mwh = snapshot.compute_shed_mw * duration_s / 3_600.0
            self._battery_energy_delivered_mwh += battery_delivered_mwh
            reserve_draw_mwh = battery_delivered_mwh / self.config.battery_round_trip_efficiency
            self._battery_energy_remaining_mwh = max(0.0, self._battery_energy_remaining_mwh - reserve_draw_mwh)
            self._battery_equivalent_cycles += reserve_draw_mwh / self.config.battery_nominal_capacity_mwh
            avoided_diesel_mwh = battery_delivered_mwh + shed_energy_mwh
            self._avoided_diesel_energy_mwh += avoided_diesel_mwh
            self._avoided_carbon_kg += avoided_diesel_mwh * 1_000.0 * self.config.diesel_carbon_intensity_kg_per_kwh

        if swarm.audit.converged and event_active and not self._event_counted:
            self._event_counted = True
            self._prevented_outages += 1
            self._capital_preserved_usd += self.config.catastrophic_outage_benchmark_usd
            self._event_recovery_ms = snapshot.recovery_time_s * 1_000.0 if snapshot.recovery_time_s is not None else None
            for tier in self.physics_config.tiers:
                peak_shed = self._event_peak_shed_mw[tier.name]
                gross_penalty = tier.nominal_power_mw * (tier.sla_penalty_per_mw + tier.checkpoint_cost_per_mw)
                curtailment_cost = tier.cost_for_shed(peak_shed)
                avoided_for_tier = max(0.0, gross_penalty - curtailment_cost) * self.config.sla_unit_usd
                self._avoided_sla_by_tier_usd[tier.name] += avoided_for_tier
                self._event_avoided_sla_usd += avoided_for_tier
                self._event_curtailment_cost_usd += curtailment_cost * self.config.sla_unit_usd
            self._avoided_sla_penalties_usd += self._event_avoided_sla_usd
            self._curtailment_cost_usd += self._event_curtailment_cost_usd

        if not event_active:
            self._event_active = False

        return self.snapshot(snapshot, swarm)

    def reset_active_event(self) -> None:
        """End the active event and recharge the reserve without erasing impact history."""
        self._event_active = False
        self._event_counted = False
        self._event_peak_shed_mw = {tier.name: 0.0 for tier in self.physics_config.tiers}
        self._event_avoided_sla_usd = 0.0
        self._event_curtailment_cost_usd = 0.0
        self._event_recovery_ms = None
        self._battery_energy_remaining_mwh = self.config.battery_nominal_capacity_mwh

    def snapshot(self, physics: PhysicsSnapshot, swarm: SwarmSnapshot) -> ImpactSnapshot:
        state_of_health = max(
            self.config.battery_end_of_life_soh,
            1.0 - (1.0 - self.config.battery_end_of_life_soh)
            * min(1.0, self._battery_equivalent_cycles / self.config.battery_cycle_life),
        )
        exposure = self.config.catastrophic_outage_benchmark_usd if physics.contingency_active and not swarm.audit.converged else 0.0
        return ImpactSnapshot(
            outage_benchmark_usd=self.config.catastrophic_outage_benchmark_usd,
            prevented_outages=self._prevented_outages,
            capital_preserved_usd=self._capital_preserved_usd,
            active_outage_exposure_usd=exposure,
            avoided_sla_penalties_usd=self._avoided_sla_penalties_usd,
            avoided_sla_by_tier_usd=dict(self._avoided_sla_by_tier_usd),
            curtailment_cost_usd=self._curtailment_cost_usd,
            avoided_diesel_energy_mwh=self._avoided_diesel_energy_mwh,
            avoided_carbon_kg=self._avoided_carbon_kg,
            avoided_carbon_tonnes=self._avoided_carbon_kg / 1_000.0,
            diesel_carbon_intensity_kg_per_kwh=self.config.diesel_carbon_intensity_kg_per_kwh,
            battery_round_trip_efficiency_percent=self.config.battery_round_trip_efficiency * 100.0,
            battery_nominal_capacity_mwh=self.config.battery_nominal_capacity_mwh,
            battery_energy_remaining_mwh=self._battery_energy_remaining_mwh,
            battery_energy_delivered_mwh=self._battery_energy_delivered_mwh,
            battery_equivalent_cycles=self._battery_equivalent_cycles,
            battery_state_of_health_percent=state_of_health * 100.0,
            battery_cycle_life=self.config.battery_cycle_life,
            battery_end_of_life_soh_percent=self.config.battery_end_of_life_soh * 100.0,
            last_event_avoided_sla_usd=self._event_avoided_sla_usd,
            last_event_curtailed_mw=sum(self._event_peak_shed_mw.values()),
            last_event_recovery_ms=self._event_recovery_ms,
            event_active=physics.contingency_active,
            event_converged=swarm.audit.converged,
        )
