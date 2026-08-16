#!/usr/bin/env python3
"""Fixture SINTÉTICO da trajetória de uma candidatura em foco.

Nada aqui é dado oficial. Reproduz, em miniatura, o que o
`process_candidato_foco.py` precisa acertar numa carreira real:

* **dois cargos diferentes em anos diferentes** — proporcional (Deputada
  Estadual, 2018) e majoritário municipal (Prefeita, 2020) — porque os
  denominadores e o significado do ranking mudam entre eles;
* **duas candidaturas homônimas de partidos distintos**, para provar que o
  casamento é por SQ_CANDIDATO vindo do cadastro, e não por nome solto na
  planilha de votos;
* **um município onde ela é a mais votada e outro onde é a segunda**, exercitando
  a posição por município;
* **voto do próprio partido maior que o nominal dela**, para o percentual do
  partido não sair 100% por acidente;
* **uma seção fora do cadastro de locais**, cujos votos precisam ser contados
  como "sem local" em vez de sumirem;
* **um ano sem cadastro de locais**, que deve sair só com recorte municipal e
  ser declarado no alerta.

Uso:

    python3 scripts/tests/candidato_fixture.py
    python3 scripts/process_candidato_foco.py \\
        --nome "MARIA DE TESTE" \\
        --sections-dir scripts/tests/fixtures/candidato \\
        --candidates-dir scripts/tests/fixtures/candidato \\
        --places-dir scripts/tests/fixtures/candidato \\
        --electorate-file scripts/tests/fixtures/candidato/electorate-fixture.json \\
        --anos 2018 2020 \\
        --output-dir scripts/tests/fixtures/candidato/out
    python3 scripts/tests/candidato_fixture.py --check scripts/tests/fixtures/candidato/out/maria-de-teste.json
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

UF = "GO"
SOURCE_ENCODING = "latin-1"

# Dois municípios do fixture (códigos fictícios de teste).
MUN_A, IBGE_A = "90001", "5200001"  # ela é a mais votada
MUN_B, IBGE_B = "90002", "5200002"  # ela é a segunda

SQ_FOCO = "700001"
SQ_HOMONIMA = "700002"  # mesmo nome, outro partido: não pode ser somada
SQ_RIVAL = "700003"

CAND_COLS = [
    "ANO_ELEICAO", "SG_UF", "CD_CARGO", "SQ_CANDIDATO", "NR_CANDIDATO",
    "NM_CANDIDATO", "NM_URNA_CANDIDATO", "SG_PARTIDO", "NM_PARTIDO",
    "DS_SITUACAO_CANDIDATURA", "DS_SIT_TOT_TURNO",
]
VOTO_COLS = [
    "DT_GERACAO", "ANO_ELEICAO", "CD_TIPO_ELEICAO", "NR_TURNO", "DT_ELEICAO",
    "SG_UF", "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_CARGO", "NR_VOTAVEL",
    "NM_VOTAVEL", "SQ_CANDIDATO", "SG_PARTIDO", "QT_VOTOS",
]
LOCAL_COLS = [
    "AA_ELEICAO", "NR_TURNO", "SG_UF", "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA",
    "NR_SECAO", "NR_LOCAL_VOTACAO", "NM_LOCAL_VOTACAO", "NM_BAIRRO",
]


def grava_zip(caminho: Path, membro: str, colunas: list[str], linhas: list[dict]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    escritor = csv.DictWriter(
        buffer, fieldnames=colunas, delimiter=";", quotechar='"',
        quoting=csv.QUOTE_ALL, lineterminator="\r\n",
    )
    escritor.writeheader()
    escritor.writerows({c: linha.get(c, "") for c in colunas} for linha in linhas)
    with ZipFile(caminho, "w", ZIP_DEFLATED) as arquivo:
        arquivo.writestr(membro, buffer.getvalue().encode(SOURCE_ENCODING))


def cand(ano, cargo, sq, nome, urna, partido, numero, resultado):
    return {
        "ANO_ELEICAO": str(ano), "SG_UF": UF, "CD_CARGO": str(cargo),
        "SQ_CANDIDATO": sq, "NR_CANDIDATO": numero, "NM_CANDIDATO": nome,
        "NM_URNA_CANDIDATO": urna, "SG_PARTIDO": partido, "NM_PARTIDO": partido,
        "DS_SITUACAO_CANDIDATURA": "APTO", "DS_SIT_TOT_TURNO": resultado,
    }


def voto(ano, cargo, turno, municipio, zona, secao, sq, partido, votos):
    return {
        "DT_GERACAO": "01/01/2026", "ANO_ELEICAO": str(ano), "CD_TIPO_ELEICAO": "2",
        "NR_TURNO": str(turno), "DT_ELEICAO": f"07/10/{ano}", "SG_UF": UF,
        "CD_MUNICIPIO": municipio, "NR_ZONA": str(zona), "NR_SECAO": str(secao),
        "CD_CARGO": str(cargo), "NR_VOTAVEL": "13", "NM_VOTAVEL": "TESTE",
        "SQ_CANDIDATO": sq, "SG_PARTIDO": partido, "QT_VOTOS": str(votos),
    }


def local(ano, municipio, zona, secao, numero, nome, bairro):
    return {
        "AA_ELEICAO": str(ano), "NR_TURNO": "1", "SG_UF": UF,
        "CD_MUNICIPIO": municipio, "NM_MUNICIPIO": "TESTELANDIA",
        "NR_ZONA": str(zona), "NR_SECAO": str(secao),
        "NR_LOCAL_VOTACAO": numero, "NM_LOCAL_VOTACAO": nome, "NM_BAIRRO": bairro,
    }


# Resultado esperado, conferido à mão a partir das linhas abaixo.
ESPERADO = {
    "2018-7-1": {  # Deputada Estadual
        "votosNoEstado": 300,          # 200 (A) + 100 (B); a homônima do PL fica fora
        "posicaoNoEstado": 1,          # ela 300 · rival 250 (a homônima é outro cargo-alvo)
        "municipios": {
            # No município A ela tem 200, mas a homônima do PL tem 300: a posição
            # é entre TODAS as candidaturas com voto, não só as do próprio partido.
            # E o PT ali soma 250 (200 dela + 50 do rival) -> 80%.
            IBGE_A: {"votos": 200, "posicaoNoMunicipio": 2, "percentualDoPartido": 80.0},
            # No B o PT soma 300 (100 dela + 200 do rival) -> 33,33%, não 100%:
            # "percentual do partido" é a fatia dela dentro do partido, e o
            # denominador inclui os votos dos correligionários.
            IBGE_B: {"votos": 100, "posicaoNoMunicipio": 2, "percentualDoPartido": 33.3333},
        },
        "bairros": {IBGE_A: {"CENTRO": 120, "VILA NOVA": 80}},
        "votosSemLocalDeVotacao": 0,
    },
    "2020-11-1": {  # Prefeita — ano SEM cadastro de locais
        "votosNoEstado": 150,
        "posicaoNoEstado": 2,          # rival tem 400
        "temRecorteSubmunicipal": False,
    },
}


def build(destino: Path) -> None:
    destino.mkdir(parents=True, exist_ok=True)

    (destino / "electorate-fixture.json").write_text(
        json.dumps(
            {
                "metadata": {"state": UF, "municipalityCount": 2},
                "municipalities": {
                    IBGE_A: {"ibgeCode": IBGE_A, "tseCode": MUN_A, "name": "Testelândia"},
                    IBGE_B: {"ibgeCode": IBGE_B, "tseCode": MUN_B, "name": "Vila Fixture"},
                },
            },
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    # --- 2018: Deputada Estadual (cargo 7), com cadastro de locais -----------
    grava_zip(
        destino / "consulta_cand_2018.zip", "consulta_cand_2018_GO.csv", CAND_COLS,
        [
            cand(2018, 7, SQ_FOCO, "MARIA DE TESTE", "MARIA", "PT", "13111", "ELEITO"),
            # homônima de outro partido: o script NÃO pode somar os votos dela
            cand(2018, 7, SQ_HOMONIMA, "MARIA DE TESTE", "MARIA T", "PL", "22222", "NAO ELEITO"),
            cand(2018, 7, SQ_RIVAL, "JOAO RIVAL", "JOAO", "PT", "13999", "ELEITO"),
        ],
    )
    grava_zip(
        destino / "votacao_secao_2018_GO.zip", "votacao_secao_2018_GO.csv", VOTO_COLS,
        [
            # município A: foco 200 (120 Centro + 80 Vila Nova), partido soma 250
            voto(2018, 7, 1, MUN_A, 1, 10, SQ_FOCO, "PT", 120),
            voto(2018, 7, 1, MUN_A, 1, 20, SQ_FOCO, "PT", 80),
            voto(2018, 7, 1, MUN_A, 1, 10, SQ_RIVAL, "PT", 50),
            voto(2018, 7, 1, MUN_A, 1, 10, SQ_HOMONIMA, "PL", 300),  # não é ela
            # município B: foco 100, rival 200 -> ela é a segunda
            voto(2018, 7, 1, MUN_B, 2, 30, SQ_FOCO, "PT", 100),
            voto(2018, 7, 1, MUN_B, 2, 30, SQ_RIVAL, "PT", 200),
        ],
    )
    grava_zip(
        destino / "eleitorado_local_votacao_2018.zip",
        "eleitorado_local_votacao_2018.csv", LOCAL_COLS,
        [
            local(2018, MUN_A, 1, 10, "1001", "ESCOLA CENTRO", "CENTRO"),
            local(2018, MUN_A, 1, 20, "1002", "ESCOLA VILA", "VILA NOVA"),
            local(2018, MUN_B, 2, 30, "2001", "ESCOLA B", "BAIRRO B"),
        ],
    )

    # --- 2020: Prefeita (cargo 11), SEM cadastro de locais -------------------
    grava_zip(
        destino / "consulta_cand_2020.zip", "consulta_cand_2020_GO.csv", CAND_COLS,
        [
            cand(2020, 11, SQ_FOCO, "MARIA DE TESTE", "MARIA", "PT", "13", "2 TURNO"),
            cand(2020, 11, SQ_RIVAL, "JOAO RIVAL", "JOAO", "PL", "22", "ELEITO"),
        ],
    )
    grava_zip(
        destino / "votacao_secao_2020_GO.zip", "votacao_secao_2020_GO.csv", VOTO_COLS,
        [
            voto(2020, 11, 1, MUN_A, 1, 10, SQ_FOCO, "PT", 150),
            voto(2020, 11, 1, MUN_A, 1, 10, SQ_RIVAL, "PL", 400),
        ],
    )


def check(caminho: Path) -> int:
    falhas: list[str] = []
    payload = json.loads(caminho.read_text(encoding="utf-8"))
    pleitos = {p["id"]: p for p in payload["contests"]}

    for pleito_id, esperado in ESPERADO.items():
        pleito = pleitos.get(pleito_id)
        if pleito is None:
            falhas.append(f"faltou o pleito {pleito_id}")
            continue
        for chave in ("votosNoEstado", "posicaoNoEstado", "votosSemLocalDeVotacao",
                      "temRecorteSubmunicipal"):
            if chave in esperado and pleito.get(chave) != esperado[chave]:
                falhas.append(
                    f"{pleito_id}.{chave}: {pleito.get(chave)} != {esperado[chave]}"
                )
        for ibge, valores in esperado.get("municipios", {}).items():
            real = pleito["municipios"].get(ibge)
            if real is None:
                falhas.append(f"{pleito_id}: município {ibge} ausente")
                continue
            for chave, valor in valores.items():
                if real.get(chave) != valor:
                    falhas.append(
                        f"{pleito_id}.{ibge}.{chave}: {real.get(chave)} != {valor}"
                    )
        for ibge, bairros in esperado.get("bairros", {}).items():
            real = (pleito.get("bairros") or {}).get(ibge)
            if real != bairros:
                falhas.append(f"{pleito_id}.bairros[{ibge}]: {real} != {bairros}")

    # a homônima de outro partido não pode ter entrado em lugar nenhum
    total_2018 = pleitos.get("2018-7-1", {}).get("votosNoEstado")
    if total_2018 == 600:
        falhas.append("a homônima do PL foi somada: o casamento não é por SQ_CANDIDATO")

    if falhas:
        print("FALHOU:")
        for falha in falhas:
            print(f"  - {falha}")
        return 1

    print("Fixture de candidatura: trajetória confere em todos os pleitos.")
    print("  2018 Deputada Estadual: 300 votos, 1ª no estado, 80% do PT no município A")
    print("  2018 bairros: Centro 120 · Vila Nova 80")
    print("  2020 Prefeita: 150 votos, 2ª — sem cadastro de locais, só recorte municipal")
    print("  homônima de outro partido corretamente ignorada")
    return 0


def main() -> None:
    padrao = Path(__file__).resolve().parent / "fixtures" / "candidato"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=padrao)
    parser.add_argument("--check", type=Path)
    args = parser.parse_args()

    if args.check:
        sys.exit(check(args.check.resolve()))
    build(args.target.resolve())
    print(f"Fixture de candidatura gerado em: {args.target.resolve()}")


if __name__ == "__main__":
    main()
