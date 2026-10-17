from fastapi.testclient import TestClient

from backend.app.main import app, simulation_runtime


def test_websocket_stream_is_bidirectional_and_typed() -> None:
    simulation_runtime.reset()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/telemetry") as websocket:
            initial = websocket.receive_json()
            assert initial["type"] == "telemetry"
            assert initial["stream_hz"] == 20.0
            assert initial["grid"]["nominal_frequency_hz"] == 60.0
            assert initial["compute"]["total_gpu_count"] == 12_000

            websocket.send_json({"type": "ping", "request_id": "ping-1"})
            ping_ack = None
            for _ in range(4):
                message = websocket.receive_json()
                if message.get("type") == "ack":
                    ping_ack = message
                    break
            assert ping_ack == {
                "type": "ack",
                "command": "ping",
                "request_id": "ping-1",
                "accepted": True,
                "message": "telemetry bridge alive",
            }

            websocket.send_json({"type": "contingency", "trip_mw": 300.0, "request_id": "trip-1"})
            trip_ack = None
            for _ in range(6):
                message = websocket.receive_json()
                if message.get("type") == "ack":
                    trip_ack = message
                    break
            assert trip_ack is not None
            assert trip_ack["command"] == "contingency"
            assert trip_ack["accepted"] is True
