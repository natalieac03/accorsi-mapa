#!/usr/bin/env python3
"""Gera o histórico municipal de Presidente e Governador em Goiás.

Lê os ZIPs oficiais de votação por seção e de candidaturas do TSE, agrega os
votos válidos por município e produz o snapshot compacto usado pelo frontend.
O processamento não extrai os CSVs de mais de 1 GB e usa só a biblioteca
padrão do Python.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import tempfile
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO, Iterable
from zipfile import ZipFile

STATE = "GO"
YEARS = (2018, 2022)
OFFICES = {1: "Presidente", 3: "Governador"}
EXPECTED_MUNICIPALITIES = 246
SOURCE_ENCODING = "latin-1"
SOURCE_URL = "https://dadosabertos.tse.jus.br/dataset/resultados-2022"

SECTION_COLUMNS = {
    "DT_GERACAO",
    "ANO_ELEICAO",
    "NR_TURNO",
    "DT_ELEICAO",
    "SG_UF",
    "CD_MUNICIPIO",
    "NM_MUNICIPIO",
    "CD_CARGO",
    "DS_CARGO",
    "NR_VOTAVEL",
    "NM_VOTAVEL",
    "QT_VOTOS",
    "SQ_CANDIDATO",
}

CANDIDATE_COLUMNS = {
    "ANO_ELEICAO",
    "SG_UF",
    "CD_CARGO",
    "SQ_CANDIDATO",
    "NR_CANDIDATO",
    "NM_CANDIDATO",
    "NM_URNA_CANDIDATO",
    "SG_PARTIDO",
    "NM_PARTIDO",
    "DS_SITUACAO_CANDIDATURA",
    "DS_SIT_TOT_TURNO",
}


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Gera o histórico oficial TSE de Presidente e Governador em Goiás."
    )
    parser.add_argument("--section-2018", type=Path, required=True)
    parser.add_argument("--section-2022", type=Path, required=True)
    parser.add_argument("--president-2018", type=Path, required=True)
    parser.add_argument("--president-2022", type=Path, required=True)
    parser.add_argument("--candidates-2018", type=Path, required=True)
    parser.add_argument("--candidates-2022", type=Path, required=True)
    parser.add_argument(
        "--electorate-file",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "src" / "data" / "election-history-go.json",
    )
    return parser.parse_args()


def open_csv(raw: BinaryIO) -> csv.DictReader:
    text = io.TextIOWrapper(raw, encoding=SOURCE_ENCODING, newline="")
    return csv.DictReader(text, delimiter=";", quotechar='"')


def validate_columns(
    fieldnames: Iterable[str] | None, required: set[str], label: str
) -> None:
    missing = sorted(required - set(fieldnames or []))
    if missing:
        raise RuntimeError(f"Colunas ausentes em {label}: {', '.join(missing)}")


def parse_int(value: str | None, field: str, row_number: int) -> int:
    raw = (value or "").strip()
    try:
        return int(raw or "0")
    except ValueError as error:
        raise ValueError(
            f"Valor inválido em {field}, linha {row_number}: {raw!r}"
        ) from error


def clean_label(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def display_name(value: str | None) -> str:
    words = clean_label(value).title().split()
    connectors = {"Da", "Das", "De", "Do", "Dos", "E"}
    return " ".join(
        word.lower() if index > 0 and word in connectors else word
        for index, word in enumerate(words)
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_municipality_mapping(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    metadata = payload.get("metadata", {})
    records = payload.get("municipalities")
    if (
        metadata.get("state") != STATE
        or metadata.get("municipalityCount") != EXPECTED_MUNICIPALITIES
        or not isinstance(records, dict)
        or len(records) != EXPECTED_MUNICIPALITIES
    ):
        raise RuntimeError("A base municipal precisa conter os 246 municípios de Goiás.")

    mapping: dict[str, str] = {}
    names: dict[str, str] = {}
    for ibge_code, record in records.items():
        tse_code = str(record.get("tseCode", "")).zfill(5)
        if not tse_code or tse_code in mapping:
            raise RuntimeError(f"Código TSE ausente ou duplicado em {ibge_code}.")
        mapping[tse_code] = str(ibge_code)
        names[str(ibge_code)] = str(record["name"])
    return mapping, names


def candidate_members(archive: ZipFile, year: int) -> list[str]:
    suffixes = (f"consulta_cand_{year}_rs.csv", f"consulta_cand_{year}_br.csv")
    members = [
        name
        for name in archive.namelist()
        if name.lower().endswith(suffixes)
    ]
    if len(members) != 2:
        raise RuntimeError(
            f"Esperados os CSVs GO e BR de candidaturas de {year}; encontrados {members}."
        )
    return members


def load_candidates(path: Path, year: int) -> dict[str, dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    with ZipFile(path) as archive:
        for member in candidate_members(archive, year):
            with archive.open(member) as raw:
                reader = open_csv(raw)
                validate_columns(reader.fieldnames, CANDIDATE_COLUMNS, member)
                for row_number, row in enumerate(reader, start=2):
                    office_code = parse_int(row["CD_CARGO"], "CD_CARGO", row_number)
                    if office_code not in OFFICES:
                        continue
                    if parse_int(row["ANO_ELEICAO"], "ANO_ELEICAO", row_number) != year:
                        raise RuntimeError(f"Ano divergente em {member}, linha {row_number}.")
                    candidate_id = clean_label(row["SQ_CANDIDATO"])
                    if not candidate_id or candidate_id.startswith("-"):
                        continue
                    candidate = {
                        "id": candidate_id,
                        "number": clean_label(row["NR_CANDIDATO"]),
                        "ballotName": display_name(row["NM_URNA_CANDIDATO"]),
                        "fullName": display_name(row["NM_CANDIDATO"]),
                        "party": clean_label(row["SG_PARTIDO"]),
                        "partyName": display_name(row["NM_PARTIDO"]),
                        "registrationStatus": clean_label(
                            row["DS_SITUACAO_CANDIDATURA"]
                        ),
                        "resultStatus": clean_label(row["DS_SIT_TOT_TURNO"]),
                        "officeCode": office_code,
                    }
                    previous = candidates.get(candidate_id)
                    if previous:
                        stable_keys = set(candidate) - {"resultStatus"}
                        if any(previous[key] != candidate[key] for key in stable_keys):
                            raise RuntimeError(
                                f"Cadastro conflitante para candidatura {candidate_id}."
                            )
                    candidates[candidate_id] = candidate
    return candidates


def new_contest(year: int, round_number: int, office_code: int) -> dict[str, Any]:
    return {
        "id": f"{year}-{office_code}-{round_number}",
        "electionYear": year,
        "round": round_number,
        "officeCode": office_code,
        "officeName": OFFICES[office_code],
        "electionDate": "",
        "generatedAt": "",
        "candidateTotals": defaultdict(int),
        "municipalities": {},
    }


def aggregate_sections(
    path: Path,
    year: int,
    candidates: dict[str, dict[str, Any]],
    tse_to_ibge: dict[str, str],
    allowed_offices: set[int],
    skip_unmapped_municipalities: bool = False,
) -> tuple[dict[str, dict[str, Any]], int, int]:
    contests: dict[str, dict[str, Any]] = {}
    source_rows = 0
    selected_rows = 0
    with ZipFile(path) as archive:
        members = [
            name
            for name in archive.namelist()
            if Path(name).name.lower().startswith(f"votacao_secao_{year}_")
            and name.lower().endswith(".csv")
        ]
        if len(members) != 1:
            raise RuntimeError(f"CSV de votação por seção de {year}/GO não encontrado.")
        member = members[0]
        with archive.open(member) as raw:
            reader = open_csv(raw)
            validate_columns(reader.fieldnames, SECTION_COLUMNS, member)
            for row_number, row in enumerate(reader, start=2):
                source_rows += 1
                office_code = parse_int(row["CD_CARGO"], "CD_CARGO", row_number)
                if office_code not in allowed_offices:
                    continue
                row_uf = clean_label(row["SG_UF"]).upper()
                if row_uf != STATE:
                    if skip_unmapped_municipalities:
                        continue
                    raise RuntimeError(
                        f"UF divergente em {member}, linha {row_number}: {row_uf}."
                    )
                row_year = parse_int(row["ANO_ELEICAO"], "ANO_ELEICAO", row_number)
                if row_year != year:
                    raise RuntimeError(f"Ano divergente em {member}, linha {row_number}.")

                candidate_id = clean_label(row["SQ_CANDIDATO"])
                if not candidate_id or candidate_id.startswith("-"):
                    continue
                candidate = candidates.get(candidate_id)
                if not candidate:
                    raise RuntimeError(
                        f"Candidatura {candidate_id} da linha {row_number} não está no cadastro."
                    )
                if int(candidate["officeCode"]) != office_code:
                    raise RuntimeError(f"Cargo divergente na candidatura {candidate_id}.")

                tse_code = clean_label(row["CD_MUNICIPIO"]).zfill(5)
                ibge_code = tse_to_ibge.get(tse_code)
                if not ibge_code:
                    if skip_unmapped_municipalities:
                        continue
                    raise RuntimeError(
                        f"Município TSE {tse_code} sem correspondência, linha {row_number}."
                    )
                votes = parse_int(row["QT_VOTOS"], "QT_VOTOS", row_number)
                if votes < 0:
                    raise RuntimeError(f"Votos negativos na linha {row_number}.")

                round_number = parse_int(row["NR_TURNO"], "NR_TURNO", row_number)
                if round_number not in (1, 2):
                    raise RuntimeError(f"Turno inválido na linha {row_number}.")
                contest_id = f"{year}-{office_code}-{round_number}"
                contest = contests.setdefault(
                    contest_id, new_contest(year, round_number, office_code)
                )
                contest["electionDate"] = clean_label(row["DT_ELEICAO"])
                contest["generatedAt"] = clean_label(row["DT_GERACAO"])
                contest["candidateTotals"][candidate_id] += votes
                municipality = contest["municipalities"].setdefault(
                    ibge_code,
                    {"validVotes": 0, "votes": defaultdict(int)},
                )
                municipality["validVotes"] += votes
                municipality["votes"][candidate_id] += votes
                selected_rows += 1
    return contests, source_rows, selected_rows


def finalize_contest(
    contest: dict[str, Any],
    candidates: dict[str, dict[str, Any]],
    municipality_names: dict[str, str],
) -> dict[str, Any]:
    municipal_results = contest["municipalities"]
    if set(municipal_results) != set(municipality_names):
        missing = sorted(set(municipality_names) - set(municipal_results))
        extra = sorted(set(municipal_results) - set(municipality_names))
        raise RuntimeError(
            f"Cobertura incompleta em {contest['id']}: sem {missing}, extras {extra}."
        )

    state_valid_votes = sum(item["validVotes"] for item in municipal_results.values())
    candidate_totals = dict(contest["candidateTotals"])
    if state_valid_votes <= 0 or sum(candidate_totals.values()) != state_valid_votes:
        raise RuntimeError(f"Votos válidos não fecham em {contest['id']}.")

    ordered_candidates = sorted(
        candidate_totals,
        key=lambda candidate_id: (
            -candidate_totals[candidate_id],
            candidates[candidate_id]["ballotName"],
        ),
    )
    winner_counts: dict[str, int] = defaultdict(int)
    output_municipalities: dict[str, dict[str, Any]] = {}
    for ibge_code, result in sorted(municipal_results.items()):
        votes = dict(sorted(result["votes"].items()))
        winner_id = max(votes, key=lambda candidate_id: (votes[candidate_id], candidate_id))
        winner_counts[winner_id] += 1
        output_municipalities[ibge_code] = {
            "validVotes": result["validVotes"],
            "winnerCandidateId": winner_id,
            "votes": votes,
        }

    output_candidates: list[dict[str, Any]] = []
    for rank, candidate_id in enumerate(ordered_candidates, start=1):
        total = candidate_totals[candidate_id]
        metadata = candidates[candidate_id]
        output_candidates.append(
            {
                key: metadata[key]
                for key in (
                    "id",
                    "number",
                    "ballotName",
                    "fullName",
                    "party",
                    "partyName",
                    "registrationStatus",
                    "resultStatus",
                )
            }
            | {
                "stateVotes": total,
                "stateSharePct": round(total / state_valid_votes * 100, 6),
                "stateRank": rank,
                "municipalitiesWon": winner_counts[candidate_id],
            }
        )

    return {
        key: contest[key]
        for key in (
            "id",
            "electionYear",
            "round",
            "officeCode",
            "officeName",
            "electionDate",
            "generatedAt",
        )
    } | {
        "stateValidVotes": state_valid_votes,
        "municipalityCount": len(output_municipalities),
        "candidates": output_candidates,
        "municipalities": output_municipalities,
    }


def write_json_atomic(payload: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=output.parent, delete=False
    ) as temporary:
        temporary.write(serialized)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, output)


def main() -> None:
    args = parse_args()
    paths = {
        2018: {
            "governor": args.section_2018.resolve(),
            "president": args.president_2018.resolve(),
            "candidates": args.candidates_2018.resolve(),
        },
        2022: {
            "governor": args.section_2022.resolve(),
            "president": args.president_2022.resolve(),
            "candidates": args.candidates_2022.resolve(),
        },
    }
    for year, year_paths in paths.items():
        for label, path in year_paths.items():
            if not path.is_file():
                raise FileNotFoundError(
                    f"ZIP oficial {label} de {year} não foi encontrado: {path}."
                )

    tse_to_ibge, municipality_names = load_municipality_mapping(
        args.electorate_file.resolve()
    )
    candidate_catalog: dict[int, dict[str, dict[str, Any]]] = {}
    finalized_contests: list[dict[str, Any]] = []
    source_rows = 0
    selected_rows = 0

    for year in YEARS:
        year_paths = paths[year]
        candidate_catalog[year] = load_candidates(year_paths["candidates"], year)
        governor_contests, governor_source_rows, governor_selected_rows = aggregate_sections(
            year_paths["governor"],
            year,
            candidate_catalog[year],
            tse_to_ibge,
            {3},
        )
        president_contests, president_source_rows, president_selected_rows = aggregate_sections(
            year_paths["president"],
            year,
            candidate_catalog[year],
            tse_to_ibge,
            {1},
            skip_unmapped_municipalities=True,
        )
        contests = governor_contests | president_contests
        source_rows += governor_source_rows + president_source_rows
        selected_rows += governor_selected_rows + president_selected_rows
        finalized_contests.extend(
            finalize_contest(contest, candidate_catalog[year], municipality_names)
            for contest in contests.values()
        )

    finalized_contests.sort(
        key=lambda contest: (
            -int(contest["electionYear"]),
            int(contest["officeCode"]),
            int(contest["round"]),
        )
    )
    expected_ids = {
        f"{year}-{office_code}-{round_number}"
        for year in YEARS
        for office_code in OFFICES
        for round_number in (1, 2)
    }
    if {contest["id"] for contest in finalized_contests} != expected_ids:
        actual_ids = sorted(contest["id"] for contest in finalized_contests)
        raise RuntimeError(
            "Os oito pleitos esperados de 2018/2022 não foram encontrados. "
            f"Encontrados: {actual_ids}."
        )

    payload = {
        "metadata": {
            "state": STATE,
            "years": list(YEARS),
            "offices": list(OFFICES.values()),
            "rounds": [1, 2],
            "source": "Tribunal Superior Eleitoral (TSE) — Dados Abertos",
            "dataset": "Votação por seção e Consulta de candidaturas",
            "sourceUrl": SOURCE_URL,
            "processedAtUtc": datetime.now(UTC).replace(microsecond=0).isoformat(),
            "municipalityCount": EXPECTED_MUNICIPALITIES,
            "contestCount": len(finalized_contests),
            "municipalResultCount": sum(
                len(contest["municipalities"]) for contest in finalized_contests
            ),
            "sourceRows": source_rows,
            "selectedRows": selected_rows,
            "privacyLevel": "Resultados públicos agregados por município; sem dados de eleitores.",
            "inputFiles": {
                f"governorSections{year}": {
                    "name": paths[year]["governor"].name,
                    "sha256": sha256(paths[year]["governor"]),
                }
                for year in YEARS
            }
            | {
                f"presidentSections{year}": {
                    "name": paths[year]["president"].name,
                    "sha256": sha256(paths[year]["president"]),
                }
                for year in YEARS
            }
            | {
                f"candidates{year}": {
                    "name": paths[year]["candidates"].name,
                    "sha256": sha256(paths[year]["candidates"]),
                }
                for year in YEARS
            },
        },
        "contests": finalized_contests,
    }
    write_json_atomic(payload, args.output.resolve())
    print(
        f"Histórico TSE gerado: {args.output.resolve()} · "
        f"{len(finalized_contests)} pleitos · "
        f"{payload['metadata']['municipalResultCount']} resultados municipais."
    )


if __name__ == "__main__":
    main()
