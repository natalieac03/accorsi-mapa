#!/usr/bin/env bash
# Responde a pergunta "tá faltando alguma leva de dados?" com evidência.
#
# Para cada arquivo que o site carrega, mostra três coisas DIFERENTES, que é
# onde o dado costuma se perder entre a sua máquina e o ar:
#
#   GERADO    o arquivo existe no disco com conteúdo de verdade?
#   NO GIT    ele está versionado (foi para o commit)?
#   NO AR     a versão que está no GitHub tem conteúdo, ou subiu o placeholder?
#
# Um arquivo pode estar gerado e não commitado, ou commitado numa versão antiga
# e vazia — e nos dois casos o site publica a tela de "ainda não gerado" sem
# dizer por quê. Rode na raiz do projeto:  bash diagnostico_dados.sh

set -uo pipefail

cd "$(dirname "$0")"

PYTHON="$(command -v python3.11 || command -v python3)"

echo "=== O que o site carrega ==================================="
$PYTHON - <<'PY'
import json, subprocess
from pathlib import Path


def conteudo(caminho: Path):
    """(tem_dado, resumo) a partir do JSON — cada arquivo tem sua própria forma."""
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return False, "arquivo não existe"
    except json.JSONDecodeError as erro:
        return False, f"JSON inválido ({erro.msg})"

    if not isinstance(dados, dict):
        return False, "formato inesperado"

    meta = dados.get("metadata") or {}
    if meta.get("status") == "pendente":
        return False, "placeholder (status: pendente)"

    for chave, rotulo in (
        ("contests", "pleitos"),
        ("places", "locais"),
        ("municipalities", "municípios"),
        ("parties", "partidos"),
        ("records", "registros"),
    ):
        valor = dados.get(chave)
        if isinstance(valor, (list, dict)) and len(valor) > 0:
            return True, f"{len(valor)} {rotulo}"
        if isinstance(valor, (list, dict)):
            return False, f"0 {rotulo}"

    return False, "sem conteúdo reconhecido"


def no_git(caminho: Path) -> str:
    versionado = subprocess.run(
        ["git", "ls-files", "--error-unmatch", str(caminho)],
        capture_output=True,
    ).returncode == 0
    if not versionado:
        return "NÃO versionado"
    sujo = subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", str(caminho)],
        capture_output=True,
    ).returncode != 0
    return "commitado (alterado depois)" if sujo else "commitado"


ARQUIVOS = [
    ("Eleitorado (base do mapa)", "src/data/electorate-go.json"),
    ("Indicadores IBGE", "src/data/socioeconomic-go.json"),
    ("Estrutura etária", "src/data/age-structure-go.json"),
    ("Alfabetização", "src/data/literacy-go.json"),
    ("Histórico Pres./Gov. (aba Eleições)", "src/data/election-history-go.json"),
    ("Municipais por partido (Espectro)", "src/data/party-votes-go.json"),
    ("Locais de votação (aba Locais/bairros)", "src/data/polling/places-go.json"),
    ("Trajetória da candidata (aba Accorsi)", "src/data/candidato/adriana-accorsi.json"),
]

faltando = []
for rotulo, relativo in ARQUIVOS:
    caminho = Path(relativo)
    tem, resumo = conteudo(caminho)
    marca = "OK  " if tem else "FALTA"
    print(f"{marca} {rotulo}")
    print(f"      arquivo: {resumo}")
    print(f"      git:     {no_git(caminho)}")
    if not tem:
        faltando.append((rotulo, relativo))

votos = sorted(Path("src/data/polling").glob("votes-*.json"))
print(f"{'OK  ' if votos else 'FALTA'} Votos por local de votação")
print(f"      arquivo: {len(votos)} pleito(s)")

print()
if faltando:
    print("=== Falta gerar ============================================")
    for rotulo, relativo in faltando:
        print(f"  - {rotulo}  ({relativo})")
    print()
    print("  Rode:  bash gerar_dados.sh")
    print("  Depois:  git add -A src/data backend/data && git commit -m 'Atualiza dados' && git push")
else:
    print("Tudo gerado. Se o site ainda mostra 'não gerado', o que falta é")
    print("commitar e dar push — confira a coluna 'git' acima.")
PY
