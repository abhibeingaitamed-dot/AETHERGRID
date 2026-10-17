# AETHERGRID // Mission Deck

AETHERGRID is a cinematic cyber-physical command surface for co-orchestrating hyperscale AI compute with high-voltage grid infrastructure. Turn 1 delivers the complete local foundation: a FastAPI service with typed health/readiness contracts and a React + TypeScript + Three.js mission deck powered by deterministic browser telemetry.

## Turn 1 capabilities

- **12,000 GPU compute nodes** rendered through a Three.js `InstancedMesh` as 48 rack units across six rack corridors.
- **Subterranean cooling conduits** and high-voltage transmission paths built from animated custom GLSL energy materials.
- **Thermal emission and heat shimmer shaders** that transition the rack field from cyan through amber into infrared plasma as load rises.
- **Procedural cooling-loop and transmission-line particles** with per-particle phase, speed, lane, and glow attributes.
- **Cinematic camera rig** with smooth transitions between Macro Orbit, Rack Canyon fly-through, and Transformer Yard inspection perspectives.
- **Unreal Bloom, chromatic aberration, and depth of field** post-processing passes in the Three.js composer.
- **Glassmorphic tactical HUD** with UTC millisecond clock, system readiness, grid frequency, link diagnostics, compute telemetry, energy-silicon status, and event log.
- **Typed FastAPI endpoints** at `/health`, `/ready`, `/api/v1/health`, and `/api/v1/ready`, with configurable CORS.

The browser telemetry stream is deterministic and local by design for Turn 1. It uses bounded sine-wave signals rather than random values, making load, thermal, coolant, frequency, and transformer behavior reproducible without a physics WebSocket. The live grid-physics transport is reserved for the approved Turn 2 scope.

## Repository layout

```text
backend/
  app/
    config.py       environment-backed typed settings
    models.py       strict health/readiness response models
    main.py         FastAPI application and static frontend serving
  tests/             contract tests for health, readiness, and CORS
frontend/
  src/
    scene/           Three.js digital twin and GLSL shaders
    components/      HUD, telemetry cards, and scene host
    lib/             deterministic telemetry model and formatting
    App.tsx          Mission Deck composition
    styles.css       cinematic HUD visual system
Dockerfile           reproducible multi-stage build
Makefile             install, development, build, and test commands
```

## Requirements

- Node.js **22.11.0** (the version is pinned in `.nvmrc`).
- Python **3.11 or 3.12** for local development. The launch script resolves `python3`; the Docker runtime is pinned to Python **3.12.7**.
- Docker Engine for the container workflow.

No global package installation is required. Python packages live in `.venv`; JavaScript packages live in the project `node_modules/` directory.

## Local setup

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
npm ci
```

The JavaScript lockfile is `package-lock.json`. The Python dependency lock is `backend/requirements.lock`.

## Run locally

Start the FastAPI API and Vite Mission Deck together:

```bash
./scripts/dev.sh
```

Open <http://localhost:5173>. The Vite proxy forwards `/health`, `/ready`, and `/api/*` requests to FastAPI on port 8000.

To run each process separately:

```bash
.venv/bin/python -m uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
npm run dev --workspace frontend
```

The API alone is available at <http://localhost:8000/health> and <http://localhost:8000/ready>. When a production frontend build exists, FastAPI serves `frontend/dist` from the root route and `/assets`.

## Test and build

After setup, the single offline verification command is:

```bash
make test
```

It runs the FastAPI contract suite with the project-local Python interpreter and then runs the strict TypeScript check plus Vite production bundle. It performs no network access. Dependencies must be installed once using the setup commands above.

The frontend build can also be run directly:

```bash
npm run build
```

## Docker build and run

The multi-stage Dockerfile builds the Vite bundle with Node 22.11.0, installs the pinned Python dependencies into a Python 3.12.7 runtime, and serves both the API and compiled Mission Deck from one process.

```bash
```

Open <http://localhost:8000> for the compiled Mission Deck, or verify the container contract:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/ready
```

The image health check polls `/ready` and does not require an external service.

## Configuration

Copy `.env.example` when a local environment file is needed:

```bash
cp .env.example .env
```

Supported values are `AETHERGRID_ENVIRONMENT`, `AETHERGRID_ALLOWED_ORIGINS` (comma-separated), and `AETHERGRID_API_PORT`. No secrets are needed for Turn 1.

## UI controls

The left-side Camera Rig selects the three cinematic camera poses. The operator can also move the pointer across the viewport for subtle camera parallax. The digital twin reacts continuously to the local telemetry stream: busbar velocity, bloom intensity, rack thermal palette, heat shimmer density, particle scale, and HUD meters all follow the same bounded grid-load signal.
