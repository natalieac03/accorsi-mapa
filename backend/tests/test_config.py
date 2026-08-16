from __future__ import annotations

import pytest

from app.config import Settings

PRODUCTION_BASE = {
    "app_env": "production",
    "database_url": "postgresql://acqr:senha@db:5432/acqr",
    "session_secret": "f3a9c1e07b5d4a628e0c9b71d5f4a2c8e6b0d371a94f5c2e",
    "cookie_secure": True,
    "cookie_samesite": "lax",
    "cors_origins": "",
    "allowed_hosts": "painel.exemplo.org",
    "docs_enabled": False,
}


def build(**overrides: object) -> Settings:
    return Settings(**{**PRODUCTION_BASE, **overrides})  # type: ignore[arg-type]


def test_producao_valida_com_configuracao_completa() -> None:
    build().validate_runtime_security()


def test_producao_recusa_sqlite() -> None:
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        build(database_url="sqlite:///./acqr.db").validate_runtime_security()


@pytest.mark.parametrize(
    "secret",
    [
        # 32 caracteres passa na validação do Pydantic mas não nos 48 exigidos
        # em produção; abaixo de 32 o erro vem do próprio campo, não daqui.
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        "development-only-change-this-session-secret-32-chars",
        "SUBSTITUA_POR_UMA_CHAVE_ALEATORIA_DE_48_OU_MAIS_CARACTERES",
    ],
)
def test_producao_recusa_segredo_fraco(secret: str) -> None:
    with pytest.raises(RuntimeError, match="SESSION_SECRET"):
        build(session_secret=secret).validate_runtime_security()


def test_producao_recusa_cookie_inseguro() -> None:
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        build(cookie_secure=False).validate_runtime_security()


def test_producao_recusa_cors_curinga() -> None:
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        build(cors_origins="*").validate_runtime_security()


def test_producao_recusa_allowed_hosts_curinga() -> None:
    with pytest.raises(RuntimeError, match="ALLOWED_HOSTS"):
        build(allowed_hosts="*").validate_runtime_security()


def test_producao_recusa_allowed_hosts_vazio() -> None:
    with pytest.raises(RuntimeError, match="ALLOWED_HOSTS"):
        build(allowed_hosts="").validate_runtime_security()


def test_desenvolvimento_nao_aplica_as_recusas() -> None:
    Settings(app_env="development", allowed_hosts="*").validate_runtime_security()
