from __future__ import annotations

from conftest import login_admin
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.models import AuditLog, User


def test_admin_creates_and_updates_user(client: TestClient, admin_user: User):
    csrf = login_admin(client)
    created = client.post(
        "/api/v1/users",
        headers={"X-CSRF-Token": csrf},
        json={
            "email": "analista@acqr.test",
            "full_name": "Pessoa Analista",
            "password": "Senha-Analista-2026!",
            "role": "analyst",
        },
    )
    assert created.status_code == 201
    user_id = created.json()["id"]
    assert created.json()["role"] == "analyst"

    updated = client.patch(
        f"/api/v1/users/{user_id}",
        headers={"X-CSRF-Token": csrf},
        json={"role": "coordinator"},
    )
    assert updated.status_code == 200
    assert updated.json()["role"] == "coordinator"

    listed = client.get("/api/v1/users")
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    audit_response = client.get("/api/v1/audit?resource_type=user")
    assert audit_response.status_code == 200
    assert audit_response.json()["total"] == 2

    with SessionLocal() as db:
        actions = set(db.scalars(select(AuditLog.action)))
        assert {"user.created", "user.updated"}.issubset(actions)


def test_non_admin_cannot_manage_users(client: TestClient):
    from app.security import hash_password

    with SessionLocal() as db:
        db.add(
            User(
                email="campo@acqr.test",
                full_name="Equipe de Campo",
                password_hash=hash_password("Senha-Campo-2026!"),
                role="field",
            )
        )
        db.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "campo@acqr.test", "password": "Senha-Campo-2026!"},
    )
    assert login.status_code == 200
    assert client.get("/api/v1/users").status_code == 403
    assert client.get("/api/v1/audit").status_code == 403


def test_admin_cannot_deactivate_own_account(client: TestClient, admin_user: User):
    csrf = login_admin(client)
    response = client.patch(
        f"/api/v1/users/{admin_user.id}",
        headers={"X-CSRF-Token": csrf},
        json={"is_active": False},
    )
    assert response.status_code == 400
