#!/usr/bin/env bash
# Responde, com evidência, por que o PASSO 1c diz que uma candidatura "não está
# no cadastro". Não baixa nada: lê os ZIPs que já estão em dados_tse/.
#
# A pergunta que ele responde é UMA, e é a única que importa:
#   a candidatura está em OUTRO arquivo do mesmo pacote (leitura do recorte
#   errado) ou não está em lugar nenhum (pacote de votação e de candidatura são
#   de pleitos diferentes)?
#
# Uso, na raiz do projeto:
#   bash diagnostico_historico.sh                  # usa o SQ e o ano do erro atual
#   bash diagnostico_historico.sh 90000602039 2018 # ou informe outro

set -uo pipefail
cd "$(dirname "$0")" || exit 1

ALVO="${1:-90000602039}"
ANO="${2:-2018}"

PYTHON="$(command -v python3.11 || command -v python3)"

ALVO="$ALVO" ANO="$ANO" "$PYTHON" - <<'PY'
import csv, io, os, zipfile
from pathlib import Path

ALVO = os.environ["ALVO"]
ANO = int(os.environ["ANO"])

cand = Path(f"dados_tse/candidaturas/consulta_cand_{ANO}.zip")
sec = Path(f"dados_tse/secoes/votacao_secao_{ANO}_GO.zip")

for caminho in (cand, sec):
    if not caminho.is_file():
        raise SystemExit(f"Não achei {caminho}. Rode a partir da raiz do projeto.")

print(f"=== 1. Onde a candidatura {ALVO} está no cadastro de {ANO} ===")
achou = False
with zipfile.ZipFile(cand) as z:
    csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
    print(f"  o pacote tem {len(csvs)} CSV(s)")
    for nome in csvs:
        if ALVO.encode("latin-1", "ignore") in z.read(nome):
            print(f"  >>> ACHADA em: {nome}")
            achou = True
if not achou:
    print("  >>> NÃO aparece em NENHUM CSV deste pacote de candidaturas.")
    print("      Ou seja: não é recorte errado do ZIP — o pacote de votação")
    print("      traz uma candidatura que o pacote de candidaturas não tem.")

print()
print("=== 2. A linha da votação que derrubou o processamento ===")
# CD_TIPO_ELEICAO é o campo decisivo: 2 = ordinária. Qualquer outro valor
# significa eleição suplementar/extraordinária, cujas candidaturas não estão
# no cadastro do pleito geral — e era o filtro que faltava no script.
CAMPOS = ("ANO_ELEICAO", "CD_TIPO_ELEICAO", "NM_TIPO_ELEICAO", "CD_ELEICAO",
          "DS_ELEICAO", "CD_CARGO", "DS_CARGO", "NR_TURNO", "SG_UF",
          "NM_MUNICIPIO", "NR_VOTAVEL", "NM_VOTAVEL", "QT_VOTOS")
with zipfile.ZipFile(sec) as z:
    membro = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
    print(f"  (lendo {membro})")
    with z.open(membro) as raw:
        leitor = csv.DictReader(
            io.TextIOWrapper(raw, encoding="latin-1"), delimiter=";"
        )
        for linha in leitor:
            if (linha.get("SQ_CANDIDATO") or "").strip().strip('"') == ALVO:
                for campo in CAMPOS:
                    if campo in linha:
                        print(f"  {campo:18} = {linha[campo]}")
                break
        else:
            print("  (não achei essa candidatura no pacote de votação)")

print()
print("=== 3. Que outras eleições existem dentro deste pacote de votação ===")
# Se aparecer mais de um CD_TIPO_ELEICAO, ou mais de um CD_ELEICAO, o pacote
# mistura pleitos — e é isso que explica candidatura fora do cadastro.
with zipfile.ZipFile(sec) as z:
    membro = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
    with z.open(membro) as raw:
        leitor = csv.DictReader(
            io.TextIOWrapper(raw, encoding="latin-1"), delimiter=";"
        )
        vistos: dict[tuple[str, str, str], int] = {}
        for linha in leitor:
            chave = (
                (linha.get("CD_TIPO_ELEICAO") or "?").strip(),
                (linha.get("NM_TIPO_ELEICAO") or "").strip(),
                (linha.get("DS_ELEICAO") or "").strip(),
            )
            vistos[chave] = vistos.get(chave, 0) + 1
for (tipo, nome_tipo, descricao), n in sorted(vistos.items(), key=lambda i: -i[1]):
    if tipo == "2":
        marca = "  (ordinária)"
    elif tipo == "?":
        # Sem a coluna não dá para afirmar nada — dizer "não ordinária" aqui
        # seria inventar uma conclusão que o arquivo não sustenta.
        marca = "  (pacote sem a coluna CD_TIPO_ELEICAO)"
    else:
        marca = "  <-- NÃO ordinária"
    print(f"  CD_TIPO_ELEICAO={tipo:>3} {nome_tipo[:28]:28} {descricao[:34]:34} {n:>10,} linhas{marca}")
PY
