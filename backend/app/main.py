import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .models import HealthResponse, ReadinessResponse
from .physics import PhysicsConfig
from .runtime import RuntimeConfig, SimulationRuntime

settings = get_settings()
started_at = datetime.now(timezone.utc)
started_monotonic = time.monotonic()
simulation_runtime = SimulationRuntime(
    physics_config=PhysicsConfig(load_damping_pu_per_hz=settings.load_damping_pu_per_hz),
    runtime_config=RuntimeConfig(
        publication_hz=20.0,
        auto_contingency_after_s=settings.auto_contingency_after_s,
        auto_contingency_trip_mw=settings.auto_contingency_trip_mw,
        transformer_overload_mw=settings.transformer_overload_mw,
        renewable_drop_mw=settings.renewable_drop_mw,
    ),
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await simulation_runtime.start()
    try:
        yield
    finally:
        await simulation_runtime.stop()

app = FastAPI(
    title=settings.application_name,
    version=settings.version,
    description="Typed readiness contract for the AETHERGRID energy-silicon co-orchestrator.",
    lifespan=lifespan,
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


@app.websocket("/ws/telemetry")
@app.websocket("/api/v1/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    telemetry_queue = await simulation_runtime.subscribe()
    acknowledgement_queue: asyncio.Queue = asyncio.Queue()

    async def send_loop() -> None:
        while True:
            telemetry_task = asyncio.create_task(telemetry_queue.get())
            acknowledgement_task = asyncio.create_task(acknowledgement_queue.get())
            done, pending = await asyncio.wait(
                {telemetry_task, acknowledgement_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                payload = task.result()
                if isinstance(payload, TelemetryEnvelope):
                    await websocket.send_json(payload.model_dump(mode="json"))
                else:
                    await websocket.send_json(payload.model_dump(mode="json"))

    async def receive_loop() -> None:
        while True:
            raw_command = await websocket.receive_json()
            acknowledgement = await simulation_runtime.handle_command(raw_command)
            await acknowledgement_queue.put(acknowledgement)

    from .contracts import TelemetryEnvelope

    sender = asyncio.create_task(send_loop(), name="aethergrid-websocket-sender")
    receiver = asyncio.create_task(receive_loop(), name="aethergrid-websocket-receiver")
    try:
        done, pending = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_EXCEPTION)
        for task in done:
            exception = task.exception()
            if exception is not None and not isinstance(exception, WebSocketDisconnect):
                raise exception
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        sender.cancel()
        receiver.cancel()
        await asyncio.gather(sender, receiver, return_exceptions=True)
        simulation_runtime.unsubscribe(telemetry_queue)


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
