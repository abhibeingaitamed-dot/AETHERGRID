# AETHERGRID // Mission Deck

AETHERGRID is a cinematic cyber-physical command surface for co-orchestrating hyperscale AI compute with high-voltage grid infrastructure. Turn 3 adds a native Web Audio feedback graph, a 60 FPS laboratory oscilloscope, operator-triggered chaos controls, and a live four-agent terminal on top of the 1 kHz solver and 20 Hz WebSocket runtime.

## Turn 2 capabilities

- **12,000 GPU compute nodes** rendered through a Three.js `InstancedMesh` as 48 rack units across six rack corridors.
- **Subterranean cooling conduits** and high-voltage transmission paths built from animated custom GLSL energy materials.
- **Thermal emission and heat shimmer shaders** that transition the rack field from cyan through amber into infrared plasma as load rises.
- **Procedural cooling-loop and transmission-line particles** with per-particle phase, speed, lane, and glow attributes.
- **Cinematic camera rig** with smooth transitions between Macro Orbit, Rack Canyon fly-through, and Transformer Yard inspection perspectives.
- **Unreal Bloom, chromatic aberration, and depth of field** post-processing passes in the Three.js composer.
- **Glassmorphic tactical HUD** with UTC millisecond clock, system readiness, grid frequency, link diagnostics, compute telemetry, energy-silicon status, and event log.
- **Typed FastAPI endpoints** at `/health`, `/ready`, `/api/v1/health`, and `/api/v1/ready`, with configurable CORS.
- **Live bidirectional WebSocket telemetry** at `/ws/telemetry` and `/api/v1/ws/telemetry`, publishing validated grid, cluster, battery, and swarm state at 20 Hz while accepting `ping`, `contingency`, and `reset` commands.
- **Numerical microgrid physics** using the normalized swing equation with 60 Hz nominal frequency, a 1,000 MW base, 3.5 s inertia, 1.5 pu/Hz load damping, millisecond integration, generator trips capped at 350 MW, 150 MW aggregate facility-equivalent DVFS shedding, and 200 MW sub-cycle battery response.
- **Four autonomous agents**: Sentinel, Arbiter, Dispatcher, and Auditor. The default Arbiter cost curve protects Tier 1 first by allocating lower blended SLA/checkpoint cost tiers before higher-priority workloads.
- **Procedural Web Audio** gated by an explicit Enable Audio control, with a 60 Hz harmonic AC bed, frequency-reactive pitch, dual-tone emergency siren, relay clicks, battery-discharge rumble, stabilization chime, master volume, mute, and smoothed gain envelopes.
- **60 FPS Canvas oscilloscope** rendering the live backend voltage/frequency waveform with phosphor persistence, millihertz reticles, millisecond divisions, and cyan/amber/red state transitions.
- **Chaos Suite** controls for a 350 MW generator trip, 240 MW transformer overload, 260 MW renewable drop, and full system reset. Every action is sent as a typed bidirectional WebSocket command.
- **Live Swarm Terminal** with chronological millisecond-stamped agent badges, autoscroll, manual pause, and the numerical Arbiter/Dispatcher curtailment rationale.

The browser no longer generates telemetry locally. It connects to the backend WebSocket, automatically reconnects with bounded exponential backoff, and maps the live cluster load directly to the Three.js shader uniform driving busbar velocity, bloom, particle scale, and rack thermal emission.

## Repository layout

```text
backend/
  app/
    config.py       environment-backed typed settings
    models.py       strict health/readiness response models
    main.py         FastAPI application and static frontend serving
    physics.py      millisecond swing-equation integration engine
    swarm.py        Sentinel/Arbiter/Dispatcher/Auditor coordination
    contracts.py    WebSocket envelope and command models
    runtime.py      20 Hz async simulation broadcaster
  tests/             physics, swarm, WebSocket, health, readiness, and CORS tests
frontend/
  src/
    audio/           native Web Audio synthesis graph and React hook
    scene/           Three.js digital twin and GLSL shaders
    components/      HUD, oscilloscope, chaos suite, terminal, and scene host
    lib/             live WebSocket telemetry client and formatting
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

Open <http://localhost:5173>. The Vite proxy forwards `/health`, `/ready`, `/api/*`, and `/ws/*` requests to FastAPI on port 8000. The backend schedules a deterministic 320 MW generator-trip demonstration at simulation time 3 seconds; the same condition can be triggered interactively through the WebSocket command contract.

To run each process separately:

```bash
.venv/bin/python -m uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
npm run dev --workspace frontend
```

The API alone is available at <http://localhost:8000/health> and <http://localhost:8000/ready>. The live bridge is available at `ws://localhost:8000/ws/telemetry`. When a production frontend build exists, FastAPI serves `frontend/dist` from the root route and `/assets`.

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
docker build -t aethergrid:turn-2 .
docker run --rm --env-file .env.example -p 8000:8000 aethergrid:turn-2
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

Supported values are `AETHERGRID_ENVIRONMENT`, `AETHERGRID_ALLOWED_ORIGINS` (comma-separated), `AETHERGRID_API_PORT`, `AETHERGRID_LOAD_DAMPING_PU_PER_HZ`, `AETHERGRID_AUTO_CONTINGENCY_AFTER_S`, `AETHERGRID_AUTO_CONTINGENCY_TRIP_MW`, `AETHERGRID_TRANSFORMER_OVERLOAD_MW`, and `AETHERGRID_RENEWABLE_DROP_MW`. No secrets are needed for Turn 3.

## UI controls

The left-side Camera Rig selects the three cinematic camera poses. The operator can also move the pointer across the viewport for subtle camera parallax. Press **ENABLE AUDIO** once after loading to unlock the native browser audio graph. The **Chaos Suite** sends typed contingency commands through the live bridge; the oscilloscope, digital twin shaders, alarm synthesis, HUD, and terminal all react to the same backend simulation frame. The **PAUSE** control in the Swarm Terminal freezes autoscroll while retaining the full bounded event history.
