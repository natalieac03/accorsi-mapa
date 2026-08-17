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
    "ANO_ELEICAO", "SG_UF", "SG_UE", "CD_CARGO", "SQ_CANDIDATO", "NR_CANDIDATO",
    "NM_CANDIDATO", "NM_URNA_CANDIDATO", "SG_PARTIDO", "NM_PARTIDO",
    "DS_SITUACAO_CANDIDATURA", "DS_SIT_TOT_TURNO",
]
VOTO_COLS = [
    "DT_GERACAO", "ANO_ELEICAO", "CD_TIPO_ELEICAO", "NR_TURNO", "DT_ELEICAO",
    "SG_UF", "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_CARGO", "NR_VOTAVEL",
    "NM_VOTAVEL", "SQ_CANDIDATO", "SG_PARTIDO", "QT_VOTOS",
]
# Formato antigo (2014 e anteriores): identifica quem recebeu o voto SÓ pelo
# número de urna. Sem SQ_CANDIDATO e sem sigla de partido na linha.
VOTO_COLS_ANTIGO = [
    "DT_GERACAO", "ANO_ELEICAO", "CD_TIPO_ELEICAO", "NR_TURNO", "DT_ELEICAO",
    "SG_UF", "SG_UE", "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_CARGO",
    "NR_VOTAVEL", "NM_VOTAVEL", "QT_VOTOS",
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


def cand(ano, cargo, sq, nome, urna, partido, numero, resultado, ue=None):
    # SG_UE: sigla do estado nos cargos estaduais/federais, código TSE do
    # município nos municipais. É o que dá escopo ao número de urna.
    return {
        "ANO_ELEICAO": str(ano), "SG_UF": UF,
        "SG_UE": ue if ue is not None else (MUN_A if cargo in (11, 13) else UF),
        "CD_CARGO": str(cargo),
        "SQ_CANDIDATO": sq, "NR_CANDIDATO": numero, "NM_CANDIDATO": nome,
        "NM_URNA_CANDIDATO": urna, "SG_PARTIDO": partido, "NM_PARTIDO": partido,
        "DS_SITUACAO_CANDIDATURA": "APTO", "DS_SIT_TOT_TURNO": resultado,
    }


def voto_antigo(ano, cargo, turno, municipio, zona, secao, numero, nome, votos, ue=None):
    """Linha no formato antigo: sem SQ_CANDIDATO, identificada pelo número."""
    return {
        "DT_GERACAO": "01/01/2026", "ANO_ELEICAO": str(ano), "CD_TIPO_ELEICAO": "2",
        "NR_TURNO": str(turno), "DT_ELEICAO": f"05/10/{ano}", "SG_UF": UF,
        "SG_UE": ue if ue is not None else (municipio if cargo in (11, 13) else UF),
        "CD_MUNICIPIO": municipio, "NR_ZONA": str(zona), "NR_SECAO": str(secao),
        "CD_CARGO": str(cargo), "NR_VOTAVEL": str(numero), "NM_VOTAVEL": nome,
        "QT_VOTOS": str(votos),
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
    # --- pacotes no formato antigo, sem SQ_CANDIDATO na linha de voto --------
    "2014-7-1": {  # Deputada Estadual identificada só pelo número de urna
        "votosNoEstado": 340,          # 250 (A) + 90 (B)
        "posicaoNoEstado": 2,          # rival 13999 soma 460
        "votosSemLocalDeVotacao": 0,
        "municipios": {
            # 250 de 310 válidos (250 dela + 60 do rival). Branco (95) e nulo
            # (96) não entram no denominador: não são candidatura.
            IBGE_A: {
                "votos": 250,
                "posicaoNoMunicipio": 1,
                "percentualValidos": 80.6452,
                # O pacote antigo não traz sigla na linha; sem denominador de
                # partido a taxa é None, nunca 0.
                "percentualDoPartido": None,
                "votosDoPartido": None,
            },
            IBGE_B: {"votos": 90, "posicaoNoMunicipio": 2},
        },
        "bairros": {IBGE_A: {"CENTRO": 150, "VILA NOVA": 100}},
    },
    "2012-11-1": {  # Prefeita: o número 13 existe nas duas cidades
        # Só os 500 do município dela. Os 700 do "13" da outra cidade são de
        # outra pessoa — somar daria 1.200 com cara de verdade.
        "votosNoEstado": 500,
        "municipios": {IBGE_A: {"votos": 500, "posicaoNoMunicipio": 1}},
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

    # --- 2014: pacote ANTIGO, sem SQ_CANDIDATO na linha de voto --------------
    # Reproduz o formato que fez Goiás sair sem 2014 na primeira geração: o
    # cadastro tem a candidatura, o arquivo de votos identifica só pelo número.
    grava_zip(
        destino / "consulta_cand_2014.zip", "consulta_cand_2014_GO.csv", CAND_COLS,
        [
            cand(2014, 7, "700101", "MARIA DE TESTE", "MARIA", "PT", "13111", "ELEITO"),
            cand(2014, 7, "700102", "JOAO RIVAL", "JOAO", "PT", "13999", "ELEITO"),
        ],
    )
    grava_zip(
        destino / "votacao_secao_2014_GO.zip", "votacao_secao_2014_GO.csv",
        VOTO_COLS_ANTIGO,
        [
            voto_antigo(2014, 7, 1, MUN_A, 1, 10, 13111, "MARIA", 150),
            voto_antigo(2014, 7, 1, MUN_A, 1, 20, 13111, "MARIA", 100),
            voto_antigo(2014, 7, 1, MUN_A, 1, 10, 13999, "JOAO", 60),
            voto_antigo(2014, 7, 1, MUN_B, 2, 30, 13111, "MARIA", 90),
            voto_antigo(2014, 7, 1, MUN_B, 2, 30, 13999, "JOAO", 400),
            # branco e nulo: não são candidatura e não podem virar denominador
            voto_antigo(2014, 7, 1, MUN_A, 1, 10, 95, "BRANCO", 200),
            voto_antigo(2014, 7, 1, MUN_A, 1, 10, 96, "NULO", 100),
        ],
    )
    grava_zip(
        destino / "eleitorado_local_votacao_2014.zip",
        "eleitorado_local_votacao_2014.csv", LOCAL_COLS,
        [
            local(2014, MUN_A, 1, 10, "1001", "ESCOLA CENTRO", "CENTRO"),
            local(2014, MUN_A, 1, 20, "1002", "ESCOLA VILA", "VILA NOVA"),
            local(2014, MUN_B, 2, 30, "2001", "ESCOLA B", "BAIRRO B"),
        ],
    )

    # --- 2012: cargo MUNICIPAL no formato antigo ----------------------------
    # A armadilha: "13" para Prefeito existe em toda cidade. O escopo é a
    # unidade eleitoral, não o número solto.
    grava_zip(
        destino / "consulta_cand_2012.zip", "consulta_cand_2012_GO.csv", CAND_COLS,
        [
            cand(2012, 11, "700201", "MARIA DE TESTE", "MARIA", "PT", "13",
                 "NAO ELEITO", ue=MUN_A),
            cand(2012, 11, "700202", "ANA OUTRA", "ANA", "PT", "13", "ELEITO",
                 ue=MUN_B),
            cand(2012, 11, "700203", "JOAO RIVAL", "JOAO", "PL", "22", "ELEITO",
                 ue=MUN_A),
        ],
    )
    grava_zip(
        destino / "votacao_secao_2012_GO.zip", "votacao_secao_2012_GO.csv",
        VOTO_COLS_ANTIGO,
        [
            voto_antigo(2012, 11, 1, MUN_A, 1, 10, 13, "MARIA", 500),
            voto_antigo(2012, 11, 1, MUN_A, 1, 10, 22, "JOAO", 300),
            # mesmo número, OUTRA cidade, OUTRA pessoa
            voto_antigo(2012, 11, 1, MUN_B, 2, 30, 13, "ANA", 700),
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
    print("  2014 (pacote antigo, sem SQ_CANDIDATO): 340 votos pelo número de urna,")
    print("       branco e nulo fora do denominador, bairros preservados")
    print("  2012 (cargo municipal, formato antigo): 500 votos — o '13' da outra")
    print("       cidade NÃO foi somado")
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
