from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ...audit import add_audit_log
from ...database import get_db
from ...dependencies import AuthContext, require_csrf_roles, require_roles
from ...models import AuthSession, User, utcnow
from ...schemas import UserCreate, UserOut, UserUpdate
from ...security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(
    _context: Annotated[AuthContext, Depends(require_roles("admin"))],
    db: Annotated[Session, Depends(get_db)],
) -> list[User]:
    return list(db.scalars(select(User).order_by(User.full_name, User.email)))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    context: Annotated[AuthContext, Depends(require_csrf_roles("admin"))],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if db.scalar(select(User.id).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail.")

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()
    add_audit_log(
        db,
        request,
        action="user.created",
        resource_type="user",
        resource_id=user.id,
        user_id=context.user.id,
        metadata={"role": user.role},
    )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    payload: UserUpdate,
    request: Request,
    context: Annotated[AuthContext, Depends(require_csrf_roles("admin"))],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    if user.id == context.user.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="Você não pode desativar sua própria conta.")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="Informe ao menos uma alteração.")
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=400, detail="Os campos alterados não podem ser nulos.")
    removes_active_admin = (
        user.role == "admin"
        and user.is_active
        and (
            changes.get("is_active") is False or ("role" in changes and changes["role"] != "admin")
        )
    )
    if removes_active_admin:
        active_admins = int(
            db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.role == "admin", User.is_active.is_(True))
            )
            or 0
        )
        if active_admins <= 1:
            raise HTTPException(
                status_code=400,
                detail="Não é possível remover o último administrador ativo.",
            )

    for field, value in changes.items():
        setattr(user, field, value)
    if changes.get("is_active") is False:
        db.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=utcnow())
        )
    add_audit_log(
        db,
        request,
        action="user.updated",
        resource_type="user",
        resource_id=user.id,
        user_id=context.user.id,
        metadata={"fields": sorted(changes)},
    )
    db.commit()
    db.refresh(user)
    return user
