from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health_contract_is_typed_and_live() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "aethergrid-api"
    assert payload["version"] == "0.1.0"
    assert payload["uptime_seconds"] >= 0
    assert payload["timestamp_utc"].endswith(("Z", "+00:00"))


def test_readiness_contract_reports_required_checks() -> None:
    response = client.get("/api/v1/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"] == {"api": True, "configuration": True}


def test_cors_allows_the_local_vite_origin() -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
