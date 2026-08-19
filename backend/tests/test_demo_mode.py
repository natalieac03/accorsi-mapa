"""AUTH_REQUIRED=false: API aberta sem login, para demonstração."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.dependencies import DEMO_EMAIL, DEMO_ROLE
from app.models import Municipality, User

from test_registrations import payload, seed_municipalities


@pytest.fixture
def sem_login(monkeypatch):
    # get_settings tem lru_cache: sem limpar, a instância antiga continua
    # valendo e o teste não veria a variável.
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_leitura_sem_cookie_de_sessao(sem_login, client: TestClient):
    seed_municipalities()

    response = client.get("/api/v1/municipalities")

    assert response.status_code == 200
    assert response.json()["total"] == 2


def test_escrita_sem_cookie_e_sem_token_csrf(sem_login, client: TestClient):
    seed_municipalities()

    # Sem cabeçalho X-CSRF-Token: não existe sessão para proteger.
    response = client.post("/api/v1/registrations", json=payload("DEMO-1"))

    assert response.status_code == 201


def test_usuario_de_demonstracao_e_criado_uma_vez_so(sem_login, client: TestClient):
    seed_municipalities()

    client.get("/api/v1/municipalities")
    client.get("/api/v1/municipalities")

    with SessionLocal() as db:
        usuarios = db.scalars(select(User).where(User.email == DEMO_EMAIL)).all()

    assert len(usuarios) == 1
    assert usuarios[0].role == DEMO_ROLE
    # Perfil coordination não administra usuário nem lê auditoria.
    assert usuarios[0].role != "admin"


def test_administracao_continua_fechada_na_demonstracao(sem_login, client: TestClient):
    assert client.get("/api/v1/users").status_code == 403
    assert client.get("/api/v1/audit").status_code == 403


def test_com_auth_required_ligado_a_api_volta_a_exigir_login(client: TestClient):
    # Sem a fixture sem_login: o padrão continua sendo exigir sessão.
    assert client.get("/api/v1/municipalities").status_code == 401

    with SessionLocal() as db:
        assert db.scalar(select(User).where(User.email == DEMO_EMAIL)) is None
        assert db.scalar(select(Municipality)) is None
