#!/usr/bin/env python3
"""Gera um fixture SINTÉTICO no formato dos arquivos de seção e de locais do TSE.

Nada aqui é dado oficial: os votos, os endereços e as coordenadas são inventados
para exercitar o scripts/process_tse_sections.py sem baixar os pacotes reais de
centenas de MB. Só os códigos TSE/IBGE dos dois municípios vêm de
src/data/electorate-go.json, para que a correspondência oficial continue valendo.

O fixture reproduz o formato do TSE (CSV ISO-8859-1, separador ";", campos entre
aspas) e cobre, de propósito, os casos que o processamento precisa tratar:

* dois pleitos: Presidente (pacote BR) e Governador (pacote da UF) de 2022;
* 3 locais de votação reunindo 6 seções em 2 municípios, com 3 siglas;
* duas candidaturas da mesma sigla na mesma seção, que precisam somar;
* uma seção que vota mas não está no cadastro de locais (votos órfãos, dentro do
  limite de 2% do município);
* linhas de eleição suplementar, de outra UF, de outro cargo e de branco/nulo,
  que precisam ser descartadas e contadas;
* uma sigla fictícia fora do party-spectrum.json, que precisa disparar o alerta;
* um par local/sigla com zero votos, que precisa ser omitido da saída;
* um local sem coordenada (sentinela -1), um sem bairro e um CEP de 5 dígitos;
* uma seção com geocodificação divergente do resto do local, que precisa ser
  contada como divergência sem quebrar o processamento.

São gravados dois cadastros de locais para exercitar a detecção de colunas: o
"atual" (NM_BAIRRO, NR_LATITUDE/NR_LONGITUDE, QT_ELEITOR) e o "legado", sem
coordenadas nem eleitorado e com DS_BAIRRO no lugar de NM_BAIRRO. Uso:

    python3 scripts/tests/sections_fixture.py
    python3 scripts/process_tse_sections.py \
        --sections-dir scripts/tests/fixtures/polling \
        --places-file scripts/tests/fixtures/polling/eleitorado_local_votacao.zip \
        --electorate-file scripts/tests/fixtures/polling/electorate-fixture.json \
        --output-dir scripts/tests/fixtures/polling/out \
        --years 2022 \
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
YEAR = 2022
GENERATION_DATE = "01/01/2026"
ELECTION_DATE = "02/10/2022"
ELECTION_CODE = "544"
OFFICES = {1: "Presidente", 3: "Governador"}
MUNICIPALITIES = ("88013", "85995")
PARTIES = {
    "PT": ("13", "Partido dos Trabalhadores"),
    "PL": ("22", "Partido Liberal"),
    "PXS": ("99", "Partido Sintetico de Teste"),
}

# (código TSE, zona, seção, local, eleitorado da seção)
SECTIONS = (
    ("88013", 1, 1, 1015, 700),
    ("88013", 1, 2, 1015, 690),
    ("88013", 1, 3, 1023, 640),
    ("88013", 1, 4, 1023, 630),
    ("85995", 10, 101, 2010, 610),
    ("85995", 10, 102, 2010, 600),
)

# Cadastro sintético dos 3 locais: nome, endereço, bairro, CEP, latitude, longitude.
PLACES = {
    ("88013", 1, 1015): (
        "ESCOLA ESTADUAL SINTETICA ALFA",
        "RUA DOS ANDRADAS, 1000",
        "CENTRO HISTÓRICO",
        "90010270",
        "-30.03310",
        "-51.23000",
    ),
    ("88013", 1, 1023): (
        "ESCOLA MUNICIPAL SINTETICA BETA",
        "AVENIDA SINTETICA, 250",
        "#NULO#",
        "90230",
        "-30.05120",
        "-51.19870",
    ),
    ("85995", 10, 2010): (
        "COLEGIO SINTETICO GAMA",
        "RUA SINTETICA DAS FLORES, 77",
        "SÃO PELEGRINO",
        "95020260",
        "-1",
        "-1",
    ),
}

# Seção 2 repete o local 1015 com coordenada levemente diferente: divergência esperada.
DIVERGENT_COORDINATES = {("88013", 1, 2): ("-30.03320", "-51.23010")}

# Seção que vota sem constar no cadastro de locais: gera votos órfãos.
ORPHAN_SECTION = ("88013", 1, 9)

CANDIDATES = {
    (1, "PT"): ("280000000001", "13", "Candidata Sintetica Um"),
    (1, "PT2"): ("280000000002", "13", "Candidato Sintetico Dois"),
    (1, "PL"): ("280000000003", "22", "Candidato Sintetico Tres"),
    (1, "PXS"): ("280000000004", "99", "Candidata Sintetica Quatro"),
    (3, "PT"): ("210000000011", "13", "Candidato Sintetico Cinco"),
    (3, "PL"): ("210000000012", "22", "Candidata Sintetica Seis"),
    (3, "PXS"): ("210000000013", "99", "Candidato Sintetico Sete"),
}

# (cargo, código TSE, zona, seção, candidatura, votos)
VOTES = (
    (1, "88013", 1, 1, "PT", 320),
    (1, "88013", 1, 1, "PT2", 40),
    (1, "88013", 1, 1, "PL", 280),
    (1, "88013", 1, 1, "PXS", 12),
    (1, "88013", 1, 2, "PT", 300),
    (1, "88013", 1, 2, "PL", 310),
    (1, "88013", 1, 2, "PXS", 0),
    (1, "88013", 1, 3, "PT", 210),
    (1, "88013", 1, 3, "PL", 340),
    (1, "88013", 1, 3, "PXS", 8),
    (1, "88013", 1, 4, "PT", 190),
    (1, "88013", 1, 4, "PL", 360),
    (1, "88013", 1, 4, "PXS", 5),
    (1, "85995", 10, 101, "PT", 150),
    (1, "85995", 10, 101, "PL", 400),
    (1, "85995", 10, 101, "PXS", 3),
    (1, "85995", 10, 102, "PT", 130),
    (1, "85995", 10, 102, "PL", 380),
    (1, "85995", 10, 102, "PXS", 2),
    (1, "88013", 1, 9, "PT", 12),
    (1, "88013", 1, 9, "PL", 8),
    (3, "88013", 1, 1, "PT", 300),
    (3, "88013", 1, 1, "PL", 260),
    (3, "88013", 1, 1, "PXS", 15),
    (3, "88013", 1, 2, "PT", 280),
    (3, "88013", 1, 2, "PL", 300),
    (3, "88013", 1, 2, "PXS", 10),
    (3, "88013", 1, 3, "PT", 200),
    (3, "88013", 1, 3, "PL", 330),
    (3, "88013", 1, 3, "PXS", 6),
    (3, "88013", 1, 4, "PT", 180),
    (3, "88013", 1, 4, "PL", 350),
    (3, "88013", 1, 4, "PXS", 4),
    (3, "85995", 10, 101, "PT", 140),
    (3, "85995", 10, 101, "PL", 390),
    (3, "85995", 10, 101, "PXS", 0),
    (3, "85995", 10, 102, "PT", 120),
    (3, "85995", 10, 102, "PL", 370),
    (3, "85995", 10, 102, "PXS", 0),
)

# Linhas que o processamento precisa descartar, com votos absurdos de propósito.
# (cargo, código TSE, zona, seção, candidatura, votos, tipo de eleição, UF, votável, nome)
DISCARDED = (
    (1, "88013", 1, 1, "PT", 999999, 1, STATE, "", ""),
    (1, "88013", 1, 1, "", 888888, 2, STATE, "95", "BRANCO"),
    (1, "88013", 1, 1, "-1", 777777, 2, STATE, "96", "NULO"),
    (1, "81019", 1, 1, "PL", 666666, 2, "SC", "", ""),
    (6, "88013", 1, 1, "PT", 555555, 2, STATE, "", ""),
)

SECTION_COLUMNS = (
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
    "NR_SECAO",
    "CD_CARGO",
    "DS_CARGO",
    "NR_VOTAVEL",
    "NM_VOTAVEL",
    "QT_VOTOS",
    "NR_PARTIDO",
    "SG_PARTIDO",
    "NM_PARTIDO",
    "SQ_CANDIDATO",
)

PLACE_COLUMNS = (
    "DT_GERACAO",
    "HH_GERACAO",
    "AA_ELEICAO",
    "DT_ELEICAO",
    "DS_ELEICAO",
    "SG_UF",
    "CD_MUNICIPIO",
    "NM_MUNICIPIO",
    "NR_ZONA",
    "NR_SECAO",
    "NR_LOCAL_VOTACAO",
    "NM_LOCAL_VOTACAO",
    "DS_ENDERECO",
    "NR_CEP",
    "NR_TELEFONE_LOCAL",
)

# Linha de outra UF no cadastro de locais, descartada pelo filtro de SG_UF.
FOREIGN_PLACE = ("SC", "81019", "Municipio Sintetico de Outra UF", 5, 500, 9001)


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        description="Gera o fixture sintético de votação por seção e de locais de votação.",
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
        default=project_root / "scripts" / "tests" / "fixtures" / "polling",
        help="Diretório onde os arquivos sintéticos serão gravados.",
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


def write_csv(columns: tuple[str, ...], rows: list[dict[str, str]]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(
        buffer,
        fieldnames=list(columns),
        delimiter=";",
        quotechar='"',
        quoting=csv.QUOTE_ALL,
        lineterminator="\r\n",
    )
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode(SOURCE_ENCODING)


def build_section_row(
    office_code: int,
    tse_code: str,
    zone: int,
    section: int,
    candidacy: str,
    votes: int,
    election_type: int,
    uf: str,
    ballot_number: str,
    ballot_name: str,
    municipalities: dict[str, dict[str, str]],
) -> dict[str, str]:
    candidate = CANDIDATES.get((office_code, candidacy))
    party_code = candidacy.rstrip("2") if candidate else ""
    party_number, party_name = PARTIES.get(party_code, ("", ""))
    municipality = municipalities.get(tse_code)
    return {
        "DT_GERACAO": GENERATION_DATE,
        "HH_GERACAO": "03:00:00",
        "ANO_ELEICAO": str(YEAR),
        "CD_TIPO_ELEICAO": str(election_type),
        "NM_TIPO_ELEICAO": (
            "Eleição Ordinária" if election_type == 2 else "Eleição Suplementar"
        ),
        "NR_TURNO": "1",
        "CD_ELEICAO": ELECTION_CODE,
        "DS_ELEICAO": f"Eleições Gerais {YEAR} (fixture sintético)",
        "DT_ELEICAO": ELECTION_DATE,
        "TP_ABRANGENCIA": "F" if office_code == 1 else "E",
        "SG_UF": uf,
        "SG_UE": "BR" if office_code == 1 else uf,
        "NM_UE": "Brasil" if office_code == 1 else uf,
        "CD_MUNICIPIO": tse_code,
        "NM_MUNICIPIO": municipality["name"] if municipality else "Municipio Sintetico",
        "NR_ZONA": str(zone),
        "NR_SECAO": str(section),
        "CD_CARGO": str(office_code),
        "DS_CARGO": OFFICES.get(office_code, "Deputado Federal"),
        "NR_VOTAVEL": candidate[1] if candidate else ballot_number,
        "NM_VOTAVEL": candidate[2] if candidate else ballot_name,
        "QT_VOTOS": str(votes),
        "NR_PARTIDO": party_number,
        "SG_PARTIDO": party_code if candidate else "#NULO#",
        "NM_PARTIDO": party_name if candidate else "#NULO#",
        "SQ_CANDIDATO": candidate[0] if candidate else candidacy,
    }


def build_section_csv(office_code: int, municipalities: dict[str, dict[str, str]]) -> bytes:
    entries = [
        (*entry, 2, STATE, "", "")
        for entry in VOTES
        if entry[0] == office_code
    ] + [entry for entry in DISCARDED if entry[0] in (office_code, 6)]
    rows = [
        build_section_row(*entry, municipalities=municipalities)
        for entry in entries
    ]
    return write_csv(SECTION_COLUMNS, rows)


def build_places_csv(municipalities: dict[str, dict[str, str]], legacy: bool) -> bytes:
    neighborhood_column = "DS_BAIRRO" if legacy else "NM_BAIRRO"
    columns = (*PLACE_COLUMNS, neighborhood_column)
    if not legacy:
        columns = (*columns, "NR_LATITUDE", "NR_LONGITUDE", "QT_ELEITOR")

    rows: list[dict[str, str]] = []
    for tse_code, zone, section, local_code, electorate in SECTIONS:
        name, address, neighborhood, cep, latitude, longitude = PLACES[
            (tse_code, zone, local_code)
        ]
        latitude, longitude = DIVERGENT_COORDINATES.get(
            (tse_code, zone, section), (latitude, longitude)
        )
        row = {
            "DT_GERACAO": GENERATION_DATE,
            "HH_GERACAO": "03:00:00",
            "AA_ELEICAO": str(YEAR),
            "DT_ELEICAO": ELECTION_DATE,
            "DS_ELEICAO": f"Eleitorado por local de votação {YEAR} (fixture sintético)",
            "SG_UF": STATE,
            "CD_MUNICIPIO": tse_code,
            "NM_MUNICIPIO": municipalities[tse_code]["name"],
            "NR_ZONA": str(zone),
            "NR_SECAO": str(section),
            "NR_LOCAL_VOTACAO": str(local_code),
            "NM_LOCAL_VOTACAO": name,
            "DS_ENDERECO": address,
            "NR_CEP": cep,
            "NR_TELEFONE_LOCAL": "#NULO#",
            neighborhood_column: neighborhood,
        }
        if not legacy:
            row |= {
                "NR_LATITUDE": latitude,
                "NR_LONGITUDE": longitude,
                "QT_ELEITOR": str(electorate),
            }
        rows.append(row)

    uf, tse_code, name, zone, section, local_code = FOREIGN_PLACE
    foreign = dict.fromkeys(columns, "#NULO#") | {
        "DT_GERACAO": GENERATION_DATE,
        "HH_GERACAO": "03:00:00",
        "AA_ELEICAO": str(YEAR),
        "DT_ELEICAO": ELECTION_DATE,
        "DS_ELEICAO": f"Eleitorado por local de votação {YEAR} (fixture sintético)",
        "SG_UF": uf,
        "CD_MUNICIPIO": tse_code,
        "NM_MUNICIPIO": name,
        "NR_ZONA": str(zone),
        "NR_SECAO": str(section),
        "NR_LOCAL_VOTACAO": str(local_code),
        "NM_LOCAL_VOTACAO": "ESCOLA SINTETICA DE OUTRA UF",
        "DS_ENDERECO": "RUA SINTETICA, 1",
        "NR_CEP": "88000000",
        neighborhood_column: "CENTRO",
    }
    if not legacy:
        foreign |= {"NR_LATITUDE": "-27.10000", "NR_LONGITUDE": "-48.60000", "QT_ELEITOR": "500"}
    rows.append(foreign)
    return write_csv(columns, rows)


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
    for scope, office_code in ((STATE, 3), ("BR", 1)):
        zip_path = output_dir / f"votacao_secao_{YEAR}_{scope}.zip"
        write_zip(
            zip_path,
            f"votacao_secao_{YEAR}_{scope}.csv",
            build_section_csv(office_code, municipalities),
        )
        created.append(zip_path)

    places_variants = (
        (False, "eleitorado_local_votacao"),
        (True, "eleitorado_local_votacao_legado"),
    )
    for legacy, name in places_variants:
        zip_path = output_dir / f"{name}.zip"
        write_zip(zip_path, f"{name}.csv", build_places_csv(municipalities, legacy))
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
        f"Municípios: {len(municipalities)} · locais: {len(PLACES)} · "
        f"seções: {len(SECTIONS)} · siglas: {len(PARTIES)} · pleitos: {len(OFFICES)} · "
        f"linhas de voto: {len(VOTES)} · linhas descartáveis: {len(DISCARDED)}"
    )


if __name__ == "__main__":
    main()
