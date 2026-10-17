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
    nadir_hz: float
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
    events: List[AgentLogTelemetry]


class CommandEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["ping", "contingency", "reset"]
    trip_mw: Optional[float] = Field(default=None, ge=0, le=350)
    request_id: Optional[str] = None


class CommandAck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["ack"]
    command: str
    request_id: Optional[str]
    accepted: bool
    message: str
