from __future__ import annotations

from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...database import get_db
from ...dependencies import AuthContext, get_auth_context
from ...models import IndicatorDefinition, Municipality, MunicipalityIndicatorValue
from ...schemas import (
    IndicatorCatalogItem,
    IndicatorDefinitionOut,
    IndicatorMunicipalitySeries,
    IndicatorMunicipalityValue,
)

router = APIRouter(prefix="/indicators", tags=["indicators"])


@router.get("", response_model=list[IndicatorCatalogItem])
def list_indicator_catalog(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> list[IndicatorCatalogItem]:
    definitions = list(db.scalars(select(IndicatorDefinition).order_by(IndicatorDefinition.label)))
    coverage_rows = db.execute(
        select(
            MunicipalityIndicatorValue.indicator_code,
            MunicipalityIndicatorValue.reference_year,
            func.count(MunicipalityIndicatorValue.id),
        )
        .group_by(
            MunicipalityIndicatorValue.indicator_code,
            MunicipalityIndicatorValue.reference_year,
        )
        .order_by(MunicipalityIndicatorValue.reference_year.desc())
    )
    coverage: dict[str, dict[int, int]] = defaultdict(dict)
    for indicator_code, reference_year, count in coverage_rows:
        coverage[str(indicator_code)][int(reference_year)] = int(count)

    return [
        IndicatorCatalogItem(
            **IndicatorDefinitionOut.model_validate(definition).model_dump(),
            available_years=sorted(coverage[definition.code], reverse=True),
            coverage_by_year=coverage[definition.code],
        )
        for definition in definitions
    ]


@router.get("/{indicator_code}/municipalities", response_model=IndicatorMunicipalitySeries)
def list_indicator_municipalities(
    indicator_code: str,
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
    year: int | None = Query(default=None, ge=1900, le=2200),
) -> IndicatorMunicipalitySeries:
    definition = db.get(IndicatorDefinition, indicator_code)
    if not definition:
        raise HTTPException(status_code=404, detail="Indicador não encontrado.")

    reference_year = year or db.scalar(
        select(func.max(MunicipalityIndicatorValue.reference_year)).where(
            MunicipalityIndicatorValue.indicator_code == indicator_code
        )
    )
    if reference_year is None:
        raise HTTPException(status_code=404, detail="Indicador ainda não possui valores.")

    rows = db.execute(
        select(
            MunicipalityIndicatorValue.municipality_ibge_code,
            Municipality.name,
            MunicipalityIndicatorValue.value,
        )
        .join(
            Municipality,
            Municipality.ibge_code == MunicipalityIndicatorValue.municipality_ibge_code,
        )
        .where(
            MunicipalityIndicatorValue.indicator_code == indicator_code,
            MunicipalityIndicatorValue.reference_year == reference_year,
        )
        .order_by(Municipality.name)
    )
    items = [
        IndicatorMunicipalityValue(
            ibge_code=str(ibge_code), municipality_name=str(name), value=float(value)
        )
        for ibge_code, name, value in rows
    ]
    municipality_count = int(
        db.scalar(select(func.count()).select_from(Municipality).where(Municipality.uf == "GO"))
        or 0
    )
    return IndicatorMunicipalitySeries(
        indicator=IndicatorDefinitionOut.model_validate(definition),
        reference_year=int(reference_year),
        coverage_count=len(items),
        missing_count=max(0, municipality_count - len(items)),
        items=items,
    )
