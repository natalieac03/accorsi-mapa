#!/usr/bin/env python3
"""Fixture SINTÉTICO de dois anos no mesmo recorte submunicipal: 2022 e 2024.

Nada aqui é dado oficial. Exercita as duas armadilhas de processar mais de uma
eleição na camada de locais de votação:

1. **O TSE renumera seções entre eleições.** As seções 96 e 97 de 2022 viram 501
   e 502 em 2024. Se o script usasse um cadastro só, os votos de um ano cairiam
   em seções inexistentes (virando órfãos) ou, pior, em locais errados. Cada ano
   tem o seu índice, alimentado pelo `--places-file ANO=CAMINHO` daquele ano.

2. **O eleitorado não pode ser somado entre anos.** O mesmo prédio aparece nos
   dois cadastros; o eleitorado e a contagem de seções vêm só do cadastro mais
   recente em que ele aparece, senão o número dobraria e as bolhas do mapa
   ficariam com o dobro do tamanho.

Cobre ainda a diferença de calendário: 2022 é eleição geral (Presidente no
pacote nacional, Governador no do estado) e 2024 é municipal (Prefeito e
Vereador, só pacote do estado, sem pacote nacional). E mantém, dentro de 2022,
uma seção que troca de prédio entre o 1º e o 2º turno.

Uso:

    python3 scripts/tests/multiyear_fixture.py
    python3 scripts/process_tse_sections.py \
        --sections-dir scripts/tests/fixtures/polling-multiyear \
        --places-file 2022=scripts/tests/fixtures/polling-multiyear/eleitorado_local_votacao_2022.zip \
        --places-file 2024=scripts/tests/fixtures/polling-multiyear/eleitorado_local_votacao_2024.zip \
        --electorate-file scripts/tests/fixtures/polling-multiyear/electorate-fixture.json \
        --candidates-dir scripts/tests/fixtures/polling-multiyear/cand \
        --output-dir scripts/tests/fixtures/polling-multiyear/out \
        --years 2022 2024 \
        --expected-municipalities 1
    python3 scripts/tests/multiyear_fixture.py --check scripts/tests/fixtures/polling-multiyear/out
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

CTG_ID = f"{TSE_CODE}-58-1198"
ESCOLA_ID = f"{TSE_CODE}-58-1791"

PLACE_COLUMNS = [
    "DT_GERACAO", "AA_ELEICAO", "DT_ELEICAO", "DS_ELEICAO", "NR_TURNO", "SG_UF",
    "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO", "NR_LOCAL_VOTACAO",
    "NM_LOCAL_VOTACAO", "DS_ENDERECO", "NM_BAIRRO", "NR_CEP", "NR_LATITUDE",
    "NR_LONGITUDE", "QT_ELEITOR_SECAO",
]
# O pacote real de votação por seção identifica a candidatura por SQ_CANDIDATO e
# NÃO repete a sigla do partido na linha — a sigla vem do cadastro de
# candidaturas. O fixture reproduz os dois formatos de propósito: 2022 sem a
# coluna (como o TSE publica) e 2024 com ela, para exercitar os dois caminhos.
VOTE_COLUMNS = [
    "DT_GERACAO", "ANO_ELEICAO", "CD_TIPO_ELEICAO", "NR_TURNO", "DT_ELEICAO", "SG_UF",
    "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_CARGO", "NR_VOTAVEL", "NM_VOTAVEL",
    "SQ_CANDIDATO", "QT_VOTOS",
]
VOTE_COLUMNS_WITH_PARTY = [*VOTE_COLUMNS, "SG_PARTIDO"]

CANDIDATE_COLUMNS = [
    "ANO_ELEICAO", "SG_UF", "CD_CARGO", "SQ_CANDIDATO", "NR_CANDIDATO", "NM_CANDIDATO",
    "NM_URNA_CANDIDATO", "SG_PARTIDO", "NM_PARTIDO", "DS_SITUACAO_CANDIDATURA",
    "DS_SIT_TOT_TURNO",
]

# SQ_CANDIDATO -> sigla, como o consulta_cand entrega.
CANDIDATES_2022 = {"111": ("1", "PT"), "222": ("3", "PSDB")}

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

# 2022 usa as seções 96/97; em 2024 o TSE renumerou para 501/502 e a 501 passou a
# votar na Escola. Os votos de cada ano têm de seguir a numeração do seu ano.
EXPECTED = {
    "2022-1-1": {CTG_ID: 200},      # Presidente 1º turno, seção 96 no CTG
    "2022-1-2": {ESCOLA_ID: 500},   # Presidente 2º turno, seção 96 realocada
    "2022-3-1": {CTG_ID: 150},      # Governador, seção 97 no CTG
    "2024-11-1": {ESCOLA_ID: 180, CTG_ID: 140},  # Prefeito, seções 501/502
    "2024-13-1": {ESCOLA_ID: 90},   # Vereador, seção 501
}
# Só do cadastro de 2024, o mais recente: nunca 2022 + 2024 somados.
EXPECTED_ELECTORATE = {ESCOLA_ID: 320, CTG_ID: 260}


def place_row(**overrides: str) -> dict[str, str]:
    row = dict.fromkeys(PLACE_COLUMNS, "")
    row.update(
        DT_GERACAO="01/07/2022", SG_UF=STATE, CD_MUNICIPIO=TSE_CODE,
        NM_MUNICIPIO="TESTELANDIA", NR_ZONA="58",
    )
    row.update(overrides)
    return row


def vote_row(office: str, year: str, generated: str, **overrides: str) -> dict[str, str]:
    row = dict.fromkeys(VOTE_COLUMNS_WITH_PARTY, "")
    row.update(
        DT_GERACAO=generated, ANO_ELEICAO=year, CD_TIPO_ELEICAO="2", SG_UF=STATE,
        CD_MUNICIPIO=TSE_CODE, NR_ZONA="58", CD_CARGO=office,
        NR_VOTAVEL="13", NM_VOTAVEL="CANDIDATO DE TESTE",
    )
    row.update(overrides)
    return row


def write_zip(path: Path, member: str, columns: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer, fieldnames=columns, delimiter=";", quotechar='"',
        quoting=csv.QUOTE_ALL, lineterminator="\r\n",
    )
    writer.writeheader()
    # Cada arquivo escreve só as suas colunas: é assim que o pacote de 2022 sai
    # sem SG_PARTIDO, mesmo as linhas sendo montadas com o dicionário completo.
    writer.writerows({key: row.get(key, "") for key in columns} for row in rows)
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr(member, buffer.getvalue().encode(SOURCE_ENCODING))


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

    turno_1 = dict(AA_ELEICAO="2022", NR_TURNO="1", DT_ELEICAO="02/10/2022", DS_ELEICAO="1º Turno")
    turno_2 = dict(AA_ELEICAO="2022", NR_TURNO="2", DT_ELEICAO="30/10/2022", DS_ELEICAO="2º Turno")
    write_zip(
        target / "eleitorado_local_votacao_2022.zip",
        "eleitorado_local_votacao_2022.csv",
        PLACE_COLUMNS,
        [
            place_row(NR_SECAO="96", QT_ELEITOR_SECAO="300", **turno_1, **CTG),
            place_row(NR_SECAO="96", QT_ELEITOR_SECAO="300", **turno_2, **ESCOLA),
            place_row(NR_SECAO="97", QT_ELEITOR_SECAO="250", **turno_1, **CTG),
            place_row(NR_SECAO="97", QT_ELEITOR_SECAO="250", **turno_2, **CTG),
        ],
    )

    municipal = dict(AA_ELEICAO="2024", NR_TURNO="1", DT_ELEICAO="06/10/2024", DS_ELEICAO="1º Turno")
    write_zip(
        target / "eleitorado_local_votacao_2024.zip",
        "eleitorado_local_votacao_2024.csv",
        PLACE_COLUMNS,
        [
            place_row(NR_SECAO="501", QT_ELEITOR_SECAO="320", **municipal, **ESCOLA),
            place_row(NR_SECAO="502", QT_ELEITOR_SECAO="260", **municipal, **CTG),
        ],
    )

    # 2022 SEM a coluna de sigla: a sigla tem de vir do consulta_cand_2022.zip.
    write_zip(
        target / "votacao_secao_2022_BR.zip", "votacao_secao_2022_BR.csv", VOTE_COLUMNS,
        [
            vote_row("1", "2022", "10/11/2022", NR_TURNO="1", DT_ELEICAO="02/10/2022",
                     NR_SECAO="96", SQ_CANDIDATO="111", QT_VOTOS="200"),
            vote_row("1", "2022", "10/11/2022", NR_TURNO="2", DT_ELEICAO="30/10/2022",
                     NR_SECAO="96", SQ_CANDIDATO="111", QT_VOTOS="500"),
        ],
    )
    write_zip(
        target / "votacao_secao_2022_GO.zip", "votacao_secao_2022_GO.csv", VOTE_COLUMNS,
        [
            vote_row("3", "2022", "10/11/2022", NR_TURNO="1", DT_ELEICAO="02/10/2022",
                     NR_SECAO="97", SQ_CANDIDATO="222", QT_VOTOS="150"),
        ],
    )
    write_zip(
        target / "cand" / "consulta_cand_2022.zip", "consulta_cand_2022_BR.csv",
        CANDIDATE_COLUMNS,
        [
            {
                "ANO_ELEICAO": "2022", "SG_UF": "BR", "CD_CARGO": office,
                "SQ_CANDIDATO": sq, "NR_CANDIDATO": "13",
                "NM_CANDIDATO": "CANDIDATO DE TESTE", "NM_URNA_CANDIDATO": "TESTE",
                "SG_PARTIDO": party, "NM_PARTIDO": "PARTIDO DE TESTE",
                "DS_SITUACAO_CANDIDATURA": "APTO", "DS_SIT_TOT_TURNO": "ELEITO",
            }
            for sq, (office, party) in CANDIDATES_2022.items()
        ],
    )

    # Municipal: só o pacote do estado, com Prefeito e Vereador. Este traz a
    # sigla na linha, exercitando o outro caminho.
    write_zip(
        target / "votacao_secao_2024_GO.zip", "votacao_secao_2024_GO.csv",
        VOTE_COLUMNS_WITH_PARTY,
        [
            vote_row("11", "2024", "20/10/2024", NR_TURNO="1", DT_ELEICAO="06/10/2024",
                     NR_SECAO="501", SQ_CANDIDATO="777", SG_PARTIDO="PT", QT_VOTOS="180"),
            vote_row("11", "2024", "20/10/2024", NR_TURNO="1", DT_ELEICAO="06/10/2024",
                     NR_SECAO="502", SQ_CANDIDATO="888", SG_PARTIDO="PSDB", QT_VOTOS="140"),
            vote_row("13", "2024", "20/10/2024", NR_TURNO="1", DT_ELEICAO="06/10/2024",
                     NR_SECAO="501", SQ_CANDIDATO="999", SG_PARTIDO="PT", QT_VOTOS="90"),
        ],
    )


def check(out_dir: Path) -> int:
    failures: list[str] = []

    payload = json.loads((out_dir / "places-go.json").read_text(encoding="utf-8"))
    places = {place["id"]: place for place in payload["places"]}
    for place_id, expected in EXPECTED_ELECTORATE.items():
        actual = places.get(place_id, {}).get("electorate")
        if actual != expected:
            failures.append(
                f"eleitorado de {place_id}: {actual} != {expected} "
                "(somou anos em vez de usar só o cadastro mais recente?)"
            )

    registry_years = payload["metadata"].get("registryYears")
    if registry_years != [2022, 2024]:
        failures.append(f"registryYears: {registry_years} != [2022, 2024]")

    generated = sorted(p.name for p in out_dir.glob("votes-*.json"))
    expected_files = sorted(f"votes-{key}.json" for key in EXPECTED)
    if generated != expected_files:
        failures.append(f"pleitos gerados: {generated} != {expected_files}")

    for contest_id, expected in EXPECTED.items():
        path = out_dir / f"votes-{contest_id}.json"
        if not path.is_file():
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

    print("Fixture multi-ano: 2022 e 2024 conferem em todos os pleitos.")
    print("  2022 usa as seções 96/97; 2024 usa as renumeradas 501/502")
    print("  eleitorado vem só do cadastro de 2024, sem somar os dois anos")
    return 0


def main() -> None:
    default = Path(__file__).resolve().parent / "fixtures" / "polling-multiyear"
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
    print(f"Fixture multi-ano gerado em: {args.target.resolve()}")


if __name__ == "__main__":
    main()
