from functools import lru_cache
import os
from typing import List, Optional

from pydantic import BaseModel, Field


class Settings(BaseModel):
    """Runtime settings loaded from environment variables."""

    application_name: str = Field(default="AETHERGRID Mission Deck")
    version: str = Field(default="0.1.0")
    environment: str = Field(default="development")
    load_damping_pu_per_hz: float = Field(default=1.5, gt=0)
    auto_contingency_after_s: Optional[float] = Field(default=3.0, ge=0)
    auto_contingency_trip_mw: float = Field(default=320.0, gt=0, le=350)
    transformer_overload_mw: float = Field(default=240.0, gt=0, le=250)
    renewable_drop_mw: float = Field(default=260.0, gt=0, le=300)
    allowed_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    @classmethod
    def from_environment(cls) -> "Settings":
        defaults = cls()
        raw_origins = os.getenv("AETHERGRID_ALLOWED_ORIGINS")
        origins = (
            [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
            if raw_origins
            else None
        )
        return cls(
            application_name=os.getenv("AETHERGRID_APPLICATION_NAME", "AETHERGRID Mission Deck"),
            version=os.getenv("AETHERGRID_VERSION", "0.1.0"),
            environment=os.getenv("AETHERGRID_ENVIRONMENT", "development"),
            allowed_origins=origins or defaults.allowed_origins,
            load_damping_pu_per_hz=float(os.getenv("AETHERGRID_LOAD_DAMPING_PU_PER_HZ", defaults.load_damping_pu_per_hz)),
            auto_contingency_after_s=(
                float(os.getenv("AETHERGRID_AUTO_CONTINGENCY_AFTER_S"))
                if os.getenv("AETHERGRID_AUTO_CONTINGENCY_AFTER_S")
                else defaults.auto_contingency_after_s
            ),
            auto_contingency_trip_mw=float(os.getenv("AETHERGRID_AUTO_CONTINGENCY_TRIP_MW", defaults.auto_contingency_trip_mw)),
            transformer_overload_mw=float(os.getenv("AETHERGRID_TRANSFORMER_OVERLOAD_MW", defaults.transformer_overload_mw)),
            renewable_drop_mw=float(os.getenv("AETHERGRID_RENEWABLE_DROP_MW", defaults.renewable_drop_mw)),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_environment()
