from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...database import get_db
from ...dependencies import AuthContext, require_roles
from ...models import AuditLog
from ...schemas import AuditLogList

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=AuditLogList)
def list_audit_logs(
    _context: Annotated[AuthContext, Depends(require_roles("admin"))],
    db: Annotated[Session, Depends(get_db)],
    action: str | None = Query(default=None, max_length=100),
    resource_type: str | None = Query(default=None, max_length=80),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
) -> AuditLogList:
    filters = []
    if action:
        filters.append(AuditLog.action == action.strip())
    if resource_type:
        filters.append(AuditLog.resource_type == resource_type.strip())

    total = int(db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0)
    items = list(
        db.scalars(
            select(AuditLog)
            .where(*filters)
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .offset(offset)
            .limit(limit)
        )
    )
    return AuditLogList(items=items, total=total, offset=offset, limit=limit)
