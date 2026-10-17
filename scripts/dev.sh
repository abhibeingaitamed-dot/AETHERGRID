#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.env"
  set +a
fi

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  printf 'AETHERGRID requires %s on PATH.\n' "${PYTHON_BIN}" >&2
  exit 1
fi

if [ ! -d "${ROOT_DIR}/.venv" ]; then
  "${PYTHON_BIN}" -m venv "${ROOT_DIR}/.venv"
fi

"${ROOT_DIR}/.venv/bin/python" -m pip install -q -r "${ROOT_DIR}/backend/requirements.lock"

trap 'kill 0' EXIT INT TERM
(cd "${ROOT_DIR}" && "${ROOT_DIR}/.venv/bin/python" -m uvicorn backend.app.main:app --reload --host 0.0.0.0 --port "${AETHERGRID_API_PORT:-8000}") &
(cd "${ROOT_DIR}/frontend" && npm run dev) &
wait
