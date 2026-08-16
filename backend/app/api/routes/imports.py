from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...database import get_db
from ...dependencies import AuthContext, require_roles
from ...models import ImportRun
from ...schemas import ImportRunOut

router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("", response_model=list[ImportRunOut])
def list_import_runs(
    _context: Annotated[
        AuthContext,
        Depends(require_roles("admin", "coordinator", "analyst")),
    ],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=20, ge=1, le=100),
) -> list[ImportRun]:
    return list(db.scalars(select(ImportRun).order_by(ImportRun.started_at.desc()).limit(limit)))
