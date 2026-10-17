from functools import lru_cache
import os
from typing import List

from pydantic import BaseModel, Field


class Settings(BaseModel):
    """Runtime settings loaded from environment variables."""

    application_name: str = Field(default="AETHERGRID Mission Deck")
    version: str = Field(default="0.1.0")
    environment: str = Field(default="development")
    allowed_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    @classmethod
    def from_environment(cls) -> "Settings":
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
            allowed_origins=origins or cls().allowed_origins,
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_environment()
