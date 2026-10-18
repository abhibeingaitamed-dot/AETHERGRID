.PHONY: install install-frontend install-backend dev test verify-responsive build verify-rebuild clean

PYTHON_BIN ?= .venv/bin/python

install: install-backend install-frontend

install-backend:
	python3 -m venv .venv
	$(PYTHON_BIN) -m pip install -r backend/requirements.lock

install-frontend:
	npm ci

dev:
	@./launch.sh

test:
	@test -x "$(PYTHON_BIN)" || (printf 'Run make install first to create the project-local Python environment.\n' >&2; exit 1)
	$(PYTHON_BIN) -m pytest backend/tests
	node scripts/verify_responsive_layout.mjs
	npm run build

verify-responsive:
	node scripts/verify_responsive_layout.mjs

build:
	npm run build

verify-rebuild:
	@./scripts/offline_rebuild_check.sh

clean:
	rm -rf frontend/dist frontend/.vite .pytest_cache
