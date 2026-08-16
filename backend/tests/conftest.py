from __future__ import annotations

import os

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///./acqr_test.db"
os.environ["SESSION_SECRET"] = "test-session-secret-with-at-least-32-characters"
os.environ["COOKIE_SECURE"] = "false"
os.environ["ALLOWED_HOSTS"] = "testserver,localhost,127.0.0.1"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import User
from app.security import hash_password, login_throttle

ADMIN_EMAIL = "admin@acqr.test"
ADMIN_PASSWORD = "Senha-Forte-2026!"


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    login_throttle._attempts.clear()
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin_user() -> User:
    with SessionLocal() as db:
        user = User(
            email=ADMIN_EMAIL,
            full_name="Administradora ACCORSI",
            password_hash=hash_password(ADMIN_PASSWORD),
            role="admin",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user


def login_admin(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    csrf = client.cookies.get("acqr_csrf")
    assert csrf
    return csrf
