#!/usr/bin/env python3
"""Fixture SINTÉTICO para scripts/process_tse_history.py.

Nada aqui é dado oficial. Existe especificamente para travar a regressão que
aconteceu em produção: `candidate_members` tinha o sufixo do Rio Grande do Sul
("_rs.csv") fixo em vez do de Goiás ("_go.csv"), herdado do projeto original.
O pacote real de candidaturas do TSE traz um CSV por UF dentro do mesmo ZIP —
com dois sufixos batendo ("_rs.csv" e "_br.csv"), o carregamento não dava
erro nenhum, só carregava o cadastro do ESTADO ERRADO. O sintoma na tela foi
"Candidatura <id> não está no cadastro" em toda linha de Governador, porque
nenhum SQ_CANDIDATO de Goiás batia com o cadastro do Rio Grande do Sul.

Este fixture reproduz exatamente essa armadilha: o ZIP de candidaturas tem TRÊS
membros (_go.csv com o cadastro real, _rs.csv como isca com candidaturas
DIFERENTES, _br.csv para Presidente). Se o código voltar a usar o sufixo
errado, o teste falha com o mesmo "não está no cadastro" que a usuária viu.

Cobre os 246 municípios de Goiás (load_municipality_mapping exige exatamente
esse número — não tem flag de override neste script, ao contrário do de
votação municipal) com eleitorado sintético e votos em todos os 8 pleitos
esperados (2018/2022 × Presidente/Governador × 1º/2º turno).

Uso:

    python3 scripts/tests/tse_history_fixture.py
    python3 scripts/process_tse_history.py \\
        --section-2018 scripts/tests/fixtures/tse-history/votacao_secao_2018_GO.zip \\
        --section-2022 scripts/tests/fixtures/tse-history/votacao_secao_2022_GO.zip \\
        --president-2018 scripts/tests/fixtures/tse-history/votacao_secao_2018_BR.zip \\
        --president-2022 scripts/tests/fixtures/tse-history/votacao_secao_2022_BR.zip \\
        --candidates-2018 scripts/tests/fixtures/tse-history/consulta_cand_2018.zip \\
        --candidates-2022 scripts/tests/fixtures/tse-history/consulta_cand_2022.zip \\
        --electorate-file scripts/tests/fixtures/tse-history/electorate-fixture.json \\
        --output scripts/tests/fixtures/tse-history/out/election-history-go.json
    python3 scripts/tests/tse_history_fixture.py --check scripts/tests/fixtures/tse-history/out/election-history-go.json
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
N_MUNICIPIOS = 246
SOURCE_ENCODING = "latin-1"

CAND_COLS = [
    "ANO_ELEICAO", "SG_UF", "CD_CARGO", "SQ_CANDIDATO", "NR_CANDIDATO",
    "NM_CANDIDATO", "NM_URNA_CANDIDATO", "SG_PARTIDO", "NM_PARTIDO",
    "DS_SITUACAO_CANDIDATURA", "DS_SIT_TOT_TURNO",
]
VOTO_COLS = [
    "DT_GERACAO", "ANO_ELEICAO", "NR_TURNO", "DT_ELEICAO", "SG_UF",
    "CD_MUNICIPIO", "NM_MUNICIPIO", "CD_CARGO", "DS_CARGO", "NR_VOTAVEL",
    "NM_VOTAVEL", "QT_VOTOS", "SQ_CANDIDATO",
]

# Candidaturas de Goiás: as únicas que devem contar.
GOVERNADOR_GO = {
    2018: [("SQ-GO-2018-A", "PT", "13"), ("SQ-GO-2018-B", "PL", "22")],
    2022: [("SQ-GO-2022-A", "PT", "13"), ("SQ-GO-2022-B", "PL", "22")],
}
# Isca: mesmo formato, SQ_CANDIDATO totalmente diferente. Se o código ler este
# arquivo por engano, nenhum voto de Goiás vai casar e o processamento falha —
# é o comportamento que provamos ERRADO antes, e que este fixture agora prova
# CORRIGIDO (o código deve ignorar este arquivo).
GOVERNADOR_RS_ISCA = {
    2018: [("SQ-RS-ISCA-2018", "PT", "13")],
    2022: [("SQ-RS-ISCA-2022", "PT", "13")],
}
PRESIDENTE_BR = {
    2018: [("SQ-BR-2018-A", "PT", "13"), ("SQ-BR-2018-B", "PL", "22")],
    2022: [("SQ-BR-2022-A", "PT", "13"), ("SQ-BR-2022-B", "PL", "22")],
}


def municipios() -> list[tuple[str, str, str]]:
    """(ibge, tse, nome) sintéticos — 246, exigência dura do script real."""
    return [
        (f"52{indice:05d}", f"{indice:05d}", f"Município Fixture {indice}")
        for indice in range(1, N_MUNICIPIOS + 1)
    ]


def grava_zip(caminho: Path, membros: dict[str, tuple[list[str], list[dict]]]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(caminho, "w", ZIP_DEFLATED) as arquivo:
        for nome, (colunas, linhas) in membros.items():
            buffer = io.StringIO()
            escritor = csv.DictWriter(
                buffer, fieldnames=colunas, delimiter=";", quotechar='"',
                quoting=csv.QUOTE_ALL, lineterminator="\r\n",
            )
            escritor.writeheader()
            escritor.writerows({c: linha.get(c, "") for c in colunas} for linha in linhas)
            arquivo.writestr(nome, buffer.getvalue().encode(SOURCE_ENCODING))


def linhas_candidatura(ano: int, cargo: int, uf: str, candidatos: list[tuple[str, str, str]]) -> list[dict]:
    return [
        {
            "ANO_ELEICAO": str(ano), "SG_UF": uf, "CD_CARGO": str(cargo),
            "SQ_CANDIDATO": sq, "NR_CANDIDATO": numero, "NM_CANDIDATO": f"CANDIDATO {sq}",
            "NM_URNA_CANDIDATO": f"URNA {sq}", "SG_PARTIDO": partido, "NM_PARTIDO": partido,
            "DS_SITUACAO_CANDIDATURA": "APTO", "DS_SIT_TOT_TURNO": "ELEITO",
        }
        for sq, partido, numero in candidatos
    ]


def linhas_voto(
    ano: int, cargo: int, uf: str, munis: list[tuple[str, str, str]],
    candidatos: list[tuple[str, str, str]],
    turnos: tuple[int, ...] = (1, 2),
) -> list[dict]:
    """Um voto por candidatura em cada município — cobertura total.

    `turnos` existe porque 2º turno NÃO é garantido: em Goiás o governador foi
    decidido no 1º turno em 2018 e em 2022, e o script precisa aceitar isso
    (era a premissa herdada do Rio Grande do Sul que derrubava tudo).
    """
    linhas = []
    for turno in turnos:
        for indice, (ibge, tse, nome) in enumerate(munis):
            sq, partido, numero = candidatos[indice % len(candidatos)]
            linhas.append({
                "DT_GERACAO": "01/01/2026", "ANO_ELEICAO": str(ano),
                "NR_TURNO": str(turno), "DT_ELEICAO": f"01/10/{ano}", "SG_UF": uf,
                "CD_MUNICIPIO": tse, "NM_MUNICIPIO": nome, "CD_CARGO": str(cargo),
                "DS_CARGO": "CARGO", "NR_VOTAVEL": numero, "NM_VOTAVEL": f"URNA {sq}",
                "QT_VOTOS": "10", "SQ_CANDIDATO": sq,
            })
    return linhas


def build(destino: Path, intruso: str = "nenhum", governador_1turno: bool = False) -> None:
    """intruso: candidatura presente na votação e AUSENTE do cadastro.

    Reproduz a falha que travou o pipeline em produção — "Candidatura <SQ> da
    linha N não está no cadastro" — nos dois regimes que o script precisa
    distinguir: uma sobra de borda do TSE ("pequeno", que deve avisar e
    seguir) e um descompasso real entre os pacotes ("grande", que deve falhar).
    """
    munis = municipios()
    destino.mkdir(parents=True, exist_ok=True)

    (destino / "electorate-fixture.json").write_text(
        json.dumps(
            {
                "metadata": {"state": STATE, "municipalityCount": N_MUNICIPIOS},
                "municipalities": {
                    ibge: {"ibgeCode": ibge, "tseCode": tse, "name": nome}
                    for ibge, tse, nome in munis
                },
            },
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    for ano in (2018, 2022):
        turnos_gov = (1,) if governador_1turno else (1, 2)
        linhas_gov = linhas_voto(
            ano, 3, "GO", munis, GOVERNADOR_GO[ano], turnos_gov
        )
        if intruso != "nenhum":
            # Mesmo formato das demais, com um SQ que não existe em cadastro
            # nenhum do pacote. "pequeno" = 1 seção; "grande" = metade do
            # estado, que é descompasso de pacote, não sobra de borda.
            quantos = 1 if intruso == "pequeno" else len(munis) // 2
            for indice, (_ibge, tse, nome) in enumerate(munis[:quantos]):
                linhas_gov.append({
                    "DT_GERACAO": "01/01/2026", "ANO_ELEICAO": str(ano),
                    "NR_TURNO": "1", "DT_ELEICAO": f"01/10/{ano}", "SG_UF": "GO",
                    "CD_MUNICIPIO": tse, "NM_MUNICIPIO": nome, "CD_CARGO": "3",
                    "DS_CARGO": "CARGO", "NR_VOTAVEL": "77",
                    "NM_VOTAVEL": "INTRUSO SEM CADASTRO",
                    "QT_VOTOS": "10" if intruso == "pequeno" else "500",
                    "SQ_CANDIDATO": f"SQ-INTRUSO-{ano}",
                })
        grava_zip(destino / f"votacao_secao_{ano}_GO.zip", {
            f"votacao_secao_{ano}_go.csv": (VOTO_COLS, linhas_gov),
        })
        grava_zip(destino / f"votacao_secao_{ano}_BR.zip", {
            f"votacao_secao_{ano}_br.csv": (
                VOTO_COLS, linhas_voto(ano, 1, "GO", munis, PRESIDENTE_BR[ano])
            ),
        })
        # O pacote real de candidaturas traz um CSV por UF no mesmo ZIP — aqui
        # com GO (real), RS (isca) e BR (Presidente), exatamente como o TSE.
        grava_zip(destino / f"consulta_cand_{ano}.zip", {
            f"consulta_cand_{ano}_go.csv": (
                CAND_COLS, linhas_candidatura(ano, 3, "GO", GOVERNADOR_GO[ano])
            ),
            f"consulta_cand_{ano}_rs.csv": (
                CAND_COLS, linhas_candidatura(ano, 3, "RS", GOVERNADOR_RS_ISCA[ano])
            ),
            f"consulta_cand_{ano}_br.csv": (
                CAND_COLS, linhas_candidatura(ano, 1, "BR", PRESIDENTE_BR[ano])
            ),
        })


def check(caminho: Path) -> int:
    falhas: list[str] = []
    payload = json.loads(caminho.read_text(encoding="utf-8"))
    pleitos = {p["id"]: p for p in payload["contests"]}

    obrigatorios = {f"{ano}-{cargo}-1" for ano in (2018, 2022) for cargo in (1, 3)}
    if not obrigatorios <= set(pleitos):
        falhas.append(
            f"faltam 1ºs turnos: {sorted(obrigatorios - set(pleitos))}"
        )

    for ano in (2018, 2022):
        for turno in (1, 2):
            governador = pleitos.get(f"{ano}-3-{turno}")
            if governador is None:
                continue  # 2º turno pode legitimamente não existir
            ids_candidatos = {c["id"] for c in governador["candidates"]}
            # O ponto central: os candidatos de GOIÁS ganharam votos, e a
            # candidatura-isca do "RS" NÃO aparece em lugar nenhum.
            esperado_go = {sq for sq, _, _ in GOVERNADOR_GO[ano]}
            if ids_candidatos != esperado_go:
                falhas.append(
                    f"{ano}-3-{turno}: candidatos {ids_candidatos} != {esperado_go}"
                )
            isca = {sq for sq, _, _ in GOVERNADOR_RS_ISCA[ano]}
            if ids_candidatos & isca:
                falhas.append(f"{ano}-3-{turno}: a isca do RS vazou para o resultado!")
            if governador["municipalityCount"] != N_MUNICIPIOS:
                falhas.append(
                    f"{ano}-3-{turno}: {governador['municipalityCount']} municípios != {N_MUNICIPIOS}"
                )

    if falhas:
        print("FALHOU:")
        for falha in falhas:
            print(f"  - {falha}")
        return 1

    print("Fixture do histórico TSE: cadastro de Goiás usado corretamente em todos os pleitos.")
    print("  A candidatura-isca do Rio Grande do Sul não vazou em nenhum resultado.")
    return 0


def main() -> None:
    padrao = Path(__file__).resolve().parent / "fixtures" / "tse-history"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=padrao)
    parser.add_argument("--check", type=Path)
    parser.add_argument(
        "--intruso", choices=("nenhum", "pequeno", "grande"), default="nenhum"
    )
    parser.add_argument(
        "--governador-1turno",
        action="store_true",
        help="Forma REAL de Goiás: governador decidido no 1º turno (sem 2º).",
    )
    args = parser.parse_args()

    if args.check:
        sys.exit(check(args.check.resolve()))
    build(args.target.resolve(), args.intruso, args.governador_1turno)
    print(f"Fixture do histórico TSE gerado em: {args.target.resolve()}")


if __name__ == "__main__":
    main()
