#!/usr/bin/env bash
# "Será que tem no zip mesmo?" — este script responde, lendo os SEUS arquivos.
#
# Para 2018 e 2022, conta quantas candidaturas e quantas linhas de votação
# existem para Presidente (cargo 1) e Governador (cargo 3) dentro dos pacotes
# que já estão em dados_tse/. Não baixa nada.
#
# Uso, na raiz do projeto:  bash conferir_pacotes.sh

set -uo pipefail
cd "$(dirname "$0")" || exit 1

PYTHON="$(command -v python3.11 || command -v python3)"

"$PYTHON" - <<'PY'
import csv, io, zipfile
from collections import Counter
from pathlib import Path

CARGOS = {1: "Presidente", 3: "Governador"}


def abrir_csvs(caminho: Path):
    """Cada CSV do zip, já decodificado como o TSE publica (latin-1, ';')."""
    with zipfile.ZipFile(caminho) as z:
        for nome in z.namelist():
            if not nome.lower().endswith(".csv"):
                continue
            with z.open(nome) as raw:
                yield nome, csv.DictReader(
                    io.TextIOWrapper(raw, encoding="latin-1"), delimiter=";"
                )


for ano in (2018, 2022):
    print(f"================ {ano} ================")

    cand = Path(f"dados_tse/candidaturas/consulta_cand_{ano}.zip")
    if cand.is_file():
        print(f"  cadastro de candidaturas ({cand.name}):")
        for nome, leitor in abrir_csvs(cand):
            # Só os CSVs que o processamento usa: o de Goiás e o nacional.
            curto = Path(nome).name.lower()
            if not (curto.endswith("_go.csv") or curto.endswith("_br.csv")):
                continue
            contagem = Counter()
            for linha in leitor:
                try:
                    cargo = int((linha.get("CD_CARGO") or "0").strip() or 0)
                except ValueError:
                    continue
                if cargo in CARGOS:
                    contagem[cargo] += 1
            if contagem:
                detalhe = " · ".join(
                    f"{CARGOS[c]}: {contagem[c]:,} registros" for c in sorted(contagem)
                )
                print(f"    {Path(nome).name} -> {detalhe}")
    else:
        print(f"  !! não achei {cand}")

    for rotulo, caminho in (
        ("votação Goiás (Governador)", Path(f"dados_tse/secoes/votacao_secao_{ano}_GO.zip")),
        ("votação nacional (Presidente)", Path(f"dados_tse/secoes/votacao_secao_{ano}_BR.zip")),
    ):
        if not caminho.is_file():
            print(f"  !! não achei {caminho}")
            continue
        print(f"  {rotulo} ({caminho.name}):")
        for nome, leitor in abrir_csvs(caminho):
            # (cargo, turno) -> linhas, contando só Goiás: é o recorte que o
            # processamento usa, e é onde a pergunta "tem 2º turno?" se decide.
            contagem = Counter()
            for linha in leitor:
                if (linha.get("SG_UF") or "").strip().upper() != "GO":
                    continue
                try:
                    cargo = int((linha.get("CD_CARGO") or "0").strip() or 0)
                    turno = int((linha.get("NR_TURNO") or "0").strip() or 0)
                except ValueError:
                    continue
                if cargo in CARGOS:
                    contagem[(cargo, turno)] += 1
            for (cargo, turno), n in sorted(contagem.items()):
                print(f"    {CARGOS[cargo]:11} {turno}º turno: {n:>9,} linhas em GO")
            if not contagem:
                print("    (nenhuma linha de Presidente/Governador em GO)")
    print()

print("Como ler: se aparecer 1º turno de Governador mas NÃO aparecer 2º turno,")
print("está certo — em Goiás o Caiado venceu no 1º turno em 2018 e em 2022.")
print("Presidente tem os dois turnos nos dois anos, porque a disputa nacional foi.")
PY
