#!/usr/bin/env python3
"""Gera um fixture SINTÉTICO no formato dos ZIPs de votação por partido do TSE.

Os números aqui não são dados oficiais: são inventados para exercitar o
scripts/process_tse_municipal.py sem baixar os pacotes reais de centenas de MB.
O fixture reproduz o formato do TSE (CSV ISO-8859-1, separador ";", campos entre
aspas) e cobre, de propósito, os casos que o processamento precisa tratar:

* dois anos com nomes diferentes das colunas de voto (2020 sem o sufixo
  _VALIDOS, 2024 com o sufixo);
* dois cargos (11 Prefeito e 13 Vereador) e dois turnos;
* várias zonas eleitorais no mesmo município, que precisam ser somadas;
* linhas de eleição suplementar (CD_TIPO_ELEICAO=1) e de outra UF, que precisam
  ser descartadas e contadas;
* um par partido/município com zero votos, que precisa ser omitido da saída;
* uma sigla fictícia fora do party-spectrum.json, que precisa disparar o alerta;
* cobertura municipal parcial em Prefeito, aceita pelo processamento.

Os códigos TSE/IBGE dos dois municípios vêm de src/data/electorate-go.json para
que a correspondência oficial continue valendo. Uso:

    python3 scripts/tests/party_votes_fixture.py
    python3 scripts/process_tse_municipal.py \
        --input-dir scripts/tests/fixtures/party-votes \
        --electorate-file scripts/tests/fixtures/party-votes/electorate-fixture.json \
        --output scripts/tests/fixtures/party-votes/party-votes-go.json \
        --expected-municipalities 2
"""

from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

STATE = "GO"
SOURCE_ENCODING = "latin-1"
GENERATION_DATE = "01/01/2026"
ELECTION_DATES = {(2020, 1): "15/11/2020", (2024, 1): "06/10/2024", (2024, 2): "27/10/2024"}
ELECTION_CODES = {2020: "426", 2024: "619"}
OFFICES = {11: "Prefeito", 13: "Vereador"}

MUNICIPALITIES = ("88013", "85995")
PARTIES = {
    "PT": ("13", "Partido dos Trabalhadores"),
    "PL": ("22", "Partido Liberal"),
    "PXS": ("99", "Partido Sintetico de Teste"),
}

COLUMNS = (
    "DT_GERACAO",
    "HH_GERACAO",
    "ANO_ELEICAO",
    "CD_TIPO_ELEICAO",
    "NM_TIPO_ELEICAO",
    "NR_TURNO",
    "CD_ELEICAO",
    "DS_ELEICAO",
    "DT_ELEICAO",
    "TP_ABRANGENCIA",
    "SG_UF",
    "SG_UE",
    "NM_UE",
    "CD_MUNICIPIO",
    "NM_MUNICIPIO",
    "NR_ZONA",
    "CD_CARGO",
    "DS_CARGO",
    "TP_AGREMIACAO",
    "NR_PARTIDO",
    "SG_PARTIDO",
    "NM_PARTIDO",
    "ST_VOTO_EM_TRANSITO",
)

