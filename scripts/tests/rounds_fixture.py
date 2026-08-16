#!/usr/bin/env python3
"""Fixture SINTÉTICO do caso "seção realocada entre turnos".

Nada aqui é dado oficial. Reproduz, em miniatura, a situação real encontrada no
cadastro do TSE de Goiás/2022: o arquivo traz uma linha por seção POR TURNO, e 21
das 27.429 seções votaram em escolas diferentes no 1º e no 2º turno. Antes da
indexação por turno o processamento abortava com "Seção X aparece em dois
locais"; o risco silencioso seria pior — atribuir os votos de um turno ao bairro
do outro.

O fixture cobre:

* seção 96, que muda do CTG (bairro Centro) para a Escola (bairro Vila Nova)
  entre os turnos — os votos de cada turno têm de cair no local daquele turno;
* seção 97, que fica na mesma escola nos dois turnos — o eleitorado não pode ser
  somado duas vezes só porque a linha aparece duas vezes;
* um pleito de Governador com turno único, para garantir que a ausência do 2º
  turno não quebra a busca por índice.

Uso:

    python3 scripts/tests/rounds_fixture.py
    python3 scripts/process_tse_sections.py \
        --sections-dir scripts/tests/fixtures/polling-rounds \
        --places-file scripts/tests/fixtures/polling-rounds/eleitorado_local_votacao.zip \
        --electorate-file scripts/tests/fixtures/polling-rounds/electorate-fixture.json \
        --output-dir scripts/tests/fixtures/polling-rounds/out \
        --years 2022 \
        --expected-municipalities 1

Resultado esperado (conferido por --check):

    2022-1-1 Presidente turno 1: 300 votos  -> tudo no CTG (Centro)
    2022-1-2 Presidente turno 2: 570 votos  -> 500 na Escola (Vila Nova), 70 no CTG
    2022-3-1 Governador  turno 1: 150 votos -> tudo no CTG (Centro)
    Eleitorado: CTG 550, Escola 300
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

STATE = "GO"
SOURCE_ENCODING = "latin-1"
TSE_CODE = "88013"
IBGE_CODE = "4314902"

PLACE_COLUMNS = [
    "DT_GERACAO", "AA_ELEICAO", "DT_ELEICAO", "DS_ELEICAO", "NR_TURNO", "SG_UF",
    "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO", "NR_LOCAL_VOTACAO",
    "NM_LOCAL_VOTACAO", "DS_ENDERECO", "NM_BAIRRO", "NR_CEP", "NR_LATITUDE",
    "NR_LONGITUDE", "QT_ELEITOR_SECAO",
]

VOTE_COLUMNS = [
    "DT_GERACAO", "ANO_ELEICAO", "CD_TIPO_ELEICAO", "NR_TURNO", "DT_ELEICAO", "SG_UF",
    "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_CARGO", "NR_VOTAVEL", "NM_VOTAVEL",
    "SQ_CANDIDATO", "SG_PARTIDO", "QT_VOTOS",
]

EXPECTED = {
    "2022-1-1": {f"{TSE_CODE}-58-1198": 300},
    "2022-1-2": {f"{TSE_CODE}-58-1791": 500, f"{TSE_CODE}-58-1198": 70},
    "2022-3-1": {f"{TSE_CODE}-58-1198": 150},
}
EXPECTED_ELECTORATE = {f"{TSE_CODE}-58-1198": 550, f"{TSE_CODE}-58-1791": 300}


def place_row(**overrides: str) -> dict[str, str]:
    row = dict.fromkeys(PLACE_COLUMNS, "")
    row.update(
        DT_GERACAO="01/07/2022", AA_ELEICAO="2022", SG_UF=STATE,
        CD_MUNICIPIO=TSE_CODE, NM_MUNICIPIO="TESTELANDIA", NR_ZONA="58",
    )
    row.update(overrides)
    return row


def vote_row(office: str, **overrides: str) -> dict[str, str]:
    row = dict.fromkeys(VOTE_COLUMNS, "")
    row.update(
        DT_GERACAO="10/11/2022", ANO_ELEICAO="2022", CD_TIPO_ELEICAO="2", SG_UF=STATE,
        CD_MUNICIPIO=TSE_CODE, NR_ZONA="58", CD_CARGO=office,
        NR_VOTAVEL="13", NM_VOTAVEL="CANDIDATO DE TESTE",
    )
    row.update(overrides)
    return row


def write_zip(path: Path, member: str, columns: list[str], rows: list[dict[str, str]]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer, fieldnames=columns, delimiter=";", quotechar='"',
        quoting=csv.QUOTE_ALL, lineterminator="\r\n",
    )
    writer.writeheader()
    writer.writerows(rows)
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr(member, buffer.getvalue().encode(SOURCE_ENCODING))


CTG = dict(
    NR_LOCAL_VOTACAO="1198", NM_LOCAL_VOTACAO="CTG SENTINELA DA QUERENCIA",
    DS_ENDERECO="RUA PETROPOLIS, 709", NM_BAIRRO="CENTRO", NR_CEP="95200000",
    NR_LATITUDE="-28.512333", NR_LONGITUDE="-50.948731",
)
ESCOLA = dict(
    NR_LOCAL_VOTACAO="1791", NM_LOCAL_VOTACAO="ESCOLA MUNICIPAL PEDRO ALVARES CABRAL",
    DS_ENDERECO="RUA MARCO AURELIO, 191", NM_BAIRRO="VILA NOVA", NR_CEP="95211191",
    NR_LATITUDE="-28.51142969", NR_LONGITUDE="-50.94959998",
)
TURNO_1 = dict(NR_TURNO="1", DT_ELEICAO="02/10/2022", DS_ELEICAO="1º Turno")
TURNO_2 = dict(NR_TURNO="2", DT_ELEICAO="30/10/2022", DS_ELEICAO="2º Turno")


def build(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)

    (target / "electorate-fixture.json").write_text(
        json.dumps(
            {
                "metadata": {"schemaVersion": 1, "state": STATE, "municipalityCount": 1},
                "municipalities": {
                    IBGE_CODE: {
                        "ibgeCode": IBGE_CODE, "tseCode": TSE_CODE,
                        "name": "TESTELANDIA", "electorate": 600,
                    }
                },
            },
            ensure_ascii=False, indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    write_zip(
        target / "eleitorado_local_votacao.zip",
        "eleitorado_local_votacao_2022.csv",
        PLACE_COLUMNS,
        [
            # seção 96: muda de local entre os turnos
            place_row(NR_SECAO="96", QT_ELEITOR_SECAO="300", **TURNO_1, **CTG),
            place_row(NR_SECAO="96", QT_ELEITOR_SECAO="300", **TURNO_2, **ESCOLA),
            # seção 97: mesmo local nos dois turnos
            place_row(NR_SECAO="97", QT_ELEITOR_SECAO="250", **TURNO_1, **CTG),
            place_row(NR_SECAO="97", QT_ELEITOR_SECAO="250", **TURNO_2, **CTG),
        ],
    )

    write_zip(
        target / "votacao_secao_2022_BR.zip",
        "votacao_secao_2022_BR.csv",
        VOTE_COLUMNS,
        [
            vote_row("1", NR_TURNO="1", DT_ELEICAO="02/10/2022", NR_SECAO="96",
                     SQ_CANDIDATO="111", SG_PARTIDO="PT", QT_VOTOS="200"),
            vote_row("1", NR_TURNO="1", DT_ELEICAO="02/10/2022", NR_SECAO="97",
                     SQ_CANDIDATO="111", SG_PARTIDO="PT", QT_VOTOS="100"),
            vote_row("1", NR_TURNO="2", DT_ELEICAO="30/10/2022", NR_SECAO="96",
                     SQ_CANDIDATO="111", SG_PARTIDO="PT", QT_VOTOS="500"),
            vote_row("1", NR_TURNO="2", DT_ELEICAO="30/10/2022", NR_SECAO="97",
                     SQ_CANDIDATO="111", SG_PARTIDO="PT", QT_VOTOS="70"),
        ],
    )

    write_zip(
        target / "votacao_secao_2022_GO.zip",
        "votacao_secao_2022_GO.csv",
        VOTE_COLUMNS,
        [
            vote_row("3", NR_TURNO="1", DT_ELEICAO="02/10/2022", NR_SECAO="96",
                     SQ_CANDIDATO="222", SG_PARTIDO="PT", QT_VOTOS="150"),
        ],
    )


def check(out_dir: Path) -> int:
    """Confere a saída do processamento contra o resultado esperado."""
    failures: list[str] = []

    places = {
        place["id"]: place
        for place in json.loads((out_dir / "places-go.json").read_text(encoding="utf-8"))["places"]
    }
    for place_id, expected in EXPECTED_ELECTORATE.items():
        actual = places.get(place_id, {}).get("electorate")
        if actual != expected:
            failures.append(f"eleitorado de {place_id}: {actual} != {expected}")

    for contest_id, expected in EXPECTED.items():
        path = out_dir / f"votes-{contest_id}.json"
        if not path.is_file():
            failures.append(f"faltou {path.name}")
            continue
        votes = json.loads(path.read_text(encoding="utf-8"))["votes"]
        actual = {place: sum(parties.values()) for place, parties in votes.items()}
        if actual != expected:
            failures.append(f"{contest_id}: {actual} != {expected}")

    if failures:
        print("FALHOU:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("Fixture de turnos: votos e eleitorado conferem em todos os pleitos.")
    print("  turno 1 -> 300 no CTG (Centro)")
    print("  turno 2 -> 500 na Escola (Vila Nova) + 70 no CTG (Centro)")
    return 0


def main() -> None:
    default = Path(__file__).resolve().parent / "fixtures" / "polling-rounds"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=default)
    parser.add_argument(
        "--check",
        type=Path,
        help="Em vez de gerar, confere a saída do processamento neste diretório.",
    )
    args = parser.parse_args()

    if args.check:
        sys.exit(check(args.check.resolve()))

    build(args.target.resolve())
    print(f"Fixture de turnos gerado em: {args.target.resolve()}")


if __name__ == "__main__":
    main()
