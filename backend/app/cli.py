from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import math
import os
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import delete, select, update

from .database import SessionLocal
from .models import (
    AuditLog,
    AuthSession,
    CampaignRegistration,
    ElectionCandidate,
    ElectionContest,
    ImportRun,
    IndicatorDefinition,
    Municipality,
    MunicipalityElectionResult,
    MunicipalityIndicatorValue,
    PartyAlias,
    PartySpectrumScore,
    SpectrumSetting,
    User,
    utcnow,
)
from .schemas import normalize_email, normalize_full_name, validate_password
from .security import hash_password

SPECTRUM_SCHEMA_VERSIONS = (1,)


def read_password(environment_variable: str | None) -> str:
    if environment_variable:
        value = os.getenv(environment_variable)
        if not value:
            raise SystemExit(f"A variável {environment_variable} não foi definida.")
        return validate_password(value)

    first = getpass.getpass("Senha (mínimo 12 caracteres): ")
    second = getpass.getpass("Repita a senha: ")
    if first != second:
        raise SystemExit("As senhas não coincidem.")
    return validate_password(first)


def create_user(args: argparse.Namespace) -> None:
    email = normalize_email(args.email)
    full_name = normalize_full_name(args.name)
    password = read_password(args.password_env)
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == email)):
            raise SystemExit("Já existe um usuário com este e-mail.")
        user = User(
            email=email,
            full_name=full_name,
            role=args.role,
            password_hash=hash_password(password),
        )
        db.add(user)
        db.flush()
        db.add(
            AuditLog(
                user_id=user.id,
                action="system.user_created",
                resource_type="user",
                resource_id=user.id,
                metadata_json={"role": user.role, "source": "cli"},
            )
        )
        db.commit()
        print(f"Usuário criado: {user.email} ({user.role})")