# (ano, turno, cargo, código TSE, zona, sigla, votos nominais, votos de legenda)
VOTES = (
    (2020, 1, 13, "88013", 1, "PT", 1200, 100),
    (2020, 1, 13, "88013", 1, "PL", 900, 80),
    (2020, 1, 13, "88013", 1, "PXS", 50, 5),
    (2020, 1, 13, "88013", 2, "PT", 800, 60),
    (2020, 1, 13, "88013", 2, "PL", 1100, 70),
    (2020, 1, 13, "88013", 2, "PXS", 30, 0),
    (2020, 1, 13, "85995", 10, "PT", 400, 20),
    (2020, 1, 13, "85995", 10, "PL", 700, 30),
    (2020, 1, 13, "85995", 10, "PXS", 0, 0),
    (2020, 1, 11, "88013", 1, "PT", 1500, 0),
    (2020, 1, 11, "88013", 1, "PL", 1400, 0),
    (2020, 1, 11, "88013", 2, "PT", 900, 0),
    (2020, 1, 11, "88013", 2, "PL", 1000, 0),
    (2020, 1, 11, "85995", 10, "PT", 600, 0),
    (2020, 1, 11, "85995", 10, "PL", 800, 0),
    (2024, 1, 13, "88013", 1, "PT", 1000, 90),
    (2024, 1, 13, "88013", 1, "PL", 1300, 120),
    (2024, 1, 13, "88013", 1, "PXS", 40, 10),
    (2024, 1, 13, "88013", 2, "PT", 700, 50),
    (2024, 1, 13, "88013", 2, "PL", 1200, 110),
    (2024, 1, 13, "85995", 10, "PT", 300, 10),
    (2024, 1, 13, "85995", 10, "PL", 900, 60),
    (2024, 1, 13, "85995", 10, "PXS", 20, 0),
    (2024, 1, 11, "88013", 1, "PT", 1800, 0),
    (2024, 1, 11, "88013", 1, "PL", 1700, 0),
    (2024, 1, 11, "88013", 2, "PT", 1100, 0),
    (2024, 1, 11, "88013", 2, "PL", 1200, 0),
    (2024, 2, 11, "88013", 1, "PT", 2000, 0),
    (2024, 2, 11, "88013", 1, "PL", 2100, 0),
    (2024, 2, 11, "88013", 2, "PT", 1300, 0),
    (2024, 2, 11, "88013", 2, "PL", 1400, 0),
)

# Linhas que o processamento precisa descartar, com votos absurdos de propósito.
DISCARDED = (
    (2020, 1, 13, "88013", 1, "PT", 999999, 999999, 1, STATE),
    (2024, 1, 13, "88013", 1, "PL", 888888, 888888, 1, STATE),
    (2024, 1, 13, "88013", 1, "PT", 777777, 777777, 2, "SC"),
)


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        description="Gera o fixture sintético de votação por partido do TSE.",
    )
    parser.add_argument(
        "--electorate-file",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
        help="JSON oficial do eleitorado, usado só para copiar os códigos TSE/IBGE.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root / "scripts" / "tests" / "fixtures" / "party-votes",
        help="Diretório onde os ZIPs sintéticos serão gravados.",
    )
    return parser.parse_args()


