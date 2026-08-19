from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .config import get_settings
from .database import get_db
from .models import AuthSession, User, utcnow
from .security import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, hash_secret

# Identidade usada quando AUTH_REQUIRED=false (modo demonstração).
DEMO_EMAIL = "demonstracao@local"
DEMO_ROLE = "coordinator"


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: AuthSession


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _demo_context(db: Session) -> AuthContext:
    """Sessão de demonstração para AUTH_REQUIRED=false.

    O usuário é gravado no banco de verdade porque cadastro e auditoria
    guardam user_id com chave estrangeira: um usuário só de memória faria a
    primeira escrita falhar. A senha fica com um hash impossível de casar,
    então essa conta não serve para entrar pela tela de login se o modo for
    desligado depois.
    """
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        user = User(
            email=DEMO_EMAIL,
            full_name="Demonstração",
            password_hash="login-desativado",
            role=DEMO_ROLE,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.is_active or user.role != DEMO_ROLE:
        user.is_active = True
        user.role = DEMO_ROLE
        db.commit()

    # Sessão só de memória: sem cookie não há token para guardar, e nada fora
    # das rotas de /auth lê os campos dela.
    sessao = AuthSession(
        id="demo",
        user_id=user.id,
        token_hash="",
        csrf_hash="",
        expires_at=datetime.now(UTC) + timedelta(hours=get_settings().session_hours),
    )
    return AuthContext(user=user, session=sessao)


def get_auth_context(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> AuthContext:
    if not get_settings().auth_required:
        context = _demo_context(db)
        request.state.auth_context = context
        return context

    raw_token = request.cookies.get(SESSION_COOKIE)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado.")

    auth_session = db.scalar(
        select(AuthSession)
        .options(joinedload(AuthSession.user))
        .where(AuthSession.token_hash == hash_secret(raw_token))
    )
    if not auth_session or auth_session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida.")

    if _as_utc(auth_session.expires_at) <= datetime.now(UTC):
        auth_session.revoked_at = utcnow()
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada.")

    if not auth_session.user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário desativado.")

    context = AuthContext(user=auth_session.user, session=auth_session)
    request.state.auth_context = context
    return context


def require_csrf(
    request: Request,
    context: Annotated[AuthContext, Depends(get_auth_context)],
) -> AuthContext:
    # Sem login não existe cookie de sessão, então não há token CSRF para
    # conferir. O CSRF protege uma sessão que aqui não existe.
    if not get_settings().auth_required:
        return context

    header_token = request.headers.get(CSRF_HEADER)
    cookie_token = request.cookies.get(CSRF_COOKIE)
    if not header_token or not cookie_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token CSRF ausente.")
    if not hmac.compare_digest(header_token, cookie_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token CSRF inválido.")
    if not hmac.compare_digest(hash_secret(header_token), context.session.csrf_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token CSRF inválido.")
    return context


def require_roles(*allowed_roles: str):
    def dependency(
        context: Annotated[AuthContext, Depends(get_auth_context)],
    ) -> AuthContext:
        if context.user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Seu perfil não possui permissão para esta operação.",
            )
        return context

    return dependency


def require_csrf_roles(*allowed_roles: str):
    def dependency(
        context: Annotated[AuthContext, Depends(require_csrf)],
    ) -> AuthContext:
        if context.user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Seu perfil não possui permissão para esta operação.",
            )
        return context

    return dependency
