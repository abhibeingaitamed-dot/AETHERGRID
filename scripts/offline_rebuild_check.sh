#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT_DIR

python3 - <<'PY'
import os
from pathlib import Path
import subprocess
import sys

root = Path(os.environ["ROOT_DIR"])

def require_file(relative: str) -> Path:
    path = root / relative
    if not path.is_file():
        raise SystemExit(f"missing required rebuild file: {relative}")
    return path

if require_file(".nvmrc").read_text().strip() != "22.11.0":
    raise SystemExit(".nvmrc must pin Node 22.11.0")
if require_file(".python-version").read_text().strip() != "3.12.7":
    raise SystemExit(".python-version must pin Python 3.12.7")
require_file("package-lock.json")
requirements = require_file("backend/requirements.lock")
require_file("Dockerfile")
require_file("README.md")
launcher = require_file("launch.sh")
if not os.access(launcher, os.X_OK):
    raise SystemExit("launch.sh must be executable")

if any(line.strip() and "==" not in line and not line.lstrip().startswith("#") and not line.lstrip().startswith("-") for line in requirements.read_text().splitlines()):
    raise SystemExit("backend/requirements.lock contains an unpinned requirement")

dockerfile = (root / "Dockerfile").read_text()
required_docker_fragments = (
    "node:22.11.0-bookworm-slim",
    "python:3.12.7-slim-bookworm",
    "npm ci --ignore-scripts",
    "pip install --no-cache-dir -r backend/requirements.lock",
    "backend.app.main:app",
)
for fragment in required_docker_fragments:
    if fragment not in dockerfile:
        raise SystemExit(f"Dockerfile is missing required fragment: {fragment}")

tracked = subprocess.run(
    ["git", "-C", str(root), "ls-files", "-z"],
    check=True,
    capture_output=True,
).stdout.split(b"\0")
for raw_path in tracked:
    if not raw_path:
        continue
    path = root / os.fsdecode(raw_path)
    relative_path = path.relative_to(root)
    if relative_path.as_posix() in {"README.md", "scripts/offline_rebuild_check.sh"}:
        continue
    if not path.is_file():
        continue
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        continue
    for marker in ("/Users/", "/home/", "C:\\Users\\", "C:/Users/"):
        if marker in text:
            raise SystemExit(f"absolute user path {marker!r} found in tracked file: {relative_path}")

print("AETHERGRID rebuild manifest checks passed")
PY

printf '[AETHERGRID] Running the offline test/build gate with package installation disabled.\n'
env PIP_NO_INDEX=1 PIP_DISABLE_PIP_VERSION_CHECK=1 npm_config_offline=true NO_PROXY='*' make -C "${ROOT_DIR}" test

printf '[AETHERGRID] Offline rebuild check passed.\n'