def load_municipalities(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        raise FileNotFoundError(f"JSON do eleitorado não encontrado: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    by_tse_code = {
        str(record["tseCode"]).zfill(5): {
            "ibgeCode": str(ibge_code),
            "tseCode": str(record["tseCode"]).zfill(5),
            "name": str(record["name"]),
        }
        for ibge_code, record in payload["municipalities"].items()
    }
    selected: dict[str, dict[str, str]] = {}
    for tse_code in MUNICIPALITIES:
        record = by_tse_code.get(tse_code)
        if not record:
            raise RuntimeError(f"Código TSE {tse_code} não existe na base municipal.")
        selected[tse_code] = record
    return selected


def build_row(
    year: int,
    round_number: int,
    office_code: int,
    tse_code: int | str,
    zone: int,
    party_code: str,
    municipality_name: str,
    election_type: int,
    uf: str,
) -> dict[str, str]:
    party_number, party_name = PARTIES[party_code]
    return {
        "DT_GERACAO": GENERATION_DATE,
        "HH_GERACAO": "03:00:00",
        "ANO_ELEICAO": str(year),
        "CD_TIPO_ELEICAO": str(election_type),
        "NM_TIPO_ELEICAO": (
            "Eleição Ordinária" if election_type == 2 else "Eleição Suplementar"
        ),
        "NR_TURNO": str(round_number),
        "CD_ELEICAO": ELECTION_CODES[year],
        "DS_ELEICAO": f"Eleições Municipais {year} (fixture sintético)",
        "DT_ELEICAO": ELECTION_DATES[(year, round_number)],
        "TP_ABRANGENCIA": "M",
        "SG_UF": uf,
        "SG_UE": str(tse_code),
        "NM_UE": municipality_name,
        "CD_MUNICIPIO": str(tse_code),
        "NM_MUNICIPIO": municipality_name,
        "NR_ZONA": str(zone),
        "CD_CARGO": str(office_code),
        "DS_CARGO": OFFICES[office_code],
        "TP_AGREMIACAO": "Partido isolado",
        "NR_PARTIDO": party_number,
        "SG_PARTIDO": party_code,
        "NM_PARTIDO": party_name,
        "ST_VOTO_EM_TRANSITO": "N",
    }


def build_csv(year: int, municipalities: dict[str, dict[str, str]]) -> bytes:
    nominal_column = "QT_VOTOS_NOMINAIS" if year == 2020 else "QT_VOTOS_NOMINAIS_VALIDOS"
    party_column = "QT_VOTOS_LEGENDA" if year == 2020 else "QT_VOTOS_LEGENDA_VALIDOS"
    columns = [*COLUMNS, nominal_column, party_column]

    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(
        buffer,
        fieldnames=columns,
        delimiter=";",
        quotechar='"',
        quoting=csv.QUOTE_ALL,
        lineterminator="\r\n",
    )
    writer.writeheader()

    entries = [
        (*entry, 2, STATE)
        for entry in VOTES
        if entry[0] == year
    ] + [entry for entry in DISCARDED if entry[0] == year]
    for (
        row_year,
        round_number,
        office_code,
        tse_code,
        zone,
        party_code,
        nominal_votes,
        party_votes,
        election_type,
        uf,
    ) in entries:
        row = build_row(
            row_year,
            round_number,
            office_code,
            tse_code,
            zone,
            party_code,
            municipalities[tse_code]["name"],
            election_type,
            uf,
        )
        row[nominal_column] = str(nominal_votes)
        row[party_column] = str(party_votes)
        writer.writerow(row)

    return buffer.getvalue().encode(SOURCE_ENCODING)


def write_zip(path: Path, member: str, content: bytes) -> None:
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr(member, content)
        archive.writestr(
            "leiame.txt",
            "Fixture sintético do Acquário Mapa. Não são dados oficiais do TSE.\n".encode(
                SOURCE_ENCODING
            ),
        )


def build_electorate_fixture(municipalities: dict[str, dict[str, str]]) -> dict[str, Any]:
    return {
        "metadata": {
            "mode": "synthetic-fixture",
            "state": STATE,
            "municipalityCount": len(municipalities),
            "warning": "Recorte sintético apenas para testes; não substitui electorate-go.json.",
        },
        "municipalities": {
            record["ibgeCode"]: record
            for record in sorted(municipalities.values(), key=lambda item: item["ibgeCode"])
        },
    }


def main() -> None:
    args = parse_args()
    municipalities = load_municipalities(args.electorate_file.resolve())
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    created: list[Path] = []
    for year in (2020, 2024):
        zip_path = output_dir / f"votacao_partido_munzona_{year}_{STATE}.zip"
        write_zip(
            zip_path,
            f"votacao_partido_munzona_{year}_{STATE}.csv",
            build_csv(year, municipalities),
        )
        created.append(zip_path)

    electorate_path = output_dir / "electorate-fixture.json"
    electorate_path.write_text(
        json.dumps(build_electorate_fixture(municipalities), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    created.append(electorate_path)

    print("Fixture SINTÉTICO gerado (não são dados oficiais do TSE):")
    for path in created:
        print(f"  {path}")
    print(
        f"Municípios: {len(municipalities)} · partidos: {len(PARTIES)} · "
        f"cargos: {len(OFFICES)} · linhas de voto: {len(VOTES)} · "
        f"linhas descartáveis: {len(DISCARDED)}"
    )


if __name__ == "__main__":
    main()
