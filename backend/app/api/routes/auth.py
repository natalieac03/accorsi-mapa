from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ...audit import add_audit_log
from ...config import get_settings
from ...database import get_db
from ...dependencies import AuthContext, get_auth_context, require_csrf
from ...models import AuthSession, User, utcnow
from ...schemas import (
    ApiMessage,
    AuthResponse,
    ChangePasswordRequest,
    LoginRequest,
    normalize_email,
)
from ...security import (
    DUMMY_PASSWORD_HASH,
    clear_auth_cookies,
    create_token,
    hash_password,
    hash_secret,
    login_throttle,
    session_expiry,
    set_auth_cookies,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _throttle_key(request: Request, email: str) -> str:
    client = request.client.host if request.client else "unknown"
    return hash_secret(f"{client}|{normalize_email(email)}")


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    key = _throttle_key(request, payload.email)
    if not login_throttle.allowed(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas. Aguarde alguns minutos.",
            headers={"Retry-After": str(get_settings().login_window_minutes * 60)},
        )

    user = db.scalar(select(User).where(User.email == payload.email))
    encoded = user.password_hash if user else DUMMY_PASSWORD_HASH
    password_ok = verify_password(payload.password, encoded)

    if not user or not password_ok or not user.is_active:
        login_throttle.record_failure(key)
        add_audit_log(
            db,
            request,
            action="auth.login_failed",
            resource_type="auth",
            user_id=user.id if user else None,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-mail ou senha inválidos.",
        )

    login_throttle.clear(key)
    raw_session = create_token()
    raw_csrf = create_token()
    user.last_login_at = utcnow()
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=hash_secret(raw_session),
        csrf_hash=hash_secret(raw_csrf),
        expires_at=session_expiry(),
    )
    db.add(auth_session)
    add_audit_log(
        db,
        request,
        action="auth.login_succeeded",
        resource_type="auth",
        resource_id=auth_session.id,
        user_id=user.id,
    )
    db.commit()
    set_auth_cookies(response, session_token=raw_session, csrf_token=raw_csrf)
    return AuthResponse(user=user)


@router.get("/me", response_model=AuthResponse)
def me(
    context: Annotated[AuthContext, Depends(get_auth_context)],
) -> AuthResponse:
    return AuthResponse(user=context.user)


@router.post("/logout", response_model=ApiMessage)
def logout(
    request: Request,
    response: Response,
    context: Annotated[AuthContext, Depends(require_csrf)],
    db: Annotated[Session, Depends(get_db)],
) -> ApiMessage:
    context.session.revoked_at = utcnow()
    add_audit_log(
        db,
        request,
        action="auth.logout",
        resource_type="auth",
        resource_id=context.session.id,
        user_id=context.user.id,
    )
    db.commit()
    clear_auth_cookies(response)
    return ApiMessage(message="Sessão encerrada.")


@router.post("/change-password", response_model=ApiMessage)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    context: Annotated[AuthContext, Depends(require_csrf)],
    db: Annotated[Session, Depends(get_db)],
) -> ApiMessage:
    if not verify_password(payload.current_password, context.user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Senha atual incorreta.",
        )

    context.user.password_hash = hash_password(payload.new_password)
    db.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == context.user.id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    add_audit_log(
        db,
        request,
        action="auth.password_changed",
        resource_type="user",
        resource_id=context.user.id,
        user_id=context.user.id,
    )
    db.commit()
    clear_auth_cookies(response)
    return ApiMessage(message="Senha alterada. Entre novamente.")
