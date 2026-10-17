.PHONY: install install-frontend install-backend dev test build clean

install: install-backend install-frontend

install-backend:
	python3 -m pip install --upgrade pip
	python3 -m pip install -r backend/requirements.lock

install-frontend:

dev:
	@./scripts/dev.sh

test:
	python3 -m pytest backend/tests
	npm run build

build:
	npm run build

clean:
	rm -rf frontend/dist frontend/.vite .pytest_cache
