#!/usr/bin/env python3
"""Processa o perfil do eleitorado de 2026 para o mapa municipal de Goiás.

O script lê diretamente os ZIPs oficiais do TSE, sem extrair os CSVs gigantes,
relaciona os códigos municipais TSE/IBGE e gera um JSON pequeno para o React.
Usa apenas a biblioteca padrão do Python.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterable
from zipfile import ZipFile


STATE = "GO"
EXPECTED_MUNICIPALITIES = 246
SOURCE_ENCODING = "latin-1"

PROFILE_REQUIRED_COLUMNS = {
    "DT_GERACAO",
    "SG_UF",
    "CD_MUNICIPIO",
    "NM_MUNICIPIO",
    "NR_ZONA",
    "DS_GENERO",
    "DS_FAIXA_ETARIA",
    "QT_ELEITORES",
    "QT_ELEITORES_BIOMETRIA",
    "QT_ELEITORES_DEFICIENCIA",
    "QT_ELEITORES_NOME_SOCIAL",
}

MAPPING_REQUIRED_COLUMNS = {
    "DT_GERACAO",
    "SG_UF",
    "CD_MUNICIPIO_TSE",
    "NM_MUNICIPIO_TSE",
    "CD_MUNICIPIO_IBGE",
    "NM_MUNICIPIO_IBGE",
}


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Gera os indicadores municipais do eleitorado de Goiás.",
    )
    parser.add_argument(
        "--profile-zip",
        type=Path,
        required=True,
        help="Caminho para perfil_eleitorado_2026.zip.",
    )
    parser.add_argument(
        "--mapping-zip",
        type=Path,
        required=True,
        help="Caminho para municipio_tse_ibge.zip.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
        help="JSON de saída (padrão: src/data/electorate-go.json).",
    )
    return parser.parse_args()


def require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"{label} não encontrado: {path}")


def find_member(archive: ZipFile, suffix: str, label: str) -> str:
    matches = [name for name in archive.namelist() if name.lower().endswith(suffix)]
    if len(matches) != 1:
        raise RuntimeError(
            f"Esperado exatamente um {label} terminado em {suffix!r}; "
            f"encontrados: {matches}"
        )
    return matches[0]


def open_csv(raw: BinaryIO) -> csv.DictReader:
    text = io.TextIOWrapper(raw, encoding=SOURCE_ENCODING, newline="")
    return csv.DictReader(text, delimiter=";", quotechar='"')


def validate_columns(
    fieldnames: Iterable[str] | None,
    required: set[str],
    label: str,
) -> None:
    available = set(fieldnames or [])
    missing = sorted(required - available)
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


def normalize_code(value: str | None) -> str:
    return (value or "").strip().zfill(5)


def normalize_label(value: str | None) -> str:
    return " ".join((value or "NÃO INFORMADO").strip().split())


def normalize_municipality_name(value: str | None) -> str:
    words = normalize_label(value).split()
    connectors = {"Da", "Das", "De", "Do", "Dos", "E"}
    return " ".join(
        word.lower() if index > 0 and word in connectors else word
        for index, word in enumerate(words)
    )


def ascii_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char)).upper()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_mapping(path: Path) -> tuple[dict[str, dict[str, str]], str, int]:
    mapping: dict[str, dict[str, str]] = {}
    generation_dates: set[str] = set()
    row_count = 0

    with ZipFile(path) as archive:
        member = find_member(archive, "municipio_tse_ibge.csv", "CSV de códigos")
        with archive.open(member) as raw:
            reader = open_csv(raw)
            validate_columns(reader.fieldnames, MAPPING_REQUIRED_COLUMNS, member)

            for row_count, row in enumerate(reader, start=2):
                if row["SG_UF"].strip().upper() != STATE:
                    continue

                tse_code = normalize_code(row["CD_MUNICIPIO_TSE"])
                ibge_code = row["CD_MUNICIPIO_IBGE"].strip()
                entry = {
                    "tseCode": tse_code,
                    "tseName": normalize_label(row["NM_MUNICIPIO_TSE"]),
                    "ibgeCode": ibge_code,
                    "name": normalize_municipality_name(row["NM_MUNICIPIO_IBGE"]),
                }

                previous = mapping.get(tse_code)
                if previous and previous != entry:
                    raise RuntimeError(
                        f"Código TSE {tse_code} possui correspondências conflitantes: "
                        f"{previous} e {entry}"
                    )

                mapping[tse_code] = entry
                generation_dates.add(row["DT_GERACAO"].strip())

    if len(mapping) != EXPECTED_MUNICIPALITIES:
        raise RuntimeError(
            f"A correspondência possui {len(mapping)} municípios de Goiás; "
            f"esperados {EXPECTED_MUNICIPALITIES}."
        )
    if len(generation_dates) != 1:
        raise RuntimeError(
            f"Datas de geração inesperadas na correspondência: {generation_dates}"
        )

    return mapping, generation_dates.pop(), row_count


def new_accumulator(name: str) -> dict[str, Any]:
    return {
        "tseName": name,
        "electorate": 0,
        "biometrics": 0,
        "disability": 0,
        "socialName": 0,
        "zones": set(),
        "ageGroups": defaultdict(int),
        "genderGroups": defaultdict(int),
    }


def load_profile(path: Path) -> tuple[dict[str, dict[str, Any]], str, int]:
    totals: dict[str, dict[str, Any]] = {}
    generation_dates: set[str] = set()
    processed_rows = 0

    with ZipFile(path) as archive:
        member = find_member(
            archive,
            f"perfil_eleitorado_2026_{STATE.lower()}.csv",
            "CSV do perfil eleitoral de Goiás",
        )
        with archive.open(member) as raw:
            reader = open_csv(raw)
            validate_columns(reader.fieldnames, PROFILE_REQUIRED_COLUMNS, member)

            for row_number, row in enumerate(reader, start=2):
                if row["SG_UF"].strip().upper() != STATE:
                    raise RuntimeError(
                        f"UF inesperada na linha {row_number}: {row['SG_UF']!r}"
                    )

                processed_rows += 1
                tse_code = normalize_code(row["CD_MUNICIPIO"])
                municipality = totals.setdefault(
                    tse_code,
                    new_accumulator(normalize_label(row["NM_MUNICIPIO"])),
                )

                electorate = parse_int(row["QT_ELEITORES"], "QT_ELEITORES", row_number)
                municipality["electorate"] += electorate
                municipality["biometrics"] += parse_int(
                    row["QT_ELEITORES_BIOMETRIA"],
                    "QT_ELEITORES_BIOMETRIA",
                    row_number,
                )
                municipality["disability"] += parse_int(
                    row["QT_ELEITORES_DEFICIENCIA"],
                    "QT_ELEITORES_DEFICIENCIA",
                    row_number,
                )
                municipality["socialName"] += parse_int(
                    row["QT_ELEITORES_NOME_SOCIAL"],
                    "QT_ELEITORES_NOME_SOCIAL",
                    row_number,
                )
                municipality["zones"].add(row["NR_ZONA"].strip())
                municipality["ageGroups"][normalize_label(row["DS_FAIXA_ETARIA"])] += electorate
                municipality["genderGroups"][normalize_label(row["DS_GENERO"])] += electorate
                generation_dates.add(row["DT_GERACAO"].strip())

    if len(totals) != EXPECTED_MUNICIPALITIES:
        raise RuntimeError(
            f"O perfil possui {len(totals)} municípios de Goiás; "
            f"esperados {EXPECTED_MUNICIPALITIES}."
        )
    if len(generation_dates) != 1:
        raise RuntimeError(f"Datas de geração inesperadas no perfil: {generation_dates}")

    return totals, generation_dates.pop(), processed_rows


def quantile_thresholds(values: list[int]) -> list[int]:
    ordered = sorted(values)
    thresholds: list[int] = []
    for quantile in (0.2, 0.4, 0.6, 0.8):
        index = max(0, math.ceil(quantile * len(ordered)) - 1)
        thresholds.append(ordered[index])
    return thresholds


def top_age_group(age_groups: dict[str, int]) -> tuple[str, int]:
    eligible = {
        label: count
        for label, count in age_groups.items()
        if ascii_key(label) not in {"INVALIDO", "NAO INFORMADO"}
    }
    source = eligible or age_groups
    return max(source.items(), key=lambda item: (item[1], item[0]))


def build_output(
    mapping: dict[str, dict[str, str]],
    totals: dict[str, dict[str, Any]],
    profile_date: str,
    mapping_date: str,
    processed_rows: int,
    profile_path: Path,
    mapping_path: Path,
) -> dict[str, Any]:
    missing_mapping = sorted(set(totals) - set(mapping))
    missing_profile = sorted(set(mapping) - set(totals))
    if missing_mapping or missing_profile:
        raise RuntimeError(
            "Cobertura TSE/IBGE incompleta. "
            f"Sem correspondência: {missing_mapping}; sem perfil: {missing_profile}"
        )

    state_total = sum(item["electorate"] for item in totals.values())
    if state_total <= 0:
        raise RuntimeError("O total estadual do eleitorado é inválido.")

    ordered_codes = sorted(
        totals,
        key=lambda code: (-totals[code]["electorate"], mapping[code]["name"]),
    )
    ranks: dict[str, int] = {}
    previous_total: int | None = None
    previous_rank = 0
    for position, code in enumerate(ordered_codes, start=1):
        total = totals[code]["electorate"]
        rank = previous_rank if total == previous_total else position
        ranks[code] = rank
        previous_total = total
        previous_rank = rank

    municipalities: dict[str, dict[str, Any]] = {}
    used_ibge_codes: set[str] = set()

    for tse_code, aggregate in totals.items():
        correspondence = mapping[tse_code]
        ibge_code = correspondence["ibgeCode"]
        if ibge_code in used_ibge_codes:
            raise RuntimeError(f"Código IBGE duplicado na saída: {ibge_code}")
        used_ibge_codes.add(ibge_code)

        gender_groups = {
            ascii_key(label): count
            for label, count in aggregate["genderGroups"].items()
        }
        female = gender_groups.get("FEMININO", 0)
        male = gender_groups.get("MASCULINO", 0)
        not_informed = aggregate["electorate"] - female - male
        age_label, age_count = top_age_group(dict(aggregate["ageGroups"]))

        if sum(aggregate["ageGroups"].values()) != aggregate["electorate"]:
            raise RuntimeError(f"Faixas etárias não fecham para {tse_code}.")
        if sum(aggregate["genderGroups"].values()) != aggregate["electorate"]:
            raise RuntimeError(f"Gêneros não fecham para {tse_code}.")
        if not_informed < 0:
            raise RuntimeError(f"Distribuição de gênero inválida para {tse_code}.")

        electorate = aggregate["electorate"]
        for field in ("biometrics", "disability", "socialName"):
            value = aggregate[field]
            if value < 0 or value > electorate:
                raise RuntimeError(
                    f"Contagem {field} inválida para {tse_code}: "
                    f"{value} de {electorate}."
                )

        municipalities[ibge_code] = {
            "ibgeCode": ibge_code,
            "tseCode": tse_code,
            "name": correspondence["name"],
            "electorate": electorate,
            "stateSharePct": round(electorate / state_total * 100, 4),
            "stateRank": ranks[tse_code],
            "zoneCount": len(aggregate["zones"]),
            "biometrics": aggregate["biometrics"],
            "biometricsPct": round(aggregate["biometrics"] / electorate * 100, 2),
            "registeredDisability": aggregate["disability"],
            "socialName": aggregate["socialName"],
            "topAgeGroup": {
                "label": age_label,
                "electorate": age_count,
                "percentage": round(age_count / electorate * 100, 2),
            },
            "gender": {
                "female": female,
                "male": male,
                "notInformed": not_informed,
            },
        }

    return {
        "metadata": {
            "state": STATE,
            "year": 2026,
            "source": "Tribunal Superior Eleitoral (TSE) — Sistema ELO",
            "dataset": "Eleitorado - 2026",
            "profileGeneratedAt": profile_date,
            "mappingGeneratedAt": mapping_date,
            "processedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "processedRows": processed_rows,
            "municipalityCount": len(municipalities),
            "stateElectorate": state_total,
            "electorateThresholds": quantile_thresholds(
                [item["electorate"] for item in municipalities.values()]
            ),
            "inputFiles": {
                "profile": {
                    "name": profile_path.name,
                    "sha256": sha256(profile_path),
                },
                "mapping": {
                    "name": mapping_path.name,
                    "sha256": sha256(mapping_path),
                },
            },
        },
        "municipalities": dict(sorted(municipalities.items())),
    }


def main() -> None:
    args = parse_args()
    require_file(args.profile_zip, "ZIP do perfil eleitoral")
    require_file(args.mapping_zip, "ZIP da correspondência TSE/IBGE")

    mapping, mapping_date, mapping_rows = load_mapping(args.mapping_zip)
    totals, profile_date, processed_rows = load_profile(args.profile_zip)
    output = build_output(
        mapping,
        totals,
        profile_date,
        mapping_date,
        processed_rows,
        args.profile_zip,
        args.mapping_zip,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    metadata = output["metadata"]
    top_five = sorted(
        output["municipalities"].values(),
        key=lambda item: item["stateRank"],
    )[:5]
    print(f"Linhas do perfil processadas: {processed_rows:,}")
    print(f"Linhas percorridas na correspondência: {mapping_rows:,}")
    print(f"Municípios relacionados: {metadata['municipalityCount']}")
    print(f"Eleitorado total de Goiás: {metadata['stateElectorate']:,}")
    print(f"Faixas do mapa: {metadata['electorateThresholds']}")
    print("Cinco maiores eleitorados:")
    for municipality in top_five:
        print(
            f"  {municipality['stateRank']}º {municipality['name']}: "
            f"{municipality['electorate']:,}"
        )
    print(f"JSON gerado em: {args.output}")


if __name__ == "__main__":
    main()
