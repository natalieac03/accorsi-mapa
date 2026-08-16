from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from .models import AuditLog


def add_audit_log(
    db: Session,
    request: Request,
    *,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    user_id: str | None = None,
    metadata: dict[str, object] | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            request_id=getattr(request.state, "request_id", None),
            metadata_json=metadata or {},
        )
    )
