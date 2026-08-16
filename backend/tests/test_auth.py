from __future__ import annotations

from conftest import ADMIN_EMAIL, ADMIN_PASSWORD, login_admin
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import AuditLog, AuthSession, User


def test_login_sets_secure_session_shape_and_returns_current_user(
    client: TestClient,
    admin_user: User,
):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL.upper(), "password": ADMIN_PASSWORD},
    )

    assert response.status_code == 200
    assert response.json()["user"]["role"] == "admin"
    assert client.cookies.get("acqr_session")
    assert client.cookies.get("acqr_csrf")
    assert "HttpOnly" in response.headers.get("set-cookie", "")

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == ADMIN_EMAIL

    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AuthSession)) == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "auth.login_succeeded")
            )
            == 1
        )


def test_invalid_login_is_generic_and_audited(client: TestClient, admin_user: User):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL, "password": "senha-incorreta"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "E-mail ou senha inválidos."

    with SessionLocal() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "auth.login_failed")
            )
            == 1
        )


def test_logout_requires_csrf_and_revokes_session(client: TestClient, admin_user: User):
    csrf = login_admin(client)

    denied = client.post("/api/v1/auth/logout")
    assert denied.status_code == 403
    assert client.get("/api/v1/auth/me").status_code == 200

    logged_out = client.post(
        "/api/v1/auth/logout",
        headers={"X-CSRF-Token": csrf},
    )
    assert logged_out.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401


def test_password_change_revokes_all_sessions(client: TestClient, admin_user: User):
    csrf = login_admin(client)
    response = client.post(
        "/api/v1/auth/change-password",
        headers={"X-CSRF-Token": csrf},
        json={
            "current_password": ADMIN_PASSWORD,
            "new_password": "Nova-Senha-Segura-2026!",
        },
    )

    assert response.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401

    old_login = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert old_login.status_code == 401
    new_login = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL, "password": "Nova-Senha-Segura-2026!"},
    )
    assert new_login.status_code == 200