def seed_municipalities(args: argparse.Namespace) -> None:
    source = Path(args.file).resolve()
    source_bytes = source.read_bytes()
    payload = json.loads(source_bytes.decode("utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("O arquivo precisa conter um objeto JSON.")
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise SystemExit("Metadados eleitorais ausentes ou inválidos.")
    if (
        metadata.get("state") != "GO"
        or int(metadata.get("year", -1)) != 2026
        or int(metadata.get("municipalityCount", -1)) != 246
    ):
        raise SystemExit("Os metadados não correspondem ao recorte GO/2026 com 246 municípios.")
    records = payload.get("municipalities")
    if not isinstance(records, dict) or len(records) != 246:
        raise SystemExit("O JSON precisa conter exatamente os 246 municípios validados.")

    normalized_records: list[dict[str, object]] = []
    tse_codes: set[str] = set()
    municipality_names: set[str] = set()
    for key, raw in records.items():
        if not isinstance(raw, dict):
            raise SystemExit("Há um registro municipal inválido no JSON.")
        ibge_code = str(raw.get("ibgeCode", ""))
        tse_code = str(raw.get("tseCode", ""))
        if key != ibge_code or len(ibge_code) != 7 or not ibge_code.isdigit():
            raise SystemExit(f"Código IBGE inválido ou divergente: {key}.")
        if not tse_code or tse_code in tse_codes:
            raise SystemExit(f"Código TSE ausente ou duplicado em {ibge_code}.")
        tse_codes.add(tse_code)
        try:
            electorate = int(raw["electorate"])
            state_rank = int(raw["stateRank"])
        except (KeyError, TypeError, ValueError) as error:
            raise SystemExit(f"Indicadores inválidos em {ibge_code}.") from error
        if electorate < 0 or not 1 <= state_rank <= 246:
            raise SystemExit(f"Indicadores fora do intervalo em {ibge_code}.")
        name = str(raw.get("name", "")).strip()
        normalized_name = name.casefold()
        if not name:
            raise SystemExit(f"Município sem nome em {ibge_code}.")
        if normalized_name in municipality_names:
            raise SystemExit(f"Nome municipal duplicado: {name}.")
        municipality_names.add(normalized_name)
        normalized_records.append(raw)

    expected_total = int(metadata.get("stateElectorate", -1))
    actual_total = sum(int(raw["electorate"]) for raw in normalized_records)
    if expected_total != actual_total:
        raise SystemExit(
            f"O total estadual diverge: metadado {expected_total}, soma {actual_total}."
        )

    checksum = hashlib.sha256(source_bytes).hexdigest()

    with SessionLocal() as db:
        import_run = ImportRun(
            source="tse_electorate_2026",
            status="running",
            row_count=0,
            checksum_sha256=checksum,
        )
        db.add(import_run)
        db.commit()

        try:
            for raw in normalized_records:
                ibge_code = str(raw["ibgeCode"])
                municipality = db.get(Municipality, ibge_code)
                if not municipality:
                    municipality = Municipality(ibge_code=ibge_code)
                    db.add(municipality)
                municipality.tse_code = str(raw["tseCode"])
                municipality.name = str(raw["name"])
                municipality.uf = "GO"
                municipality.electorate_2026 = int(raw["electorate"])
                municipality.state_rank = int(raw["stateRank"])
            import_run.status = "succeeded"
            import_run.row_count = len(normalized_records)
            import_run.finished_at = utcnow()
            db.commit()
        except Exception as error:
            db.rollback()
            failed_run = db.get(ImportRun, import_run.id)
            if failed_run:
                failed_run.status = "failed"
                failed_run.error_summary = str(error)[:1000]
                failed_run.finished_at = utcnow()
                db.commit()
            raise
    print("Municípios sincronizados: 246/246.")


def import_ibge_indicators(args: argparse.Namespace) -> None:
    source = Path(args.file).resolve()
    source_bytes = source.read_bytes()
    payload = json.loads(source_bytes.decode("utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("O arquivo IBGE precisa conter um objeto JSON.")

    metadata = payload.get("metadata")
    records = payload.get("municipalities")
    if not isinstance(metadata, dict) or not isinstance(records, dict):
        raise SystemExit("Metadados ou municípios da base IBGE estão ausentes.")
    if (
        metadata.get("state") != "GO"
        or int(metadata.get("municipalityCount", -1)) != 246
        or len(records) != 246
    ):
        raise SystemExit("A base IBGE precisa conter exatamente os 246 municípios de Goiás.")

    raw_definitions = metadata.get("indicators")
    if not isinstance(raw_definitions, list) or not raw_definitions:
        raise SystemExit("O catálogo de indicadores IBGE está ausente.")
    if int(metadata.get("indicatorCount", -1)) != len(raw_definitions):
        raise SystemExit("A quantidade de indicadores diverge dos metadados.")

    definitions: dict[str, dict[str, object]] = {}
    ibge_ids: set[int] = set()
    valid_formats = {"integer", "decimal", "currency", "percent"}
    for raw in raw_definitions:
        if not isinstance(raw, dict):
            raise SystemExit("Há uma definição de indicador inválida.")
        code = str(raw.get("code", ""))
        try:
            ibge_id = int(raw["ibgeIndicatorId"])
            year = int(raw["referenceYear"])
            coverage = int(raw["coverageCount"])
        except (KeyError, TypeError, ValueError) as error:
            indicator_label = code or "?"
            raise SystemExit(
                f"Metadados numéricos inválidos no indicador {indicator_label}."
            ) from error
        value_format = str(raw.get("valueFormat", ""))
        if (
            not code
            or code in definitions
            or ibge_id in ibge_ids
            or not 1900 <= year <= 2200
            or not 0 <= coverage <= 246
            or value_format not in valid_formats
        ):
            raise SystemExit(f"Definição inválida ou duplicada: {code or ibge_id}.")
        for field in ("label", "shortLabel", "description", "unit"):
            if not str(raw.get(field, "")).strip():
                raise SystemExit(f"Campo {field} ausente no indicador {code}.")
        definitions[code] = raw
        ibge_ids.add(ibge_id)

    normalized_values: list[dict[str, object]] = []
    coverage_by_code = {code: 0 for code in definitions}
    missing_by_code = {code: [] for code in definitions}
    for key, raw_record in records.items():
        if not isinstance(raw_record, dict):
            raise SystemExit(f"Registro IBGE inválido: {key}.")
        ibge_code = str(raw_record.get("ibgeCode", ""))
        name = str(raw_record.get("name", "")).strip()
        values = raw_record.get("values")
        if (
            key != ibge_code
            or len(ibge_code) != 7
            or not ibge_code.isdigit()
            or not name
            or not isinstance(values, dict)
            or set(values) != set(definitions)
        ):
            raise SystemExit(f"Município ou conjunto de indicadores inválido: {key}.")

        for code, raw_value in values.items():
            definition = definitions[code]
            if raw_value is None:
                missing_by_code[code].append(ibge_code)
                continue
            if isinstance(raw_value, bool):
                raise SystemExit(f"Valor booleano inválido em {ibge_code}/{code}.")
            try:
                value = float(raw_value)
            except (TypeError, ValueError) as error:
                raise SystemExit(f"Valor não numérico em {ibge_code}/{code}.") from error
            if not math.isfinite(value) or value < 0:
                raise SystemExit(f"Valor fora do intervalo em {ibge_code}/{code}.")
            if definition["valueFormat"] == "percent" and value > 100:
                raise SystemExit(f"Percentual acima de 100 em {ibge_code}/{code}.")
            coverage_by_code[code] += 1
            normalized_values.append(
                {
                    "municipality_ibge_code": ibge_code,
                    "indicator_code": code,
                    "reference_year": int(definition["referenceYear"]),
                    "value": value,
                }
            )

    for code, definition in definitions.items():
        expected_missing = sorted(
            str(item) for item in definition.get("missingMunicipalityCodes", [])
        )
        if coverage_by_code[code] != int(definition["coverageCount"]):
            raise SystemExit(f"Cobertura divergente no indicador {code}.")
        if sorted(missing_by_code[code]) != expected_missing:
            raise SystemExit(f"Lista de lacunas divergente no indicador {code}.")
        if bool(definition.get("requiredCoverage")) and coverage_by_code[code] != 246:
            raise SystemExit(f"O indicador obrigatório {code} não cobre os 246 municípios.")

    checksum = hashlib.sha256(source_bytes).hexdigest()
    source_name = str(metadata.get("source", "IBGE"))
    source_url = str(metadata.get("sourceUrl", ""))
    if not source_url.startswith("https://"):
        raise SystemExit("A URL oficial da fonte IBGE é inválida.")

    with SessionLocal() as db:
        municipalities = {item.ibge_code: item for item in db.scalars(select(Municipality))}
        if len(municipalities) != 246 or set(municipalities) != set(records):
            raise SystemExit(
                "Carregue primeiro os 246 municípios com seed-municipalities."
            )
        for code, record in records.items():
            if municipalities[code].name != str(record["name"]):
                raise SystemExit(f"Nome municipal divergente entre TSE e IBGE: {code}.")

        import_run = ImportRun(
            source="ibge_socioeconomic",
            status="running",
            row_count=0,
            checksum_sha256=checksum,
        )
        db.add(import_run)
        db.commit()

        try:
            for code, raw in definitions.items():
                definition = db.get(IndicatorDefinition, code)
                if not definition:
                    definition = IndicatorDefinition(code=code)
                    db.add(definition)
                definition.ibge_indicator_id = int(raw["ibgeIndicatorId"])
                definition.label = str(raw["label"])
                definition.short_label = str(raw["shortLabel"])
                definition.description = str(raw["description"])
                definition.unit = str(raw["unit"])
                definition.value_format = str(raw["valueFormat"])
                definition.source_name = source_name
                definition.source_url = source_url
                db.execute(
                    delete(MunicipalityIndicatorValue).where(
                        MunicipalityIndicatorValue.indicator_code == code,
                        MunicipalityIndicatorValue.reference_year
                        == int(raw["referenceYear"]),
                    )
                )

            db.flush()
            db.add_all(
                MunicipalityIndicatorValue(**item) for item in normalized_values
            )
            import_run.status = "succeeded"
            import_run.row_count = len(normalized_values)
            import_run.finished_at = utcnow()
            db.commit()
        except Exception as error:
            db.rollback()
            failed_run = db.get(ImportRun, import_run.id)
            if failed_run:
                failed_run.status = "failed"
                failed_run.error_summary = str(error)[:1000]
                failed_run.finished_at = utcnow()
                db.commit()
            raise

    print(
        f"Indicadores IBGE importados: {len(definitions)} séries, "
        f"{len(normalized_values)} valores municipais."
    )


def import_tse_history(args: argparse.Namespace) -> None:
    source = Path(args.file).resolve()
    source_bytes = source.read_bytes()
    payload = json.loads(source_bytes.decode("utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("O histórico TSE precisa conter um objeto JSON.")
    metadata = payload.get("metadata")
    raw_contests = payload.get("contests")
    if not isinstance(metadata, dict) or not isinstance(raw_contests, list):
        raise SystemExit("Metadados ou pleitos do histórico TSE estão ausentes.")
    # O conjunto de anos do snapshot é configurável (scripts/ajustar_anos.py pode
    # remover um ano inteiro), então exigimos CONSISTÊNCIA — metadata batendo com
    # o conteúdo — e não uma contagem fixa que envelhece a cada eleição.
    declared_contests = int(metadata.get("contestCount", -1))
    if (
        metadata.get("state") != "GO"
        or int(metadata.get("municipalityCount", -1)) != 246
        or declared_contests != len(raw_contests)
        or not raw_contests
    ):
        raise SystemExit(
            "O histórico precisa cobrir os 246 municípios de Goiás e ter contestCount "
            f"igual ao número de pleitos (declarado {declared_contests}, "
            f"encontrado {len(raw_contests)})."
        )
    source_url = str(metadata.get("sourceUrl", ""))
    source_name = str(metadata.get("source", ""))
    if not source_url.startswith("https://") or not source_name:
        raise SystemExit("A fonte oficial do histórico TSE é inválida.")

    normalized_contests: list[dict[str, object]] = []
    normalized_candidates: list[dict[str, object]] = []
    normalized_results: list[dict[str, object]] = []
    seen_contests: set[str] = set()
    for raw_contest in raw_contests:
        if not isinstance(raw_contest, dict):
            raise SystemExit("Há um pleito inválido no histórico TSE.")
        contest_id = str(raw_contest.get("id", ""))
        try:
            year = int(raw_contest["electionYear"])
            office_code = int(raw_contest["officeCode"])
            round_number = int(raw_contest["round"])
            state_valid_votes = int(raw_contest["stateValidVotes"])
            municipality_count = int(raw_contest["municipalityCount"])
        except (KeyError, TypeError, ValueError) as error:
            invalid_contest = contest_id or "?"
            raise SystemExit(
                f"Campos numéricos inválidos no pleito {invalid_contest}."
            ) from error
        if (
            not contest_id
            or contest_id in seen_contests
            or year not in (2018, 2022)
            or office_code not in (1, 3)
            or round_number not in (1, 2)
            or municipality_count != 246
            or state_valid_votes <= 0
        ):
            raise SystemExit(f"Pleito inválido ou duplicado: {contest_id or '?'}.")
        seen_contests.add(contest_id)
        raw_candidates = raw_contest.get("candidates")
        municipalities = raw_contest.get("municipalities")
        if (
            not isinstance(raw_candidates, list)
            or len(raw_candidates) < 2
            or not isinstance(municipalities, dict)
            or len(municipalities) != 246
        ):
            raise SystemExit(f"Candidaturas ou cobertura inválida em {contest_id}.")

        candidate_by_id: dict[str, dict[str, object]] = {}
        candidate_totals: dict[str, int] = {}
        winner_counts: dict[str, int] = defaultdict(int)
        for raw_candidate in raw_candidates:
            if not isinstance(raw_candidate, dict):
                raise SystemExit(f"Candidatura inválida em {contest_id}.")
            candidate_id = str(raw_candidate.get("id", ""))
            if not candidate_id or candidate_id in candidate_by_id:
                raise SystemExit(f"Candidatura ausente ou duplicada em {contest_id}.")
            try:
                state_votes = int(raw_candidate["stateVotes"])
                state_share_pct = float(raw_candidate["stateSharePct"])
                state_rank = int(raw_candidate["stateRank"])
                municipalities_won = int(raw_candidate["municipalitiesWon"])
            except (KeyError, TypeError, ValueError) as error:
                raise SystemExit(
                    f"Totais inválidos na candidatura {candidate_id}/{contest_id}."
                ) from error
            for field in ("number", "ballotName", "fullName", "party", "partyName"):
                if not str(raw_candidate.get(field, "")).strip():
                    raise SystemExit(
                        f"Campo {field} ausente na candidatura {candidate_id}/{contest_id}."
                    )
            if (
                state_votes < 0
                or not 0 <= state_share_pct <= 100
                or not 1 <= state_rank <= len(raw_candidates)
                or not 0 <= municipalities_won <= 246
            ):
                raise SystemExit(f"Totais fora do intervalo em {candidate_id}/{contest_id}.")
            candidate_by_id[candidate_id] = raw_candidate
            candidate_totals[candidate_id] = 0
            normalized_candidates.append(
                {
                    "id": f"{contest_id}:{candidate_id}",
                    "contest_id": contest_id,
                    "tse_candidate_id": candidate_id,
                    "number": str(raw_candidate["number"]),
                    "ballot_name": str(raw_candidate["ballotName"]),
                    "full_name": str(raw_candidate["fullName"]),
                    "party": str(raw_candidate["party"]),
                    "party_name": str(raw_candidate["partyName"]),
                    "registration_status": str(raw_candidate.get("registrationStatus", "")),
                    "result_status": str(raw_candidate.get("resultStatus", "")),
                    "state_votes": state_votes,
                    "state_share_pct": state_share_pct,
                    "state_rank": state_rank,
                    "municipalities_won": municipalities_won,
                }
            )

        contest_valid_total = 0
        for ibge_code, raw_result in municipalities.items():
            if (
                len(str(ibge_code)) != 7
                or not str(ibge_code).isdigit()
                or not isinstance(raw_result, dict)
            ):
                raise SystemExit(f"Resultado municipal inválido em {contest_id}/{ibge_code}.")
            try:
                valid_votes = int(raw_result["validVotes"])
            except (KeyError, TypeError, ValueError) as error:
                raise SystemExit(
                    f"Votos válidos inválidos em {contest_id}/{ibge_code}."
                ) from error
            raw_votes = raw_result.get("votes")
            winner_id = str(raw_result.get("winnerCandidateId", ""))
            if valid_votes <= 0 or not isinstance(raw_votes, dict):
                raise SystemExit(f"Resultado vazio em {contest_id}/{ibge_code}.")
            unknown_candidates = set(raw_votes) - set(candidate_by_id)
            if unknown_candidates or winner_id not in candidate_by_id:
                raise SystemExit(f"Candidatura desconhecida em {contest_id}/{ibge_code}.")
            votes_by_candidate: dict[str, int] = {}
            for candidate_id in candidate_by_id:
                try:
                    votes = int(raw_votes.get(candidate_id, 0))
                except (TypeError, ValueError) as error:
                    raise SystemExit(
                        f"Votos inválidos em {contest_id}/{ibge_code}/{candidate_id}."
                    ) from error
                if votes < 0:
                    raise SystemExit(f"Votos negativos em {contest_id}/{ibge_code}.")
                votes_by_candidate[candidate_id] = votes
            if sum(votes_by_candidate.values()) != valid_votes:
                raise SystemExit(f"Votos não fecham em {contest_id}/{ibge_code}.")
            maximum = max(votes_by_candidate.values())
            if votes_by_candidate[winner_id] != maximum:
                raise SystemExit(f"Vencedor municipal divergente em {contest_id}/{ibge_code}.")
            winner_counts[winner_id] += 1
            contest_valid_total += valid_votes
            for candidate_id, votes in votes_by_candidate.items():
                candidate_totals[candidate_id] += votes
                normalized_results.append(
                    {
                        "contest_id": contest_id,
                        "candidate_id": f"{contest_id}:{candidate_id}",
                        "municipality_ibge_code": str(ibge_code),
                        "votes": votes,
                        "valid_votes": valid_votes,
                        "share_pct": votes / valid_votes * 100,
                        "won_municipality": candidate_id == winner_id,
                    }
                )

        if contest_valid_total != state_valid_votes:
            raise SystemExit(f"Total estadual não fecha em {contest_id}.")
        for candidate_id, raw_candidate in candidate_by_id.items():
            if (
                candidate_totals[candidate_id] != int(raw_candidate["stateVotes"])
                or winner_counts[candidate_id] != int(raw_candidate["municipalitiesWon"])
            ):
                raise SystemExit(f"Totais municipais divergem em {contest_id}/{candidate_id}.")

        normalized_contests.append(
            {
                "id": contest_id,
                "election_year": year,
                "office_code": office_code,
                "office_name": str(raw_contest["officeName"]),
                "round_number": round_number,
                "election_date": str(raw_contest["electionDate"]),
                "generated_at_source": str(raw_contest["generatedAt"]),
                "state_valid_votes": state_valid_votes,
                "municipality_count": municipality_count,
                "source_name": source_name,
                "source_url": source_url,
            }
        )

    checksum = hashlib.sha256(source_bytes).hexdigest()
    with SessionLocal() as db:
        municipality_ids = set(db.scalars(select(Municipality.ibge_code)))
        source_ids = {
            str(result["municipality_ibge_code"]) for result in normalized_results
        }
        if len(municipality_ids) != 246 or municipality_ids != source_ids:
            raise SystemExit("Carregue primeiro os 246 municípios com seed-municipalities.")
        import_run = ImportRun(
            source="tse_election_history",
            status="running",
            row_count=0,
            checksum_sha256=checksum,
        )
        db.add(import_run)
        db.commit()
        try:
            db.execute(delete(MunicipalityElectionResult))
            db.execute(delete(ElectionCandidate))
            db.execute(delete(ElectionContest))
            db.add_all(ElectionContest(**item) for item in normalized_contests)
            db.flush()
            db.add_all(ElectionCandidate(**item) for item in normalized_candidates)
            db.flush()
            db.add_all(MunicipalityElectionResult(**item) for item in normalized_results)
            import_run.status = "succeeded"
            import_run.row_count = len(normalized_results)
            import_run.finished_at = utcnow()
            db.commit()
        except Exception as error:
            db.rollback()
            failed_run = db.get(ImportRun, import_run.id)
            if failed_run:
                failed_run.status = "failed"
                failed_run.error_summary = str(error)[:1000]
                failed_run.finished_at = utcnow()
                db.commit()
            raise

    print(
        f"Histórico TSE importado: {len(normalized_contests)} pleitos, "
        f"{len(normalized_candidates)} séries e {len(normalized_results)} valores municipais."
    )


def import_campaign_registration_demo(args: argparse.Namespace) -> None:
    source = Path(args.file).resolve()
    source_bytes = source.read_bytes()
    payload = json.loads(source_bytes.decode("utf-8"))
    metadata = payload.get("metadata") if isinstance(payload, dict) else None
    records = payload.get("records") if isinstance(payload, dict) else None
    if (
        not isinstance(metadata, dict)
        or metadata.get("mode") != "synthetic-demo"
        or metadata.get("state") != "GO"
        or not isinstance(records, list)
        or not records
    ):
        raise SystemExit("A demonstração precisa ser sintética, não vazia e limitada a Goiás.")
    if int(metadata.get("recordCount", -1)) != len(records):
        raise SystemExit("A contagem de cadastros diverge dos metadados.")

    normalized: list[dict[str, object]] = []
    valid_sources = {"field", "event", "digital", "referral"}
    valid_statuses = {"pending", "contacted", "completed"}
    for index, raw in enumerate(records, start=1):
        if not isinstance(raw, dict):
            raise SystemExit(f"Cadastro sintético inválido na linha {index}.")
        municipality_id = str(raw.get("municipalityId", ""))
        cep_prefix = str(raw.get("cepPrefix", ""))
        source_name = str(raw.get("source", ""))
        follow_up_status = str(raw.get("followUpStatus", ""))
        if (
            len(municipality_id) != 7
            or not municipality_id.isdigit()
            or len(cep_prefix) != 5
            or not cep_prefix.isdigit()
            or source_name not in valid_sources
            or follow_up_status not in valid_statuses
        ):
            raise SystemExit(f"Cadastro sintético inválido na linha {index}.")
        latitude = raw.get("latitude")
        longitude = raw.get("longitude")
        normalized.append(
            {
                "municipality_ibge_code": municipality_id,
                "cep_prefix": cep_prefix,
                "neighborhood": str(raw.get("neighborhood", "")).strip(),
                "latitude": None if latitude is None else round(float(latitude), 3),
                "longitude": None if longitude is None else round(float(longitude), 3),
                "geocode_precision": str(raw.get("geocodePrecision", "municipality")),
                "source": source_name,
                "follow_up_status": follow_up_status,
                "consent_at": datetime.fromisoformat(
                    str(raw["consentAt"]).replace("Z", "+00:00")
                ),
                "consent_channel": str(raw.get("consentChannel", "demo")),
                "consent_version": str(raw.get("consentVersion", "demo-v1")),
                "retention_until": date.fromisoformat(str(raw["retentionUntil"])),
                "data_origin": "synthetic-demo",
                "created_at": datetime.fromisoformat(
                    str(raw["createdAt"]).replace("Z", "+00:00")
                ),
            }
        )
        if not normalized[-1]["neighborhood"]:
            raise SystemExit(f"Bairro ausente na linha {index}.")

    checksum = hashlib.sha256(source_bytes).hexdigest()
    with SessionLocal() as db:
        municipality_ids = set(db.scalars(select(Municipality.ibge_code)))
        source_ids = {str(item["municipality_ibge_code"]) for item in normalized}
        missing = sorted(source_ids - municipality_ids)
        if missing:
            raise SystemExit(
                "Carregue primeiro os municípios. Ausentes: " + ", ".join(missing)
            )
        import_run = ImportRun(
            source="campaign_registration_demo",
            status="running",
            row_count=0,
            checksum_sha256=checksum,
        )
        db.add(import_run)
        db.commit()
        try:
            db.execute(
                delete(CampaignRegistration).where(
                    CampaignRegistration.data_origin == "synthetic-demo"
                )
            )
            db.add_all(CampaignRegistration(**item) for item in normalized)
            import_run.status = "succeeded"
            import_run.row_count = len(normalized)
            import_run.finished_at = utcnow()
            db.commit()
        except Exception as error:
            db.rollback()
            failed_run = db.get(ImportRun, import_run.id)
            if failed_run:
                failed_run.status = "failed"
                failed_run.error_summary = str(error)[:1000]
                failed_run.finished_at = utcnow()
                db.commit()
            raise
    print(
        f"Cadastros sintéticos importados: {len(normalized)} em "
        f"{len(source_ids)} municípios."
    )


def spectrum_block(score: float, left_maximum: float, right_minimum: float) -> str:
    if score <= left_maximum:
        return "left"
    if score >= right_minimum:
        return "right"
    return "center"


def read_spectrum_score(raw_value: object, label: str) -> float | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool):
        raise SystemExit(f"Nota booleana inválida em {label}.")
    try:
        score = float(raw_value)
    except (TypeError, ValueError) as error:
        raise SystemExit(f"Nota não numérica em {label}.") from error
    if not math.isfinite(score) or not 0 <= score <= 10:
        raise SystemExit(f"Nota fora do intervalo de 0 a 10 em {label}.")
    return score


def import_party_spectrum(args: argparse.Namespace) -> None:
    source = Path(args.file).resolve()
    source_bytes = source.read_bytes()
    payload = json.loads(source_bytes.decode("utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("O espectro partidário precisa conter um objeto JSON.")
    metadata = payload.get("metadata")
    raw_parties = payload.get("parties")
    if not isinstance(metadata, dict) or not isinstance(raw_parties, list) or not raw_parties:
        raise SystemExit("Metadados ou partidos do espectro estão ausentes.")

    schema_version = metadata.get("schemaVersion")
    if schema_version not in SPECTRUM_SCHEMA_VERSIONS:
        supported = ", ".join(str(version) for version in SPECTRUM_SCHEMA_VERSIONS)
        raise SystemExit(
            f"Versão de schema não suportada: {schema_version}. Suportadas: {supported}."
        )

    scale = metadata.get("scale")
    thresholds = metadata.get("blockThresholds")
    if not isinstance(scale, dict) or not isinstance(thresholds, dict):
        raise SystemExit("A escala ou os limiares de bloco do espectro estão ausentes.")
    try:
        scale_minimum = float(scale["minimum"])
        scale_maximum = float(scale["maximum"])
        left_maximum = float(thresholds["leftMaximum"])
        right_minimum = float(thresholds["rightMinimum"])
    except (KeyError, TypeError, ValueError) as error:
        raise SystemExit("Escala ou limiares de bloco não numéricos.") from error
    if (scale_minimum, scale_maximum) != (0.0, 10.0):
        raise SystemExit("A escala do espectro precisa ir de 0 a 10.")
    if not scale_minimum <= left_maximum < right_minimum <= scale_maximum:
        raise SystemExit(
            "Limiares incoerentes: leftMaximum precisa ser menor que rightMinimum "
            "e ambos dentro da escala."
        )

    raw_waves = metadata.get("waves")
    if not isinstance(raw_waves, list) or not raw_waves:
        raise SystemExit("As ondas do survey estão ausentes.")
    waves: dict[int, dict[str, object]] = {}
    for raw_wave in raw_waves:
        if not isinstance(raw_wave, dict):
            raise SystemExit("Há uma onda do survey inválida.")
        try:
            wave_year = int(raw_wave["year"])
            respondents = int(raw_wave["respondents"])
        except (KeyError, TypeError, ValueError) as error:
            raise SystemExit("Ano ou número de respondentes inválido em uma onda.") from error
        if wave_year in waves or not 1900 <= wave_year <= 2200 or respondents <= 0:
            raise SystemExit(f"Onda inválida ou duplicada: {wave_year}.")
        for field in ("institution", "citation", "doi"):
            if not str(raw_wave.get(field, "")).strip():
                raise SystemExit(f"Campo {field} ausente na onda {wave_year}.")
        if not str(raw_wave.get("url", "")).startswith("https://"):
            raise SystemExit(f"A URL oficial da onda {wave_year} é inválida.")
        waves[wave_year] = raw_wave

    raw_wave_by_year = metadata.get("waveByElectionYear")
    if not isinstance(raw_wave_by_year, dict) or not raw_wave_by_year:
        raise SystemExit("O mapa de ondas por ano eleitoral está ausente.")
    wave_by_election_year: dict[int, int] = {}
    for raw_election_year, raw_wave_year in raw_wave_by_year.items():
        try:
            election_year = int(raw_election_year)
            wave_year = int(raw_wave_year)
        except (TypeError, ValueError) as error:
            raise SystemExit(f"Mapa de ondas inválido em {raw_election_year}.") from error
        if not 1900 <= election_year <= 2200 or wave_year not in waves:
            raise SystemExit(
                f"O ano eleitoral {election_year} aponta para uma onda inexistente."
            )
        wave_by_election_year[election_year] = wave_year

    limitations = [str(item) for item in metadata.get("limitations", []) if str(item).strip()]
    if not limitations:
        raise SystemExit("As limitações metodológicas do espectro estão ausentes.")

    parties: dict[str, dict[str, object]] = {}
    scores_by_party: dict[str, dict[int, float]] = {}
    aliases_by_party: dict[str, list[str]] = {}
    alias_owner: dict[str, str] = {}
    for raw_party in raw_parties:
        if not isinstance(raw_party, dict):
            raise SystemExit("Há um partido inválido no espectro.")
        code = str(raw_party.get("code", "")).strip()
        name = str(raw_party.get("name", "")).strip()
        raw_numbers = raw_party.get("tseNumbers")
        raw_aliases = raw_party.get("aliases")
        raw_scores = raw_party.get("scores")
        if not code or code in parties or not name:
            raise SystemExit(f"Partido ausente ou duplicado: {code or '?'}.")
        if (
            not isinstance(raw_numbers, list)
            or not raw_numbers
            or not isinstance(raw_aliases, list)
            or not raw_aliases
            or not isinstance(raw_scores, dict)
        ):
            raise SystemExit(f"Números, siglas ou notas inválidos no partido {code}.")

        tse_numbers: list[int] = []
        for raw_number in raw_numbers:
            if isinstance(raw_number, bool) or not isinstance(raw_number, int):
                raise SystemExit(f"Número de urna inválido no partido {code}.")
            if not 10 <= raw_number <= 99 or raw_number in tse_numbers:
                raise SystemExit(f"Número de urna fora do intervalo em {code}.")
            tse_numbers.append(raw_number)

        aliases: list[str] = []
        for raw_alias in raw_aliases:
            alias = str(raw_alias).strip().upper()
            if not alias or len(alias) > 60:
                raise SystemExit(f"Sigla inválida no partido {code}.")
            if alias in aliases:
                raise SystemExit(f"Sigla repetida no partido {code}: {alias}.")
            owner = alias_owner.get(alias)
            if owner is not None and owner != code:
                raise SystemExit(
                    f"A sigla {alias} aponta para dois partidos: {owner} e {code}."
                )
            alias_owner[alias] = code
            aliases.append(alias)
        if code.upper() not in aliases:
            raise SystemExit(f"O partido {code} não lista a própria sigla entre os aliases.")

        if set(raw_scores) != {str(wave_year) for wave_year in waves}:
            raise SystemExit(f"O partido {code} não cobre exatamente as ondas do survey.")
        party_scores: dict[int, float] = {}
        for raw_wave_year, raw_score in raw_scores.items():
            wave_year = int(raw_wave_year)
            score = read_spectrum_score(raw_score, f"{code}/{wave_year}")
            if score is not None:
                party_scores[wave_year] = score

        parties[code] = raw_party
        scores_by_party[code] = party_scores
        aliases_by_party[code] = aliases

    derived_by_party: dict[str, dict[int, list[str]]] = {}
    for code, raw_party in parties.items():
        raw_derived = raw_party.get("derivedFrom", {})
        if not isinstance(raw_derived, dict):
            raise SystemExit(f"O bloco derivedFrom do partido {code} é inválido.")
        derived_waves: dict[int, list[str]] = {}
        for raw_wave_year, raw_sources in raw_derived.items():
            wave_year = int(raw_wave_year)
            if wave_year not in waves or wave_year not in scores_by_party[code]:
                raise SystemExit(f"Derivação sem nota correspondente em {code}/{raw_wave_year}.")
            if not isinstance(raw_sources, list) or len(raw_sources) < 2:
                raise SystemExit(f"A derivação de {code}/{wave_year} precisa de duas siglas.")
            source_scores: list[float] = []
            sources: list[str] = []
            for raw_source in raw_sources:
                origin = str(raw_source).strip()
                if origin not in parties or origin == code:
                    raise SystemExit(
                        f"A sigla de origem {origin or '?'} de {code}/{wave_year} "
                        "não existe no registro."
                    )
                if wave_year not in scores_by_party[origin]:
                    raise SystemExit(
                        f"A sigla de origem {origin} não tem nota na onda {wave_year}."
                    )
                source_scores.append(scores_by_party[origin][wave_year])
                sources.append(origin)
            expected = sum(source_scores) / len(source_scores)
            if abs(expected - scores_by_party[code][wave_year]) > 0.005:
                raise SystemExit(
                    f"A nota derivada de {code}/{wave_year} não é a média das siglas de origem."
                )
            derived_waves[wave_year] = sources
        derived_by_party[code] = derived_waves

    normalized_scores: list[dict[str, object]] = []
    normalized_aliases: list[dict[str, object]] = []
    for code, raw_party in parties.items():
        for alias in aliases_by_party[code]:
            normalized_aliases.append({"alias": alias, "party_code": code})
        for wave_year, score in sorted(scores_by_party[code].items()):
            wave = waves[wave_year]
            normalized_scores.append(
                {
                    "party_code": code,
                    "party_name": str(raw_party["name"]).strip(),
                    "tse_numbers": [int(number) for number in raw_party["tseNumbers"]],
                    "wave_year": wave_year,
                    "score": score,
                    "block": spectrum_block(score, left_maximum, right_minimum),
                    "is_derived": wave_year in derived_by_party[code],
                    "derived_from": derived_by_party[code].get(wave_year, []),
                    "source_institution": str(wave["institution"]),
                    "source_citation": str(wave["citation"]),
                    "source_doi": str(wave["doi"]),
                    "source_url": str(wave["url"]),
                }
            )
    if not normalized_scores:
        raise SystemExit("Nenhuma nota válida foi encontrada no espectro.")

    settings = {
        "registry": {
            "schema_version": int(schema_version),
            "title": str(metadata.get("title", "")),
            "description": str(metadata.get("description", "")),
            "limitations": limitations,
        },
        "scale": {
            "minimum": scale_minimum,
            "maximum": scale_maximum,
            "minimum_label": str(scale.get("minimumLabel", "")),
            "maximum_label": str(scale.get("maximumLabel", "")),
        },
        "block_thresholds": {
            "left_maximum": left_maximum,
            "right_minimum": right_minimum,
            "rationale": str(thresholds.get("rationale", "")),
        },
        "wave_by_election_year": {
            str(election_year): wave_year
            for election_year, wave_year in sorted(wave_by_election_year.items())
        },
        "waves": {
            str(wave_year): {
                "year": wave_year,
                "respondents": int(wave["respondents"]),
                "institution": str(wave["institution"]),
                "citation": str(wave["citation"]),
                "doi": str(wave["doi"]),
                "url": str(wave["url"]),
            }
            for wave_year, wave in sorted(waves.items())
        },
    }

    checksum = hashlib.sha256(source_bytes).hexdigest()
    with SessionLocal() as db:
        import_run = ImportRun(
            source="party_spectrum",
            status="running",
            row_count=0,
            checksum_sha256=checksum,
        )
        db.add(import_run)
        db.commit()
        try:
            db.execute(delete(PartySpectrumScore))
            db.execute(delete(PartyAlias))
            db.execute(delete(SpectrumSetting))
            db.flush()
            db.add_all(PartySpectrumScore(**item) for item in normalized_scores)
            db.add_all(PartyAlias(**item) for item in normalized_aliases)
            db.add_all(
                SpectrumSetting(key=key, value_json=value) for key, value in settings.items()
            )
            import_run.status = "succeeded"
            import_run.row_count = len(normalized_scores)
            import_run.finished_at = utcnow()
            db.commit()
        except Exception as error:
            db.rollback()
            failed_run = db.get(ImportRun, import_run.id)
            if failed_run:
                failed_run.status = "failed"
                failed_run.error_summary = str(error)[:1000]
                failed_run.finished_at = utcnow()
                db.commit()
            raise

    print(
        f"Espectro partidário importado: {len(parties)} partidos, "
        f"{len(normalized_scores)} notas em {len(waves)} ondas e "
        f"{len(normalized_aliases)} siglas."
    )


def set_password(args: argparse.Namespace) -> None:
    email = normalize_email(args.email)
    password = read_password(args.password_env)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            raise SystemExit("Usuário não encontrado.")
        user.password_hash = hash_password(password)
        db.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=utcnow())
        )
        db.add(
            AuditLog(
                user_id=user.id,
                action="system.password_reset",
                resource_type="user",
                resource_id=user.id,
                metadata_json={"source": "cli"},
            )
        )
        db.commit()
    print(f"Senha redefinida e sessões revogadas: {email}.")


def purge_sessions(_args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        result = db.execute(
            delete(AuthSession).where(
                (AuthSession.expires_at < utcnow()) | (AuthSession.revoked_at.is_not(None))
            )
        )
        db.commit()
        print(f"Sessões removidas: {result.rowcount or 0}.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Administração do ACCORSI")
    subparsers = parser.add_subparsers(required=True)

    user_parser = subparsers.add_parser("create-user", help="Cria um usuário")
    user_parser.add_argument("--email", required=True)
    user_parser.add_argument("--name", required=True)
    user_parser.add_argument(
        "--role",
        choices=("admin", "coordinator", "analyst", "field"),
        default="analyst",
    )
    user_parser.add_argument(
        "--password-env",
        help="Lê a senha de uma variável de ambiente em vez do terminal.",
    )
    user_parser.set_defaults(handler=create_user)

    admin_parser = subparsers.add_parser("create-admin", help="Cria o primeiro administrador")
    admin_parser.add_argument("--email", required=True)
    admin_parser.add_argument("--name", required=True)
    admin_parser.add_argument("--password-env")
    admin_parser.set_defaults(handler=create_user, role="admin")

    password_parser = subparsers.add_parser(
        "set-password", help="Redefine a senha e revoga as sessões do usuário"
    )
    password_parser.add_argument("--email", required=True)
    password_parser.add_argument("--password-env")
    password_parser.set_defaults(handler=set_password)

    seed_parser = subparsers.add_parser(
        "seed-municipalities", help="Sincroniza o JSON TSE/IBGE validado"
    )
    seed_parser.add_argument("--file", required=True)
    seed_parser.set_defaults(handler=seed_municipalities)

    indicators_parser = subparsers.add_parser(
        "import-ibge-indicators",
        help="Importa o snapshot socioeconômico municipal validado",
    )
    indicators_parser.add_argument("--file", required=True)
    indicators_parser.set_defaults(handler=import_ibge_indicators)

    history_parser = subparsers.add_parser(
        "import-tse-history",
        help="Importa o histórico municipal oficial de Presidente e Governador",
    )
    history_parser.add_argument("--file", required=True)
    history_parser.set_defaults(handler=import_tse_history)

    registration_parser = subparsers.add_parser(
        "import-registration-demo",
        help="Importa a demonstração sintética de cadastros geocodificados",
    )
    registration_parser.add_argument("--file", required=True)
    registration_parser.set_defaults(handler=import_campaign_registration_demo)

    spectrum_parser = subparsers.add_parser(
        "import-party-spectrum",
        help="Importa o espectro ideológico dos partidos por onda do survey",
    )
    spectrum_parser.add_argument("--file", required=True)
    spectrum_parser.set_defaults(handler=import_party_spectrum)

    purge_parser = subparsers.add_parser(
        "purge-sessions", help="Remove sessões expiradas ou revogadas"
    )
    purge_parser.set_defaults(handler=purge_sessions)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
