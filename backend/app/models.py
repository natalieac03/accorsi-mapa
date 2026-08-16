from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

USER_ROLES = ("admin", "coordinator", "analyst", "field")


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_uuid() -> str:
    return str(uuid4())


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('admin', 'coordinator', 'analyst', 'field')",
            name="ck_users_role",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(500))
    role: Mapped[str] = mapped_column(String(24), default="analyst", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class Municipality(Base):
    __tablename__ = "municipalities"

    ibge_code: Mapped[str] = mapped_column(String(7), primary_key=True)
    tse_code: Mapped[str | None] = mapped_column(String(8), unique=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    uf: Mapped[str] = mapped_column(String(2), default="GO")
    electorate_2026: Mapped[int] = mapped_column(Integer, default=0)
    state_rank: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class IndicatorDefinition(Base):
    __tablename__ = "indicator_definitions"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    ibge_indicator_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    label: Mapped[str] = mapped_column(String(220))
    short_label: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(80))
    value_format: Mapped[str] = mapped_column(String(24))
    source_name: Mapped[str] = mapped_column(String(220))
    source_url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class MunicipalityIndicatorValue(Base):
    __tablename__ = "municipality_indicator_values"
    __table_args__ = (
        UniqueConstraint(
            "municipality_ibge_code",
            "indicator_code",
            "reference_year",
            name="uq_municipality_indicator_year",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    municipality_ibge_code: Mapped[str] = mapped_column(
        ForeignKey("municipalities.ibge_code", ondelete="CASCADE"), index=True
    )
    indicator_code: Mapped[str] = mapped_column(
        ForeignKey("indicator_definitions.code", ondelete="CASCADE"), index=True
    )
    reference_year: Mapped[int] = mapped_column(Integer, index=True)
    value: Mapped[float] = mapped_column(Float)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ElectionContest(Base):
    __tablename__ = "election_contests"
    __table_args__ = (
        UniqueConstraint(
            "election_year",
            "office_code",
            "round_number",
            name="uq_election_contest_year_office_round",
        ),
        CheckConstraint("round_number IN (1, 2)", name="ck_election_contests_round"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    election_year: Mapped[int] = mapped_column(Integer, index=True)
    office_code: Mapped[int] = mapped_column(Integer, index=True)
    office_name: Mapped[str] = mapped_column(String(80))
    round_number: Mapped[int] = mapped_column(Integer, index=True)
    election_date: Mapped[str] = mapped_column(String(10))
    generated_at_source: Mapped[str] = mapped_column(String(10))
    state_valid_votes: Mapped[int] = mapped_column(Integer)
    municipality_count: Mapped[int] = mapped_column(Integer)
    source_name: Mapped[str] = mapped_column(String(220))
    source_url: Mapped[str] = mapped_column(String(500))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    candidates: Mapped[list[ElectionCandidate]] = relationship(
        back_populates="contest",
        cascade="all, delete-orphan",
        order_by="ElectionCandidate.state_rank",
    )


class ElectionCandidate(Base):
    __tablename__ = "election_candidates"
    __table_args__ = (
        UniqueConstraint(
            "contest_id",
            "tse_candidate_id",
            name="uq_election_candidate_contest_tse",
        ),
    )

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    contest_id: Mapped[str] = mapped_column(
        ForeignKey("election_contests.id", ondelete="CASCADE"), index=True
    )
    tse_candidate_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[str] = mapped_column(String(12))
    ballot_name: Mapped[str] = mapped_column(String(160))
    full_name: Mapped[str] = mapped_column(String(220))
    party: Mapped[str] = mapped_column(String(32), index=True)
    party_name: Mapped[str] = mapped_column(String(220))
    registration_status: Mapped[str] = mapped_column(String(80))
    result_status: Mapped[str] = mapped_column(String(80))
    state_votes: Mapped[int] = mapped_column(Integer)
    state_share_pct: Mapped[float] = mapped_column(Float)
    state_rank: Mapped[int] = mapped_column(Integer)
    municipalities_won: Mapped[int] = mapped_column(Integer)

    contest: Mapped[ElectionContest] = relationship(back_populates="candidates")
    municipality_results: Mapped[list[MunicipalityElectionResult]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )


class MunicipalityElectionResult(Base):
    __tablename__ = "municipality_election_results"
    __table_args__ = (
        UniqueConstraint(
            "contest_id",
            "candidate_id",
            "municipality_ibge_code",
            name="uq_municipality_election_candidate",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contest_id: Mapped[str] = mapped_column(
        ForeignKey("election_contests.id", ondelete="CASCADE"), index=True
    )
    candidate_id: Mapped[str] = mapped_column(
        ForeignKey("election_candidates.id", ondelete="CASCADE"), index=True
    )
    municipality_ibge_code: Mapped[str] = mapped_column(
        ForeignKey("municipalities.ibge_code", ondelete="CASCADE"), index=True
    )
    votes: Mapped[int] = mapped_column(Integer)
    valid_votes: Mapped[int] = mapped_column(Integer)
    share_pct: Mapped[float] = mapped_column(Float)
    won_municipality: Mapped[bool] = mapped_column(Boolean, default=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    candidate: Mapped[ElectionCandidate] = relationship(
        back_populates="municipality_results"
    )


class CampaignRegistration(Base):
    __tablename__ = "campaign_registrations"
    __table_args__ = (
        UniqueConstraint(
            "external_reference_hash",
            name="uq_campaign_registrations_external_reference_hash",
        ),
        CheckConstraint(
            "source IN ('field', 'event', 'digital', 'referral')",
            name="ck_campaign_registrations_source",
        ),
        CheckConstraint(
            "follow_up_status IN ('pending', 'contacted', 'completed', 'revoked')",
            name="ck_campaign_registrations_follow_up_status",
        ),
        CheckConstraint(
            "geocode_precision IN ('cep_centroid', 'neighborhood', 'municipality')",
            name="ck_campaign_registrations_geocode_precision",
        ),
        CheckConstraint(
            "data_origin IN ('manual', 'import', 'synthetic-demo')",
            name="ck_campaign_registrations_data_origin",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    external_reference_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    municipality_ibge_code: Mapped[str] = mapped_column(
        ForeignKey("municipalities.ibge_code", ondelete="RESTRICT"), index=True
    )
    cep_prefix: Mapped[str] = mapped_column(String(5), index=True)
    neighborhood: Mapped[str] = mapped_column(String(160), index=True)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    geocode_precision: Mapped[str] = mapped_column(String(24), default="municipality")
    source: Mapped[str] = mapped_column(String(24), index=True)
    follow_up_status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consent_channel: Mapped[str] = mapped_column(String(80))
    consent_version: Mapped[str] = mapped_column(String(40))
    retention_until: Mapped[date] = mapped_column(index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    data_origin: Mapped[str] = mapped_column(String(24), default="manual", index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    municipality: Mapped[Municipality] = relationship()


class PartySpectrumScore(Base):
    __tablename__ = "party_spectrum_scores"
    __table_args__ = (
        UniqueConstraint(
            "party_code",
            "wave_year",
            name="uq_party_spectrum_scores_party_wave",
        ),
        CheckConstraint("score >= 0 AND score <= 10", name="ck_party_spectrum_scores_score"),
        CheckConstraint(
            "block IN ('left', 'center', 'right')",
            name="ck_party_spectrum_scores_block",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    party_code: Mapped[str] = mapped_column(String(40), index=True)
    party_name: Mapped[str] = mapped_column(String(220))
    tse_numbers: Mapped[list[int]] = mapped_column(JSON, default=list)
    wave_year: Mapped[int] = mapped_column(Integer, index=True)
    score: Mapped[float] = mapped_column(Float)
    block: Mapped[str] = mapped_column(String(16), index=True)
    is_derived: Mapped[bool] = mapped_column(Boolean, default=False)
    derived_from: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_institution: Mapped[str] = mapped_column(String(220))
    source_citation: Mapped[str] = mapped_column(Text)
    source_doi: Mapped[str] = mapped_column(String(120))
    source_url: Mapped[str] = mapped_column(String(500))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PartyAlias(Base):
    __tablename__ = "party_aliases"
    __table_args__ = (UniqueConstraint("alias", name="uq_party_aliases_alias"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alias: Mapped[str] = mapped_column(String(60), index=True)
    party_code: Mapped[str] = mapped_column(String(40), index=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SpectrumSetting(Base):
    __tablename__ = "spectrum_settings"
    __table_args__ = (
        CheckConstraint(
            "key IN ('registry', 'scale', 'block_thresholds', "
            "'wave_by_election_year', 'waves')",
            name="ck_spectrum_settings_key",
        ),
    )

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class ImportRun(Base):
    __tablename__ = "import_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'succeeded', 'failed')",
            name="ck_import_runs_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    source: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)
    row_count: Mapped[int | None] = mapped_column(Integer)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    error_summary: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(100), index=True)
    resource_type: Mapped[str] = mapped_column(String(80), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(160))
    request_id: Mapped[str | None] = mapped_column(String(36), index=True)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


Index("ix_audit_resource", AuditLog.resource_type, AuditLog.resource_id)
Index(
    "ix_municipality_election_contest_municipality",
    MunicipalityElectionResult.contest_id,
    MunicipalityElectionResult.municipality_ibge_code,
)
Index(
    "ix_party_spectrum_scores_wave_party",
    PartySpectrumScore.wave_year,
    PartySpectrumScore.party_code,
)
