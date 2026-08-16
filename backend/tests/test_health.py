from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_checks_and_security_headers(client: TestClient):
    live = client.get("/health/live")
    ready = client.get("/health/ready")

    assert live.status_code == 200
    assert live.json() == {
        "status": "ok",
        "service": "ACCORSI API",
        "version": "0.11.0",
    }
    assert ready.status_code == 200
    assert ready.json()["status"] == "ok"
    assert live.headers["x-content-type-options"] == "nosniff"
    assert live.headers["x-frame-options"] == "DENY"
    assert live.headers["x-request-id"]


def test_authenticated_routes_reject_anonymous_requests(client: TestClient):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/municipalities").status_code == 401
    assert client.get("/api/v1/users").status_code == 401
