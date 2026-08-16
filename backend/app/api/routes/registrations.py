from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...audit import add_audit_log
from ...database import get_db
from ...dependencies import AuthContext, get_auth_context, require_csrf_roles
from ...models import CampaignRegistration, Municipality, utcnow
from ...schemas import (
    RegistrationClusterSummary,
    RegistrationCreate,
    RegistrationImportRequest,
    RegistrationImportResult,
    RegistrationList,
    RegistrationMunicipalitySummary,
    RegistrationOut,
    RegistrationStatus,
    RegistrationSummary,
    RegistrationUpdate,
)
from ...security import hash_secret

router = APIRouter(prefix="/registrations", tags=["registrations"])
PRIVACY_THRESHOLD = 5


def registration_out(
    registration: CampaignRegistration,
    municipality_name: str,
) -> RegistrationOut:
    return RegistrationOut(
        id=registration.id,
        municipality_ibge_code=registration.municipality_ibge_code,
        municipality_name=municipality_name,
        cep_prefix=registration.cep_prefix,
        neighborhood=registration.neighborhood,
        latitude=registration.latitude,
        longitude=registration.longitude,
        geocode_precision=registration.geocode_precision,
        source=registration.source,
        follow_up_status=registration.follow_up_status,
        consent_at=registration.consent_at,
        consent_channel=registration.consent_channel,
        consent_version=registration.consent_version,
        retention_until=registration.retention_until,
        data_origin=registration.data_origin,
        created_at=registration.created_at,
        updated_at=registration.updated_at,
        revoked_at=registration.revoked_at,
    )


def external_reference_hash(value: str | None) -> str | None:
    return hash_secret(value.strip().casefold()) if value else None


def create_registration_record(
    payload: RegistrationCreate,
    *,
    municipality: Municipality,
    user_id: str | None,
    data_origin: str,
) -> CampaignRegistration:
    return CampaignRegistration(
        external_reference_hash=external_reference_hash(payload.external_reference),
        municipality_ibge_code=municipality.ibge_code,
        cep_prefix=payload.cep[:5],
        neighborhood=payload.neighborhood,
        latitude=None if payload.latitude is None else round(payload.latitude, 3),
        longitude=None if payload.longitude is None else round(payload.longitude, 3),
        geocode_precision=payload.geocode_precision,
        source=payload.source,
        follow_up_status=payload.follow_up_status,
        consent_at=payload.consent_at,
        consent_channel=payload.consent_channel,
        consent_version=payload.consent_version,
        retention_until=payload.retention_until,
        data_origin=data_origin,
        created_by_user_id=user_id,
    )


