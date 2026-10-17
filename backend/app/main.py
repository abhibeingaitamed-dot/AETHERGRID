from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .models import HealthResponse, ReadinessResponse

settings = get_settings()
started_at = datetime.now(timezone.utc)
started_monotonic = time.monotonic()

app = FastAPI(
    title=settings.application_name,
    version=settings.version,
    description="Typed readiness contract for the AETHERGRID energy-silicon co-orchestrator.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def health_payload() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="aethergrid-api",
        version=settings.version,
        environment=settings.environment,
        timestamp_utc=utc_now(),
        uptime_seconds=round(max(0.0, time.monotonic() - started_monotonic), 3),
    )


def readiness_payload() -> ReadinessResponse:
    checks: Dict[str, bool] = {
        "api": True,
        "configuration": bool(settings.allowed_origins),
    }
    return ReadinessResponse(
        status="ready" if all(checks.values()) else "not_ready",
        service="aethergrid-api",
        checks=checks,
        timestamp_utc=utc_now(),
    )


@app.get("/health", response_model=HealthResponse, tags=["system"])
@app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return health_payload()


@app.get("/ready", response_model=ReadinessResponse, tags=["system"])
@app.get("/api/v1/ready", response_model=ReadinessResponse, tags=["system"])
def ready() -> ReadinessResponse:
    return readiness_payload()


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (frontend_dist / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="frontend-assets")


@app.get("/", include_in_schema=False)
def root() -> Response:
    index_file = frontend_dist / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return JSONResponse(
        {
            "service": settings.application_name,
            "status": "ok",
            "health": "/health",
            "readiness": "/ready",
        }
    )
