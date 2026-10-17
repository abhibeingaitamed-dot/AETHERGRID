.PHONY: install install-frontend install-backend dev test build clean

PYTHON_BIN ?= .venv/bin/python

install: install-backend install-frontend

install-backend:
	python3 -m venv .venv
	$(PYTHON_BIN) -m pip install -r backend/requirements.lock

install-frontend:

dev:
	@./scripts/dev.sh

test:
	@test -x "$(PYTHON_BIN)" || (printf 'Run make install first to create the project-local Python environment.\n' >&2; exit 1)
	$(PYTHON_BIN) -m pytest backend/tests
	npm run build

build:
	npm run build

clean:
	rm -rf frontend/dist frontend/.vite .pytest_cache
