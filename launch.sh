#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.env"
  set +a
fi

select_python() {
  if [ -n "${PYTHON_BIN:-}" ] && command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
    printf '%s' "${PYTHON_BIN}"
    return
  fi
  for candidate in python3 python; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      printf '%s' "${candidate}"
      return
    fi
  done
  printf 'python3 or python is required on PATH.\n' >&2
  exit 1
}

PYTHON_RUNTIME="$(select_python)"
PYTHON_VERSION="$(${PYTHON_RUNTIME} -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
case "${PYTHON_VERSION}" in
  3.9|3.10|3.11|3.12) ;;
  *)
    printf 'AETHERGRID requires Python 3.9-3.12 locally; found %s.\n' "${PYTHON_VERSION}" >&2
    exit 1
    ;;
esac

if ! command -v npm >/dev/null 2>&1; then
  printf 'AETHERGRID requires npm from the pinned Node.js runtime.\n' >&2
  exit 1
fi

VENV_DIR="${ROOT_DIR}/.venv"
VENV_PYTHON="${VENV_DIR}/bin/python"
if [ ! -x "${VENV_PYTHON}" ]; then
  printf '[AETHERGRID] Creating project-local Python environment with %s\n' "${PYTHON_RUNTIME}"
  "${PYTHON_RUNTIME}" -m venv "${VENV_DIR}"
fi

if ! "${VENV_PYTHON}" - <<'PY' >/dev/null 2>&1
import fastapi
import uvicorn
import websockets
from pydantic import BaseModel
PY
then
  printf '[AETHERGRID] Installing pinned Python dependencies\n'
  "${VENV_PYTHON}" -m pip install --requirement "${ROOT_DIR}/backend/requirements.lock"
fi

if [ ! -d "${ROOT_DIR}/node_modules" ] || ! (cd "${ROOT_DIR}" && npm ls --workspaces --silent >/dev/null 2>&1); then
  printf '[AETHERGRID] Installing pinned Node dependencies\n'
  (cd "${ROOT_DIR}" && npm ci)
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM HUP
  terminate_tree() {
    local root_pid="$1"
    local child_pid
    if ! kill -0 "${root_pid}" 2>/dev/null; then
      return
    fi
    for child_pid in $(pgrep -P "${root_pid}" 2>/dev/null || true); do
      terminate_tree "${child_pid}"
    done
    kill -TERM "${root_pid}" 2>/dev/null || true
  }
  terminate_tree "${BACKEND_PID}"
  terminate_tree "${FRONTEND_PID}"
  for pid in "${BACKEND_PID}" "${FRONTEND_PID}"; do
    if [ -n "${pid}" ]; then
      wait "${pid}" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM HUP

API_HOST="${AETHERGRID_API_HOST:-127.0.0.1}"
API_PORT="${AETHERGRID_API_PORT:-8000}"
FRONTEND_HOST="${AETHERGRID_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${AETHERGRID_FRONTEND_PORT:-5173}"

printf '\n'
printf '╔══════════════════════════════════════════════════════════════╗\n'
printf '║ AETHERGRID // TURN 4 MISSION DECK                           ║\n'
printf '║ microgrid physics + swarm + impact telemetry                 ║\n'
printf '╠══════════════════════════════════════════════════════════════╣\n'
printf '║ API      http://%s:%s                                  ║\n' "${API_HOST}" "${API_PORT}"
printf '║ MISSION  http://%s:%s                                  ║\n' "${FRONTEND_HOST}" "${FRONTEND_PORT}"
printf '║ SOCKET   ws://%s:%s/ws/telemetry                       ║\n' "${API_HOST}" "${API_PORT}"
printf '╚══════════════════════════════════════════════════════════════╝\n'
printf '\n'

(cd "${ROOT_DIR}" && exec "${VENV_PYTHON}" -m uvicorn backend.app.main:app --host "${API_HOST}" --port "${API_PORT}") &
BACKEND_PID=$!
(cd "${ROOT_DIR}/frontend" && exec npm run dev -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}") &
FRONTEND_PID=$!

while :; do
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    wait "${BACKEND_PID}" || true
    printf '[AETHERGRID] Backend exited; stopping frontend.\n' >&2
    exit 1
  fi
  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    wait "${FRONTEND_PID}" || true
    printf '[AETHERGRID] Frontend exited; stopping backend.\n' >&2
    exit 1
  fi
  sleep 1
done
