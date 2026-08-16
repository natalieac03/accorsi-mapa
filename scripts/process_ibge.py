#!/usr/bin/env python3
"""Baixa e valida indicadores municipais oficiais do IBGE para Goiás.

O script usa anos de referência fixos para que todos os municípios de uma
mesma camada sejam comparáveis. Ele nunca substitui uma lacuna por outro ano.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_ROOT = "https://servicodados.ibge.gov.br/api/v1/pesquisas/indicadores"
SOURCE_NAME = "IBGE — Cidades e Estados (API de Pesquisas v1)"
SOURCE_URL = "https://servicodados.ibge.gov.br/api/docs/pesquisas"
EXPECTED_MUNICIPALITIES = 246

INDICATORS: tuple[dict[str, Any], ...] = (
    {
        "code": "populationEstimate",
        "ibgeIndicatorId": 29171,
        "label": "População estimada",
        "shortLabel": "População estimada",
        "description": "Estimativa oficial da população residente no município.",
        "referenceYear": 2025,
        "unit": "pessoas",
        "valueFormat": "integer",
        "requiredCoverage": True,
    },
    {
        "code": "censusPopulation",
        "ibgeIndicatorId": 96385,
        "label": "População no último Censo",
        "shortLabel": "População do Censo",
        "description": "População residente recenseada pelo Censo Demográfico 2022.",
        "referenceYear": 2022,
        "unit": "pessoas",
        "valueFormat": "integer",
        "requiredCoverage": True,
    },
    {
        "code": "populationDensity",
        "ibgeIndicatorId": 96386,
        "label": "Densidade demográfica",
        "shortLabel": "Densidade",
        "description": "Habitantes por quilômetro quadrado no Censo 2022.",
        "referenceYear": 2022,
        "unit": "hab./km²",
        "valueFormat": "decimal",
        "requiredCoverage": True,
    },
    {
        "code": "gdpPerCapita",
        "ibgeIndicatorId": 47001,
        "label": "PIB per capita",
        "shortLabel": "PIB per capita",
        "description": "Produto Interno Bruto municipal por habitante.",
        "referenceYear": 2023,
        "unit": "R$ por pessoa",
        "valueFormat": "currency",
        "requiredCoverage": True,
    },
    {
        "code": "schoolAttendance",
        "ibgeIndicatorId": 60045,
        "label": "Escolarização de 6 a 14 anos",
        "shortLabel": "Escolarização",
        "description": "Percentual das crianças de 6 a 14 anos que frequentam a escola.",
        "referenceYear": 2022,
        "unit": "% da faixa etária",
        "valueFormat": "percent",
        "requiredCoverage": True,
    },
    {
        "code": "occupiedPopulation",
        "ibgeIndicatorId": 60036,
        "label": "População ocupada",
        "shortLabel": "População ocupada",
        "description": "Pessoas ocupadas em relação à população do município.",
        "referenceYear": 2022,
        "unit": "% da população",
        "valueFormat": "percent",
        "requiredCoverage": True,
    },
    {
        "code": "formalAverageSalary",
        "ibgeIndicatorId": 143558,
        "label": "Salário médio dos trabalhadores formais",
        "shortLabel": "Salário formal",
        "description": "Rendimento médio mensal dos trabalhadores formais.",
        "referenceYear": 2024,
        "unit": "salários mínimos",
        "valueFormat": "decimal",
        "requiredCoverage": True,
    },
    {
        "code": "adequateSanitation",
        "ibgeIndicatorId": 60030,
        "label": "Esgotamento sanitário adequado",
        "shortLabel": "Saneamento adequado",
        "description": "Domicílios com esgotamento sanitário considerado adequado.",
        "referenceYear": 2022,
        "unit": "% dos domicílios",
        "valueFormat": "percent",
        "requiredCoverage": False,
    },
    {
        "code": "lowIncomePopulation",
        "ibgeIndicatorId": 60037,
        "label": "População com renda per capita de até 1/2 salário mínimo",
        "shortLabel": "Renda baixa",
        "description": "Indicador histórico de população com renda nominal mensal per capita de até meio salário mínimo.",
        "referenceYear": 2010,
        "unit": "% da população",
        "valueFormat": "percent",
        "requiredCoverage": False,
    },
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gera o snapshot socioeconômico municipal a partir da API do IBGE."
    )
    parser.add_argument(
        "--electorate-file",
        default="src/data/electorate-go.json",
        help="JSON eleitoral validado que fornece os 246 códigos IBGE.",
    )
    parser.add_argument(
        "--output",
        default="src/data/socioeconomic-go.json",
        help="Destino do snapshot validado.",
    )
    parser.add_argument("--batch-size", type=int, default=40)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=60)
    return parser.parse_args()


def load_municipalities(path: Path) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    metadata = payload.get("metadata", {})
    records = payload.get("municipalities")
    if (
        metadata.get("state") != "GO"
        or metadata.get("municipalityCount") != EXPECTED_MUNICIPALITIES
        or not isinstance(records, dict)
        or len(records) != EXPECTED_MUNICIPALITIES
    ):
        raise SystemExit("A base eleitoral não contém o recorte validado de 246 municípios de Goiás.")

    result: dict[str, str] = {}
    short_codes: set[str] = set()
    for key, record in records.items():
        if not isinstance(record, dict):
            raise SystemExit(f"Registro municipal inválido: {key}.")
        code = str(record.get("ibgeCode", ""))
        name = str(record.get("name", "")).strip()
        if code != key or len(code) != 7 or not code.isdigit() or not name:
            raise SystemExit(f"Código ou nome municipal inválido: {key}.")
        short_code = code[:6]
        if short_code in short_codes:
            raise SystemExit(f"Código IBGE de seis dígitos duplicado: {short_code}.")
        short_codes.add(short_code)
        result[code] = name
    return result


def parse_number(value: object) -> float | None:
    if value is None:
        return None
    normalized = str(value).strip().replace(",", ".")
    if normalized in {"", "-", "..", "...", "X"}:
        return None
    try:
        number = float(normalized)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def fetch_batch(short_codes: list[str], timeout: int) -> list[dict[str, Any]]:
    indicator_path = "%7C".join(str(item["ibgeIndicatorId"]) for item in INDICATORS)
    locality_path = "%7C".join(short_codes)
    url = f"{API_ROOT}/{indicator_path}/resultados/{locality_path}"
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "ACCORSI-Dia9/1.0 (dados publicos agregados)",
        },
    )

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read()
            if raw.startswith(b"\x1f\x8b"):
                raw = gzip.decompress(raw)
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, list):
                raise ValueError("Resposta do IBGE não é uma lista JSON.")
            return payload
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Falha ao consultar o IBGE após três tentativas: {last_error}")


def collect_values(
    municipality_names: dict[str, str], batch_size: int, workers: int, timeout: int
) -> dict[int, dict[str, float]]:
    if not 1 <= batch_size <= 60:
        raise SystemExit("--batch-size deve estar entre 1 e 60.")
    if not 1 <= workers <= 8:
        raise SystemExit("--workers deve estar entre 1 e 8.")

    short_to_full = {code[:6]: code for code in municipality_names}
    short_codes = list(short_to_full)
    batches = [short_codes[index : index + batch_size] for index in range(0, len(short_codes), batch_size)]
    values: dict[int, dict[str, float]] = {
        int(item["ibgeIndicatorId"]): {} for item in INDICATORS
    }

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(fetch_batch, batch, timeout) for batch in batches]
        for future in as_completed(futures):
            for item in future.result():
                indicator_id = int(item.get("id", -1))
                if indicator_id not in values:
                    continue
                definition = next(
                    definition
                    for definition in INDICATORS
                    if int(definition["ibgeIndicatorId"]) == indicator_id
                )
                year = str(definition["referenceYear"])
                for result in item.get("res", []):
                    if not isinstance(result, dict):
                        continue
                    full_code = short_to_full.get(str(result.get("localidade", "")))
                    yearly_values = result.get("res")
                    if not full_code or not isinstance(yearly_values, dict):
                        continue
                    number = parse_number(yearly_values.get(year))
                    if number is not None:
                        values[indicator_id][full_code] = number
    return values


def build_payload(
    municipality_names: dict[str, str], values: dict[int, dict[str, float]]
) -> dict[str, Any]:
    indicator_metadata: list[dict[str, Any]] = []
    for definition in INDICATORS:
        indicator_id = int(definition["ibgeIndicatorId"])
        covered = values[indicator_id]
        missing = sorted(set(municipality_names) - set(covered))
        if definition["requiredCoverage"] and missing:
            raise SystemExit(
                f"O indicador {definition['code']} não cobriu os 246 municípios: "
                f"{', '.join(missing[:10])}."
            )
        indicator_metadata.append(
            {
                **definition,
                "coverageCount": len(covered),
                "missingMunicipalityCodes": missing,
            }
        )

    municipalities: dict[str, dict[str, Any]] = {}
    for code, name in sorted(municipality_names.items()):
        municipal_values: dict[str, int | float | None] = {}
        for definition in INDICATORS:
            indicator_id = int(definition["ibgeIndicatorId"])
            raw_value = values[indicator_id].get(code)
            if raw_value is None:
                municipal_values[str(definition["code"])] = None
            elif definition["valueFormat"] == "integer":
                municipal_values[str(definition["code"])] = int(round(raw_value))
            else:
                municipal_values[str(definition["code"])] = raw_value
        municipalities[code] = {
            "ibgeCode": code,
            "name": name,
            "values": municipal_values,
        }

    return {
        "metadata": {
            "state": "GO",
            "municipalityCount": EXPECTED_MUNICIPALITIES,
            "source": SOURCE_NAME,
            "sourceUrl": SOURCE_URL,
            "apiVersion": "1",
            "retrievedAtUtc": datetime.now(UTC).replace(microsecond=0).isoformat(),
            "indicatorCount": len(INDICATORS),
            "indicators": indicator_metadata,
        },
        "municipalities": municipalities,
    }


def write_json_atomic(payload: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=output.parent, delete=False
    ) as temporary:
        temporary.write(serialized)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, output)


def main() -> None:
    args = parse_args()
    electorate_path = Path(args.electorate_file).resolve()
    output_path = Path(args.output).resolve()
    municipalities = load_municipalities(electorate_path)
    values = collect_values(
        municipalities,
        batch_size=args.batch_size,
        workers=args.workers,
        timeout=args.timeout,
    )
    payload = build_payload(municipalities, values)
    write_json_atomic(payload, output_path)

    print(f"Snapshot IBGE gerado: {output_path}")
    for indicator in payload["metadata"]["indicators"]:
        print(
            f"- {indicator['code']} ({indicator['referenceYear']}): "
            f"{indicator['coverageCount']}/{EXPECTED_MUNICIPALITIES}"
        )


if __name__ == "__main__":
    main()