@router.get("", response_model=RegistrationList)
def list_registrations(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
    municipality_ibge_code: str | None = Query(default=None, pattern=r"^\d{7}$"),
    source: str | None = None,
    follow_up_status: RegistrationStatus | None = None,
    include_revoked: bool = False,
    include_expired: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5000),
) -> RegistrationList:
    filters = []
    if municipality_ibge_code:
        filters.append(
            CampaignRegistration.municipality_ibge_code == municipality_ibge_code
        )
    if source:
        if source not in {"field", "event", "digital", "referral"}:
            raise HTTPException(status_code=422, detail="Fonte de cadastro inválida.")
        filters.append(CampaignRegistration.source == source)
    if follow_up_status:
        filters.append(CampaignRegistration.follow_up_status == follow_up_status)
    if not include_revoked:
        filters.extend(
            [
                CampaignRegistration.revoked_at.is_(None),
                CampaignRegistration.follow_up_status != "revoked",
            ]
        )
    if not include_expired:
        filters.append(CampaignRegistration.retention_until >= date.today())

    total = int(
        db.scalar(
            select(func.count()).select_from(CampaignRegistration).where(*filters)
        )
        or 0
    )
    rows = db.execute(
        select(CampaignRegistration, Municipality.name)
        .join(
            Municipality,
            Municipality.ibge_code == CampaignRegistration.municipality_ibge_code,
        )
        .where(*filters)
        .order_by(CampaignRegistration.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return RegistrationList(
        items=[registration_out(item, name) for item, name in rows],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/summary", response_model=RegistrationSummary)
def registration_summary(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> RegistrationSummary:
    rows = list(
        db.execute(
            select(CampaignRegistration, Municipality.name)
            .join(
                Municipality,
                Municipality.ibge_code == CampaignRegistration.municipality_ibge_code,
            )
            .where(
                CampaignRegistration.revoked_at.is_(None),
                CampaignRegistration.follow_up_status != "revoked",
                CampaignRegistration.retention_until >= date.today(),
            )
        )
    )
    municipality_groups: dict[str, list[tuple[CampaignRegistration, str]]] = defaultdict(list)
    cluster_groups: dict[
        tuple[str, str, str], list[tuple[CampaignRegistration, str]]
    ] = defaultdict(list)
    for registration, municipality_name in rows:
        municipality_groups[registration.municipality_ibge_code].append(
            (registration, municipality_name)
        )
        if registration.latitude is not None and registration.longitude is not None:
            cluster_groups[
                (
                    registration.municipality_ibge_code,
                    registration.neighborhood,
                    registration.cep_prefix,
                )
            ].append((registration, municipality_name))

    municipalities = [
        RegistrationMunicipalitySummary(
            municipality_ibge_code=municipality_id,
            municipality_name=group[0][1],
            count=len(group),
            pending_count=sum(
                item.follow_up_status == "pending" for item, _name in group
            ),
        )
        for municipality_id, group in municipality_groups.items()
    ]
    municipalities.sort(key=lambda item: (-item.count, item.municipality_name))

    clusters = []
    suppressed_cluster_count = 0
    for (municipality_id, neighborhood, cep_prefix), group in cluster_groups.items():
        if len(group) < PRIVACY_THRESHOLD:
            suppressed_cluster_count += 1
            continue
        latitudes = [item.latitude for item, _name in group if item.latitude is not None]
        longitudes = [item.longitude for item, _name in group if item.longitude is not None]
        clusters.append(
            RegistrationClusterSummary(
                municipality_ibge_code=municipality_id,
                municipality_name=group[0][1],
                neighborhood=neighborhood,
                cep_prefix=cep_prefix,
                latitude=round(sum(latitudes) / len(latitudes), 3),
                longitude=round(sum(longitudes) / len(longitudes), 3),
                count=len(group),
            )
        )
    clusters.sort(key=lambda item: (-item.count, item.municipality_name, item.neighborhood))

    return RegistrationSummary(
        privacy_threshold=PRIVACY_THRESHOLD,
        total_active=len(rows),
        municipality_count=len(municipalities),
        suppressed_cluster_count=suppressed_cluster_count,
        municipalities=municipalities,
        clusters=clusters,
    )


@router.post("", response_model=RegistrationOut, status_code=status.HTTP_201_CREATED)
def create_registration(
    payload: RegistrationCreate,
    request: Request,
    context: Annotated[
        AuthContext,
        Depends(require_csrf_roles("admin", "coordinator", "field")),
    ],
    db: Annotated[Session, Depends(get_db)],
) -> RegistrationOut:
    municipality = db.get(Municipality, payload.municipality_ibge_code)
    if not municipality:
        raise HTTPException(status_code=404, detail="Município não encontrado.")
    reference_hash = external_reference_hash(payload.external_reference)
    if reference_hash and db.scalar(
        select(CampaignRegistration.id).where(
            CampaignRegistration.external_reference_hash == reference_hash
        )
    ):
        raise HTTPException(status_code=409, detail="A referência externa já foi cadastrada.")
    registration = create_registration_record(
        payload,
        municipality=municipality,
        user_id=context.user.id,
        data_origin="manual",
    )
    db.add(registration)
    db.flush()
    add_audit_log(
        db,
        request,
        action="registration.created",
        resource_type="campaign_registration",
        resource_id=registration.id,
        user_id=context.user.id,
        metadata={
            "municipality_ibge_code": municipality.ibge_code,
            "source": registration.source,
            "has_external_reference": reference_hash is not None,
        },
    )
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="A referência externa já foi cadastrada."
        ) from error
    db.refresh(registration)
    return registration_out(registration, municipality.name)


@router.post(
    "/import",
    response_model=RegistrationImportResult,
    status_code=status.HTTP_201_CREATED,
)
def import_registrations(
    payload: RegistrationImportRequest,
    request: Request,
    context: Annotated[
        AuthContext,
        Depends(require_csrf_roles("admin", "coordinator")),
    ],
    db: Annotated[Session, Depends(get_db)],
) -> RegistrationImportResult:
    municipality_ids = {item.municipality_ibge_code for item in payload.items}
    municipalities = {
        item.ibge_code: item
        for item in db.scalars(
            select(Municipality).where(Municipality.ibge_code.in_(municipality_ids))
        )
    }
    missing = sorted(municipality_ids - municipalities.keys())
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Municípios inexistentes na base: {', '.join(missing)}.",
        )
    hashes = [
        external_reference_hash(item.external_reference)
        for item in payload.items
        if item.external_reference
    ]
    if len(hashes) != len(set(hashes)):
        raise HTTPException(status_code=409, detail="Há referências externas repetidas no arquivo.")
    if hashes and db.scalar(
        select(CampaignRegistration.id).where(
            CampaignRegistration.external_reference_hash.in_(hashes)
        )
    ):
        raise HTTPException(
            status_code=409, detail="Uma referência externa do arquivo já está cadastrada."
        )

    created = [
        create_registration_record(
            item,
            municipality=municipalities[item.municipality_ibge_code],
            user_id=context.user.id,
            data_origin="import",
        )
        for item in payload.items
    ]
    db.add_all(created)
    db.flush()
    add_audit_log(
        db,
        request,
        action="registration.imported",
        resource_type="campaign_registration",
        user_id=context.user.id,
        metadata={"count": len(created), "municipality_count": len(municipality_ids)},
    )
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="O arquivo contém um cadastro já existente."
        ) from error
    for item in created:
        db.refresh(item)
    return RegistrationImportResult(
        imported_count=len(created),
        items=[
            registration_out(item, municipalities[item.municipality_ibge_code].name)
            for item in created
        ],
    )


@router.patch("/{registration_id}", response_model=RegistrationOut)
def update_registration(
    registration_id: str,
    payload: RegistrationUpdate,
    request: Request,
    context: Annotated[
        AuthContext,
        Depends(require_csrf_roles("admin", "coordinator", "field")),
    ],
    db: Annotated[Session, Depends(get_db)],
) -> RegistrationOut:
    row = db.execute(
        select(CampaignRegistration, Municipality.name)
        .join(
            Municipality,
            Municipality.ibge_code == CampaignRegistration.municipality_ibge_code,
        )
        .where(CampaignRegistration.id == registration_id)
    ).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    registration, municipality_name = row
    if (
        context.user.role == "field"
        and registration.created_by_user_id != context.user.id
    ):
        raise HTTPException(
            status_code=403,
            detail="A equipe de campo só pode alterar cadastros criados por ela.",
        )
    if registration.revoked_at is not None:
        raise HTTPException(status_code=409, detail="O consentimento já foi revogado.")

    action = "registration.updated"
    if payload.revoke_consent:
        registration.revoked_at = utcnow()
        registration.follow_up_status = "revoked"
        action = "registration.consent_revoked"
    elif payload.follow_up_status:
        registration.follow_up_status = payload.follow_up_status
    add_audit_log(
        db,
        request,
        action=action,
        resource_type="campaign_registration",
        resource_id=registration.id,
        user_id=context.user.id,
        metadata={"follow_up_status": registration.follow_up_status},
    )
    db.commit()
    db.refresh(registration)
    return registration_out(registration, municipality_name)
