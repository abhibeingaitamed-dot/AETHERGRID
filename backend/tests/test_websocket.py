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

            websocket.send_json({"type": "transformer_overload", "overload_mw": 240.0, "request_id": "thermal-1"})
            thermal_ack = None
            for _ in range(6):
                message = websocket.receive_json()
                if message.get("type") == "ack":
                    thermal_ack = message
                    break
            assert thermal_ack is not None
            assert thermal_ack["command"] == "transformer_overload"
            assert thermal_ack["accepted"] is True

            websocket.send_json({"type": "renewable_drop", "drop_mw": 260.0, "request_id": "renewable-1"})
            renewable_ack = None
            for _ in range(6):
                message = websocket.receive_json()
                if message.get("type") == "ack":
                    renewable_ack = message
                    break
            assert renewable_ack is not None
            assert renewable_ack["command"] == "renewable_drop"
            assert renewable_ack["accepted"] is True

            websocket.send_json({"type": "reset", "request_id": "reset-1"})
            reset_ack = None
            for _ in range(6):
                message = websocket.receive_json()
                if message.get("type") == "ack":
                    reset_ack = message
                    break
            assert reset_ack is not None
            assert reset_ack["command"] == "reset"
