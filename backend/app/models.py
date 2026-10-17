from datetime import datetime
from typing import Dict, Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    service: str
    version: str
    environment: str
    timestamp_utc: datetime
    uptime_seconds: float = Field(ge=0)


class ReadinessResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ready", "not_ready"]
    service: str
    checks: Dict[str, bool]
    timestamp_utc: datetime
