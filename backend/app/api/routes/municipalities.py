from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...database import get_db
from ...dependencies import AuthContext, get_auth_context
from ...models import IndicatorDefinition, Municipality, MunicipalityIndicatorValue
from ...schemas import (
    IndicatorDefinitionOut,
    MunicipalityIndicatorList,
    MunicipalityIndicatorOut,
    MunicipalityList,
    MunicipalityOut,
)

router = APIRouter(prefix="/municipalities", tags=["municipalities"])


@router.get("", response_model=MunicipalityList)
def list_municipalities(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
    q: str | None = Query(default=None, max_length=100),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
) -> MunicipalityList:
    filters = []
    if q and q.strip():
        filters.append(func.lower(Municipality.name).like(f"%{q.strip().lower()}%"))

    count_statement = select(func.count()).select_from(Municipality).where(*filters)
    total = int(db.scalar(count_statement) or 0)
    statement = (
        select(Municipality).where(*filters).order_by(Municipality.name).offset(offset).limit(limit)
    )
    items = list(db.scalars(statement))
    return MunicipalityList(items=items, total=total, offset=offset, limit=limit)


@router.get("/{ibge_code}", response_model=MunicipalityOut)
def get_municipality(
    ibge_code: str,
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> Municipality:
    municipality = db.get(Municipality, ibge_code)
    if not municipality:
        raise HTTPException(status_code=404, detail="Município não encontrado.")
    return municipality


@router.get("/{ibge_code}/indicators", response_model=MunicipalityIndicatorList)
def get_municipality_indicators(
    ibge_code: str,
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> MunicipalityIndicatorList:
    municipality = db.get(Municipality, ibge_code)
    if not municipality:
        raise HTTPException(status_code=404, detail="Município não encontrado.")

    rows = db.execute(
        select(IndicatorDefinition, MunicipalityIndicatorValue)
        .join(
            MunicipalityIndicatorValue,
            MunicipalityIndicatorValue.indicator_code == IndicatorDefinition.code,
        )
        .where(MunicipalityIndicatorValue.municipality_ibge_code == ibge_code)
        .order_by(IndicatorDefinition.label, MunicipalityIndicatorValue.reference_year.desc())
    )
    items = [
        MunicipalityIndicatorOut(
            **IndicatorDefinitionOut.model_validate(definition).model_dump(),
            reference_year=value.reference_year,
            value=value.value,
        )
        for definition, value in rows
    ]
    return MunicipalityIndicatorList(
        ibge_code=municipality.ibge_code,
        municipality_name=municipality.name,
        items=items,
    )
