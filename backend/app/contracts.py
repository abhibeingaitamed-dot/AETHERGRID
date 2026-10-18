from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class TierTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    gpu_count: int = Field(gt=0)
    nominal_power_mw: float = Field(ge=0)
    shed_mw: float = Field(ge=0)
    throttled_gpu_count: int = Field(ge=0)


class GridTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency_hz: float
    frequency_deviation_hz: float
    rocof_hz_per_second: float
    nominal_frequency_hz: float
    generation_mw: float
    demand_mw: float
    balance_mw: float
    voltage_kv: float
    generator_trip_mw: float
    transformer_overload_mw: float
    renewable_drop_mw: float
    nadir_hz: float
    transformer_temperature_celsius: float
    base_capacity_mw: float
    inertia_constant_s: float
    load_damping_pu_per_hz: float
    contingency_active: bool


class ComputeTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_gpu_count: int = Field(gt=0)
    active_gpu_count: int = Field(ge=0)
    cluster_nominal_power_mw: float = Field(ge=0)
    cluster_power_mw: float = Field(ge=0)
    shed_mw: float = Field(ge=0)
    throttled_gpu_count: int = Field(ge=0)
    thermal_celsius: float
    coolant_celsius: float
    tiers: List[TierTelemetry]


class BatteryTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    injection_mw: float = Field(ge=0)
    max_injection_mw: float = Field(gt=0)
    inverter_latency_ms: float = Field(ge=0)
    response_mode: Literal["SUB_CYCLE", "STANDBY"]


class AgentTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sentinel_state: str
    arbiter_state: str
    dispatcher_state: str
    auditor_state: str
    sentinel_alert: bool
    last_battery_dispatch_mw: float = Field(ge=0)
    last_compute_curtailment_mw: float = Field(ge=0)
    auditor_nadir_ok: bool
    auditor_recovery_ok: bool
    auditor_detail: str


class AgentLogTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(gt=0)
    time_s: float = Field(ge=0)
    agent: Literal["SENTINEL", "ARBITER", "DISPATCHER", "AUDITOR"]
    level: Literal["INFO", "WARN", "ALERT", "DECISION", "ACTION"]
    message: str


class FinancialTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outage_benchmark_usd: float = Field(ge=10_000_000)
    prevented_outages: int = Field(ge=0)
    capital_preserved_usd: float = Field(ge=0)
    active_outage_exposure_usd: float = Field(ge=0)
    avoided_sla_penalties_usd: float = Field(ge=0)
    avoided_sla_by_tier_usd: Dict[str, float]
    curtailment_cost_usd: float = Field(ge=0)
    last_event_avoided_sla_usd: float = Field(ge=0)
    last_event_curtailed_mw: float = Field(ge=0)
    last_event_recovery_ms: Optional[float] = Field(default=None, ge=0)


class EnvironmentalTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avoided_diesel_energy_mwh: float = Field(ge=0)
    avoided_carbon_kg: float = Field(ge=0)
    avoided_carbon_tonnes: float = Field(ge=0)
    diesel_carbon_intensity_kg_per_kwh: float = Field(gt=0)


class BatteryLifecycleTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    round_trip_efficiency_percent: float = Field(gt=0, le=100)
    nominal_capacity_mwh: float = Field(gt=0)
    energy_remaining_mwh: float = Field(ge=0)
    energy_delivered_mwh: float = Field(ge=0)
    equivalent_cycles: float = Field(ge=0)
    state_of_health_percent: float = Field(gt=0, le=100)
    cycle_life: float = Field(gt=0)
    end_of_life_soh_percent: float = Field(gt=0, le=100)


class TelemetryEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["telemetry"]
    sequence: int = Field(gt=0)
    timestamp_utc: datetime
    simulation_time_ms: int = Field(ge=0)
    stream_hz: float = Field(gt=0)
    grid: GridTelemetry
    compute: ComputeTelemetry
    battery: BatteryTelemetry
    agents: AgentTelemetry
    financial: FinancialTelemetry
    environmental: EnvironmentalTelemetry
    battery_lifecycle: BatteryLifecycleTelemetry
    events: List[AgentLogTelemetry]


class CommandEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["ping", "contingency", "transformer_overload", "renewable_drop", "reset"]
    trip_mw: Optional[float] = Field(default=None, ge=0, le=350)
    overload_mw: Optional[float] = Field(default=None, ge=0, le=250)
    drop_mw: Optional[float] = Field(default=None, ge=0, le=300)
    request_id: Optional[str] = None


class CommandAck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["ack"]
    command: str
    request_id: Optional[str]
    accepted: bool
    message: str
