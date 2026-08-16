from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Role = Literal["admin", "coordinator", "analyst", "field"]
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_email(value: str) -> str:
    normalized = value.strip().casefold()
    if len(normalized) > 320 or not EMAIL_PATTERN.fullmatch(normalized):
        raise ValueError("Informe um e-mail válido.")
    return normalized


def validate_password(value: str) -> str:
    if len(value) < 12:
        raise ValueError("A senha deve ter pelo menos 12 caracteres.")
    if len(value) > 128:
        raise ValueError("A senha deve ter no máximo 128 caracteres.")
    classes = sum(
        bool(pattern.search(value))
        for pattern in (
            re.compile(r"[a-z]"),
            re.compile(r"[A-Z]"),
            re.compile(r"\d"),
            re.compile(r"[^A-Za-z0-9]"),
        )
    )
    if classes < 3:
        raise ValueError("Use pelo menos três tipos: minúscula, maiúscula, número e símbolo.")
    return value


def normalize_full_name(value: str) -> str:
    normalized = " ".join(value.split())
    if not 2 <= len(normalized) <= 160:
        raise ValueError("O nome precisa ter entre 2 e 160 caracteres.")
    return normalized


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)

    _normalize_email = field_validator("email")(normalize_email)


class UserCreate(BaseModel):
    email: str
    full_name: str = Field(min_length=2, max_length=160)
    password: str
    role: Role = "analyst"

    _normalize_email = field_validator("email")(normalize_email)
    _normalize_full_name = field_validator("full_name")(normalize_full_name)
    _validate_password = field_validator("password")(validate_password)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    role: Role | None = None
    is_active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def normalize_optional_full_name(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("O nome não pode ser nulo.")
        return normalize_full_name(value)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str

    _validate_password = field_validator("new_password")(validate_password)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    full_name: str
    role: Role
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class AuthResponse(BaseModel):
    user: UserOut


class MunicipalityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ibge_code: str
    tse_code: str | None
    name: str
    uf: str
    electorate_2026: int
    state_rank: int | None


class MunicipalityList(BaseModel):
    items: list[MunicipalityOut]
    total: int
    offset: int
    limit: int


class IndicatorDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    ibge_indicator_id: int
    label: str
    short_label: str
    description: str
    unit: str
    value_format: str
    source_name: str
    source_url: str


class IndicatorCatalogItem(IndicatorDefinitionOut):
    available_years: list[int]
    coverage_by_year: dict[int, int]


class MunicipalityIndicatorOut(IndicatorDefinitionOut):
    reference_year: int
    value: float


class MunicipalityIndicatorList(BaseModel):
    ibge_code: str
    municipality_name: str
    items: list[MunicipalityIndicatorOut]


class IndicatorMunicipalityValue(BaseModel):
    ibge_code: str
    municipality_name: str
    value: float


class IndicatorMunicipalitySeries(BaseModel):
    indicator: IndicatorDefinitionOut
    reference_year: int
    coverage_count: int
    missing_count: int
    items: list[IndicatorMunicipalityValue]


class ElectionCandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tse_candidate_id: str
    number: str
    ballot_name: str
    full_name: str
    party: str
    party_name: str
    registration_status: str
    result_status: str
    state_votes: int
    state_share_pct: float
    state_rank: int
    municipalities_won: int


class ElectionContestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    election_year: int
    office_code: int
    office_name: str
    round_number: int
    election_date: str
    state_valid_votes: int
    municipality_count: int
    source_name: str
    source_url: str
    candidates: list[ElectionCandidateOut]


class ElectionMunicipalityValue(BaseModel):
    ibge_code: str
    municipality_name: str
    votes: int
    valid_votes: int
    share_pct: float
    won_municipality: bool


class ElectionCandidateMunicipalitySeries(BaseModel):
    contest: ElectionContestOut
    candidate: ElectionCandidateOut
    coverage_count: int
    items: list[ElectionMunicipalityValue]


class MunicipalityElectionCandidateResult(BaseModel):
    candidate: ElectionCandidateOut
    votes: int
    valid_votes: int
    share_pct: float
    won_municipality: bool


class MunicipalityElectionContestResult(BaseModel):
    contest_id: str
    election_year: int
    office_name: str
    round_number: int
    election_date: str
    results: list[MunicipalityElectionCandidateResult]


class MunicipalityElectionHistory(BaseModel):
    ibge_code: str
    municipality_name: str
    contests: list[MunicipalityElectionContestResult]


SpectrumBlock = Literal["left", "center", "right"]


class SpectrumScaleOut(BaseModel):
    minimum: float
    maximum: float
    minimum_label: str
    maximum_label: str


class SpectrumBlockThresholdsOut(BaseModel):
    left_maximum: float
    right_minimum: float
    rationale: str


class SpectrumWaveOut(BaseModel):
    year: int
    respondents: int
    institution: str
    citation: str
    doi: str
    url: str


class PartySpectrumScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    wave_year: int
    score: float
    block: SpectrumBlock
    is_derived: bool
    derived_from: list[str]
    source_institution: str
    source_citation: str
    source_doi: str
    source_url: str


class PartySpectrumOut(BaseModel):
    code: str
    name: str
    tse_numbers: list[int]
    aliases: list[str]
    scores: list[PartySpectrumScoreOut]


class PartySpectrumRegistry(BaseModel):
    schema_version: int
    title: str
    description: str
    scale: SpectrumScaleOut
    block_thresholds: SpectrumBlockThresholdsOut
    wave_by_election_year: dict[int, int]
    waves: list[SpectrumWaveOut]
    limitations: list[str]
    parties: list[PartySpectrumOut]


class SpectrumContestOut(BaseModel):
    contest_id: str
    election_year: int
    office_code: int
    office_name: str
    round_number: int
    election_date: str
    state_valid_votes: int
    municipality_count: int
    wave_year: int


class SpectrumUnscoredParty(BaseModel):
    party: str
    votes: int


class SpectrumBlockShares(BaseModel):
    left_votes: int
    center_votes: int
    right_votes: int
    left_pct: float
    center_pct: float
    right_pct: float


class SpectrumMunicipalityIndex(BaseModel):
    ibge_code: str
    municipality_name: str
    spectrum_index: float | None
    total_votes: int
    scored_votes: int
    unscored_votes: int
    coverage_pct: float
    blocks: SpectrumBlockShares
    unscored_parties: list[SpectrumUnscoredParty]


class SpectrumMunicipalitySeries(BaseModel):
    contest: SpectrumContestOut
    wave_year: int
    scale: SpectrumScaleOut
    block_thresholds: SpectrumBlockThresholdsOut
    coverage_count: int
    missing_count: int
    items: list[SpectrumMunicipalityIndex]


RegistrationSource = Literal["field", "event", "digital", "referral"]
RegistrationStatus = Literal["pending", "contacted", "completed", "revoked"]
RegistrationWriteStatus = Literal["pending", "contacted", "completed"]
GeocodePrecision = Literal["cep_centroid", "neighborhood", "municipality"]


class RegistrationCreate(BaseModel):
    external_reference: str | None = Field(default=None, max_length=200)
    municipality_ibge_code: str = Field(pattern=r"^\d{7}$")
    cep: str = Field(min_length=8, max_length=9)
    neighborhood: str = Field(min_length=1, max_length=160)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geocode_precision: GeocodePrecision = "municipality"
    source: RegistrationSource
    follow_up_status: RegistrationWriteStatus = "pending"
    consent_at: datetime
    consent_channel: str = Field(min_length=2, max_length=80)
    consent_version: str = Field(min_length=1, max_length=40)
    retention_until: date

    @field_validator("external_reference")
    @classmethod
    def normalize_external_reference(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("neighborhood", "consent_channel", "consent_version")
    @classmethod
    def normalize_registration_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("O campo não pode ficar vazio.")
        return normalized

    @field_validator("cep")
    @classmethod
    def normalize_cep(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if len(digits) != 8:
            raise ValueError("O CEP precisa ter 8 números.")
        if not digits.startswith("9"):
            raise ValueError("O CEP precisa pertencer ao Goiás.")
        return digits

    @model_validator(mode="after")
    def validate_registration_dates_and_coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude e longitude devem ser informadas juntas.")
        if self.consent_at.tzinfo is None:
            raise ValueError("O horário do consentimento precisa informar o fuso.")
        if self.consent_at > datetime.now(UTC) + timedelta(minutes=5):
            raise ValueError("O consentimento não pode estar no futuro.")
        if self.retention_until < self.consent_at.date():
            raise ValueError("A retenção não pode terminar antes do consentimento.")
        if self.geocode_precision != "municipality" and self.latitude is None:
            raise ValueError("A precisão informada exige coordenadas.")
        if self.latitude is not None and self.longitude is not None and not (
            -34.1 <= self.latitude <= -26.8 and -57.8 <= self.longitude <= -49.5
        ):
            raise ValueError("As coordenadas precisam estar em Goiás.")
        return self


class RegistrationUpdate(BaseModel):
    follow_up_status: RegistrationWriteStatus | None = None
    revoke_consent: bool = False

    @model_validator(mode="after")
    def validate_update(self):
        if self.follow_up_status is None and not self.revoke_consent:
            raise ValueError("Informe um novo acompanhamento ou revogue o consentimento.")
        if self.follow_up_status is not None and self.revoke_consent:
            raise ValueError("Atualize o acompanhamento ou revogue, não os dois ao mesmo tempo.")
        return self


class RegistrationOut(BaseModel):
    id: str
    municipality_ibge_code: str
    municipality_name: str
    cep_prefix: str
    neighborhood: str
    latitude: float | None
    longitude: float | None
    geocode_precision: GeocodePrecision
    source: RegistrationSource
    follow_up_status: RegistrationStatus
    consent_at: datetime
    consent_channel: str
    consent_version: str
    retention_until: date
    data_origin: Literal["manual", "import", "synthetic-demo"]
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None


class RegistrationList(BaseModel):
    items: list[RegistrationOut]
    total: int
    offset: int
    limit: int


class RegistrationImportRequest(BaseModel):
    items: list[RegistrationCreate] = Field(min_length=1, max_length=1000)


class RegistrationImportResult(BaseModel):
    imported_count: int
    items: list[RegistrationOut]


class RegistrationMunicipalitySummary(BaseModel):
    municipality_ibge_code: str
    municipality_name: str
    count: int
    pending_count: int


class RegistrationClusterSummary(BaseModel):
    municipality_ibge_code: str
    municipality_name: str
    neighborhood: str
    cep_prefix: str
    latitude: float
    longitude: float
    count: int


class RegistrationSummary(BaseModel):
    privacy_threshold: int
    total_active: int
    municipality_count: int
    suppressed_cluster_count: int
    municipalities: list[RegistrationMunicipalitySummary]
    clusters: list[RegistrationClusterSummary]


class ImportRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str
    status: Literal["running", "succeeded", "failed"]
    row_count: int | None
    checksum_sha256: str | None
    error_summary: str | None
    started_at: datetime
    finished_at: datetime | None


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: str | None
    action: str
    resource_type: str
    resource_id: str | None
    request_id: str | None
    metadata_json: dict[str, object]
    created_at: datetime


class AuditLogList(BaseModel):
    items: list[AuditLogOut]
    total: int
    offset: int
    limit: int


class ApiMessage(BaseModel):
    message: str


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
