#!/usr/bin/env bash
# =============================================================================
# gerar_dados.sh — baixa os dados públicos (TSE + IBGE) e gera TODOS os JSONs
# que ainda faltam na plataforma:
#
#   1. src/data/polling/places-go.json + votes-*.json  (camada "Locais")
#   2. src/data/party-votes-go.json                    (eleições 2020/2024)
#   3. src/data/age-structure-go.json                  (Censo 2022, 16+ anos)
#
# Uso, a partir da raiz do projeto:
#
#     bash gerar_dados.sh
#
# Requisitos: python3 (3.11+), wget ou curl, ~3 GB livres em disco.
# Os downloads têm retomada automática: se cair a conexão, rode de novo e
# ele continua de onde parou. Os ZIPs ficam em dados_tse/ (fora do git).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f scripts/process_tse_sections.py ]]; then
  echo "ERRO: rode este script a partir da raiz do projeto (onde está a pasta scripts/)." >&2
  exit 1
fi

# --- Python 3.11+ (os scripts usam datetime.UTC, que só existe a partir daí) -
eh_311_ou_mais() {
  "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null
}

PYTHON=""
for candidato in python3.13 python3.12 python3.11 python3; do
  if command -v "$candidato" >/dev/null && eh_311_ou_mais "$candidato"; then
    PYTHON="$candidato"
    break
  fi
done

if [[ -z "$PYTHON" ]]; then
  versao_atual="$(command -v python3 >/dev/null && python3 --version || echo "não instalado")"
  echo "Python 3.11+ não encontrado (o seu: $versao_atual)."
  echo "Os scripts usam um recurso (datetime.UTC) que só existe a partir do 3.11."
  if command -v apt-get >/dev/null; then
    echo "Vou tentar instalar o Python 3.11 via PPA deadsnakes (vai pedir sua senha do sudo)..."
    if sudo add-apt-repository -y ppa:deadsnakes/ppa \
        && sudo apt-get update -qq \
        && sudo apt-get install -y python3.11; then
      if command -v python3.11 >/dev/null && eh_311_ou_mais python3.11; then
        PYTHON="python3.11"
        echo "  [ok] Python 3.11 instalado."
      fi
    fi
  fi
fi

if [[ -z "$PYTHON" ]]; then
  cat >&2 <<'MSG'

ERRO: não consegui obter um Python 3.11+ automaticamente.

Instale manualmente e rode o script de novo. No Ubuntu/Debian:

    sudo add-apt-repository ppa:deadsnakes/ppa
    sudo apt-get update
    sudo apt-get install -y python3.11

Depois confirme com: python3.11 --version
MSG
  exit 1
fi

echo "Usando $($PYTHON --version) ($PYTHON)."

# --- Downloader com retomada -------------------------------------------------
baixar() { # baixar <url> <destino>
  local url="$1" dest="$2"
  if [[ -f "$dest.ok" ]]; then
    echo "  [ok] $(basename "$dest") já baixado, pulando."
    return 0
  fi
  echo "  Baixando $(basename "$dest")..."
  if command -v wget >/dev/null; then
    wget -c -q --show-progress -O "$dest" "$url"
  elif command -v curl >/dev/null; then
    curl -L -C - --retry 3 -o "$dest" "$url"
  else
    echo "ERRO: nem wget nem curl instalados. Instale com: sudo apt install wget" >&2
    exit 1
  fi
  # valida que é um ZIP íntegro antes de marcar como ok
  if ! $PYTHON - "$dest" <<'PY'
import sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    bad = z.testzip()
    if bad is not None:
        raise SystemExit(f"ZIP corrompido em {bad}")
PY
  then
    echo "ERRO: $(basename "$dest") veio corrompido. Apaguei o arquivo; rode o script de novo." >&2
    rm -f "$dest"
    exit 1
  fi
  touch "$dest.ok"
}

tentar_baixar() { # tentar_baixar <url> <destino>  -> retorna 1 se a URL não existir
  local url="$1" dest="$2"
  if [[ -f "$dest.ok" ]]; then return 0; fi
  if command -v wget >/dev/null; then
    if ! wget -c -q --show-progress -O "$dest" "$url"; then rm -f "$dest"; return 1; fi
  else
    if ! curl -fL -C - --retry 3 -o "$dest" "$url"; then rm -f "$dest"; return 1; fi
  fi
  $PYTHON - "$dest" <<'PY' || { rm -f "$dest"; return 1; }
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    if z.testzip() is not None:
        raise SystemExit(1)
PY
  touch "$dest.ok"
}

mkdir -p dados_tse/secoes dados_tse/munzona dados_tse/cache_ibge dados_tse/candidaturas

# dados_tse/ nunca entra no git
if ! grep -q '^dados_tse/$' .gitignore 2>/dev/null; then
  printf '\n# Dados brutos baixados pelo gerar_dados.sh\ndados_tse/\n' >> .gitignore
  echo "  (.gitignore atualizado para ignorar dados_tse/)"
fi

CDN="https://cdn.tse.jus.br/estatistica/sead/odsele"

# Candidatura em foco da aba dedicada. Trocar aqui é tudo o que se precisa para
# apontar a plataforma para outra pessoa.
CANDIDATA_NOME="${CANDIDATA_NOME:-ADRIANA ACCORSI}"
CANDIDATA_PARTIDO="${CANDIDATA_PARTIDO:-PT}"

echo
echo "=== PASSO 0 de 5: base territorial (eleitorado e indicadores do IBGE) ==="
echo "  Este passo NÃO existia na versão do Rio Grande do Sul: lá esses"
echo "  arquivos já vinham prontos no repositório. Em Goiás eles nascem aqui."
echo "  (O histórico eleitoral também nasce aqui, mas no PASSO 1c: ele depende"
echo "   de pacotes que só são baixados nos passos 1 e 1b.)"

# --- Eleitorado e correspondência TSE/IBGE ---------------------------------
baixar "$CDN/perfil_eleitorado/perfil_eleitorado_2026.zip" \
  dados_tse/perfil_eleitorado_2026.zip
# URL conferida no portal de dados abertos do TSE, conjunto "Códigos oficiais
# de UF e municípios segundo o TSE e o IBGE".
baixar "$CDN/municipio_tse_ibge/municipio_tse_ibge.zip" \
  dados_tse/municipio_tse_ibge.zip

if [[ ! -s src/data/electorate-go.json ]] || \
   grep -q '"status": *"pendente"' src/data/electorate-go.json; then
  echo "  Gerando o eleitorado de Goiás..."
  $PYTHON scripts/process_tse.py \
    --profile-zip dados_tse/perfil_eleitorado_2026.zip \
    --mapping-zip dados_tse/municipio_tse_ibge.zip
else
  echo "  [ok] eleitorado já gerado."
fi

# --- Indicadores socioeconômicos do IBGE (só API, sem download pesado) ------
if grep -q '"status": *"pendente"' src/data/socioeconomic-go.json; then
  echo "  Consultando os indicadores do IBGE..."
  $PYTHON scripts/process_ibge.py
else
  echo "  [ok] indicadores socioeconômicos já gerados."
fi

echo
echo "=== PASSO 1 de 5: votação por seção (camada Locais: 2022 e 2024) ========="
echo "  2022 traz Presidente e Governador; 2024, Prefeito e Vereador."
echo "  (2018 fica de fora: o histórico municipal já cobre aquele ano.)"
baixar "$CDN/votacao_secao/votacao_secao_2022_GO.zip" dados_tse/secoes/votacao_secao_2022_GO.zip
baixar "$CDN/votacao_secao/votacao_secao_2022_BR.zip" dados_tse/secoes/votacao_secao_2022_BR.zip
# 2024 é eleição municipal: não existe pacote nacional de votação por seção.
baixar "$CDN/votacao_secao/votacao_secao_2024_GO.zip" dados_tse/secoes/votacao_secao_2024_GO.zip

# Um cadastro de locais POR ANO: o TSE renumera seções entre eleições, então
# casar os votos de 2024 com o mapa de seções de 2022 jogaria voto no bairro
# errado. O script recusa rodar sem o cadastro do ano.
echo "  Cadastro de locais de votação de 2022..."
if ! tentar_baixar "$CDN/eleitorado_locais_votacao/eleitorado_local_votacao_2022.zip" \
    dados_tse/eleitorado_local_votacao_2022.zip; then
  echo "  (arquivo de 2022 indisponível, usando o cadastro ATUAL)"
  baixar "$CDN/perfil_eleitorado/eleitorado_local_votacao_ATUAL.zip" \
    dados_tse/eleitorado_local_votacao_2022.zip
fi

echo "  Cadastro de locais de votação de 2024..."
if ! tentar_baixar "$CDN/eleitorado_locais_votacao/eleitorado_local_votacao_2024.zip" \
    dados_tse/eleitorado_local_votacao_2024.zip; then
  echo "  (arquivo de 2024 indisponível, usando o cadastro ATUAL)"
  baixar "$CDN/perfil_eleitorado/eleitorado_local_votacao_ATUAL.zip" \
    dados_tse/eleitorado_local_votacao_2024.zip
fi

# Os pacotes de votação por seção identificam a candidatura por SQ_CANDIDATO e
# nem sempre repetem a sigla do partido na linha. O cadastro de candidaturas é a
# fonte oficial da sigla; o script usa a coluna quando ela existe e cai aqui
# quando não existe.
echo "  Cadastro de candidaturas (fonte da sigla do partido)..."
baixar "$CDN/consulta_cand/consulta_cand_2022.zip" dados_tse/candidaturas/consulta_cand_2022.zip
baixar "$CDN/consulta_cand/consulta_cand_2024.zip" dados_tse/candidaturas/consulta_cand_2024.zip

echo
echo "  Processando (pode levar vários minutos)..."
$PYTHON scripts/process_tse_sections.py \
  --sections-dir dados_tse/secoes \
  --places-file 2022=dados_tse/eleitorado_local_votacao_2022.zip \
  --places-file 2024=dados_tse/eleitorado_local_votacao_2024.zip \
  --candidates-dir dados_tse/candidaturas \
  --years 2022 2024

echo
echo "=== PASSO 1b de 5: trajetória da candidatura em foco ====================="
echo "  Seis eleições: 2014 e 2018 (estadual), 2016/2020/2024 (Goiânia) e 2022"
echo "  (federal). Cada ano precisa do seu pacote de seção, do cadastro de"
echo "  candidaturas e — para o recorte por bairro — do cadastro de locais."

mkdir -p dados_tse/locais

for ano in 2014 2016 2018 2020 2022 2024; do
  tentar_baixar "$CDN/votacao_secao/votacao_secao_${ano}_GO.zip" \
    "dados_tse/secoes/votacao_secao_${ano}_GO.zip" \
    || echo "  (sem votacao_secao_${ano}_GO.zip; o ano fica de fora e o script avisa)"
  tentar_baixar "$CDN/consulta_cand/consulta_cand_${ano}.zip" \
    "dados_tse/candidaturas/consulta_cand_${ano}.zip" \
    || echo "  (sem consulta_cand_${ano}.zip)"
  tentar_baixar "$CDN/eleitorado_locais_votacao/eleitorado_local_votacao_${ano}.zip" \
    "dados_tse/locais/eleitorado_local_votacao_${ano}.zip" \
    || echo "  (sem cadastro de locais de ${ano}: esse ano sai só por município)"
done

# --partido desempata homônimos: sem isso o script se recusa a somar, de
# propósito, porque duas pessoas de mesmo nome inflariam o total.
$PYTHON scripts/process_candidato_foco.py \
  --nome "$CANDIDATA_NOME" \
  --partido "$CANDIDATA_PARTIDO" \
  --sections-dir dados_tse/secoes \
  --candidates-dir dados_tse/candidaturas \
  --places-dir dados_tse/locais \
  --anos 2014 2016 2018 2020 2022 2024

echo
echo "=== PASSO 1c de 5: histórico de Presidente e Governador (2018 e 2022) ===="
echo "  É o que alimenta a aba Eleições. Reaproveita quase tudo que já foi"
echo "  baixado: só o pacote nacional de 2018 (Presidente) falta, porque o"
echo "  PASSO 1 baixa o nacional de 2022 e o PASSO 1b, os estaduais."

# Presidente é eleição nacional: os votos vêm no pacote BR, não no de Goiás.
baixar "$CDN/votacao_secao/votacao_secao_2018_BR.zip" \
  dados_tse/secoes/votacao_secao_2018_BR.zip

if [[ ! -s src/data/election-history-go.json ]] || \
   grep -q '"status": *"pendente"' src/data/election-history-go.json; then
  echo "  Processando (pode levar vários minutos)..."
  $PYTHON scripts/process_tse_history.py \
    --section-2018 dados_tse/secoes/votacao_secao_2018_GO.zip \
    --section-2022 dados_tse/secoes/votacao_secao_2022_GO.zip \
    --president-2018 dados_tse/secoes/votacao_secao_2018_BR.zip \
    --president-2022 dados_tse/secoes/votacao_secao_2022_BR.zip \
    --candidates-2018 dados_tse/candidaturas/consulta_cand_2018.zip \
    --candidates-2022 dados_tse/candidaturas/consulta_cand_2022.zip
else
  echo "  [ok] histórico eleitoral já gerado."
fi

echo
echo "=== PASSO 2 de 5: eleições municipais 2020 e 2024 por partido ============"
for ano in 2020 2024; do
  destino="dados_tse/munzona/votacao_partido_munzona_${ano}_GO.zip"
  if tentar_baixar "$CDN/votacao_partido_munzona/votacao_partido_munzona_${ano}_GO.zip" "$destino"; then
    echo "  [ok] votacao_partido_munzona_${ano}_GO.zip"
  else
    echo "  (versão só de Goiás indisponível para $ano; baixando o pacote nacional e recortando)"
    baixar "$CDN/votacao_partido_munzona/votacao_partido_munzona_${ano}.zip" \
      "dados_tse/munzona/votacao_partido_munzona_${ano}.zip"
    $PYTHON - "$ano" <<'PY'
import sys, zipfile
from pathlib import Path

ano = sys.argv[1]
origem = Path(f"dados_tse/munzona/votacao_partido_munzona_{ano}.zip")
destino = Path(f"dados_tse/munzona/votacao_partido_munzona_{ano}_GO.zip")
with zipfile.ZipFile(origem) as z:
    csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
    rs = [n for n in csvs if n.lower().endswith(f"_{ano}_go.csv".lower())]
    # ou um CSV por UF (pegamos o de Goiás), ou um único CSV nacional (renomeamos;
    # o process_tse_municipal.py filtra as linhas por SG_UF == RS de toda forma)
    alvo = rs[0] if rs else (csvs[0] if len(csvs) == 1 else None)
    if alvo is None:
        raise SystemExit(f"Não achei o CSV de Goiás dentro de {origem}: {csvs}")
    dados = z.read(alvo)
with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(f"votacao_partido_munzona_{ano}_go.csv", dados)
print(f"  [ok] recortado -> {destino.name}")
PY
    touch "$destino.ok"
  fi
done

$PYTHON scripts/process_tse_municipal.py --input-dir dados_tse/munzona

echo
echo "=== PASSO 3 de 5: estrutura etária e alfabetização do Censo 2022 (IBGE) =="
$PYTHON scripts/process_ibge_age.py --cache-dir dados_tse/cache_ibge
$PYTHON scripts/process_ibge_literacy.py --cache-dir dados_tse/cache_ibge_alfabetizacao

echo
echo "=== PASSO 4 de 5: verificação e cópia para o backend ====================="
$PYTHON - <<'PY'
import json, sys
from pathlib import Path

erros = []

places = Path("src/data/polling/places-go.json")
dados = json.loads(places.read_text(encoding="utf-8"))
n_locais = len(dados.get("places") or [])
if n_locais == 0:
    erros.append("places-go.json continua vazio")
votos = sorted(Path("src/data/polling").glob("votes-*.json"))
if not votos:
    erros.append("nenhum votes-*.json gerado em src/data/polling/")

pv = json.loads(Path("src/data/party-votes-go.json").read_text(encoding="utf-8"))
n_pleitos = len(pv.get("contests") or [])
if n_pleitos == 0:
    erros.append("party-votes-go.json continua sem pleitos (2020/2024)")

idade = json.loads(Path("src/data/age-structure-go.json").read_text(encoding="utf-8"))
n_idade = idade.get("metadata", {}).get("municipalityCount", 0)
if n_idade != 246:
    erros.append(f"age-structure-go.json cobre {n_idade} municípios (esperado 246)")

alfa = json.loads(Path("src/data/literacy-go.json").read_text(encoding="utf-8"))
n_alfa = alfa.get("metadata", {}).get("municipalityCount", 0)
if n_alfa != 246:
    erros.append(f"literacy-go.json cobre {n_alfa} municípios (esperado 246)")

# Histórico de Presidente/Governador: a ausência dele já subiu para produção
# uma vez, calada, porque esta verificação não olhava para ele. O app tolera o
# arquivo pendente (a aba Eleições explica e o resto funciona), mas subir sem
# ele é decisão consciente, não acidente — então aqui é erro.
hist = json.loads(Path("src/data/election-history-go.json").read_text(encoding="utf-8"))
n_hist = len(hist.get("contests") or [])
if n_hist == 0 or hist.get("metadata", {}).get("status") == "pendente":
    erros.append("election-history-go.json continua pendente (aba Eleições vazia)")

# Trajetória da candidatura em foco: mesma lógica.
foco = sorted(Path("src/data/candidato").glob("*.json"))
foco = [p for p in foco if p.name != "LEIAME.md"]
n_foco = 0
for arquivo in foco:
    dados_foco = json.loads(arquivo.read_text(encoding="utf-8"))
    n_foco = max(n_foco, len(dados_foco.get("contests") or []))
if n_foco == 0:
    erros.append("nenhuma trajetória gerada em src/data/candidato/ (aba da candidata vazia)")

if erros:
    print("FALHOU NA VERIFICAÇÃO:")
    for e in erros:
        print(f"  - {e}")
    sys.exit(1)

print(f"  Locais de votação: {n_locais}")
print(f"  Arquivos de votos por pleito: {len(votos)} ({', '.join(v.name for v in votos)})")
print(f"  Pleitos municipais 2020/2024: {n_pleitos}")
print(f"  Estrutura etária: {n_idade} municípios")
print(f"  Alfabetização 15+: {n_alfa} municípios")
print(f"  Histórico Presidente/Governador: {n_hist} pleitos")
print(f"  Trajetória da candidatura: {n_foco} pleitos")
print("  Tudo gerado e validado.")
PY

# o Railway isola o serviço api em backend/, então os snapshots usados lá são duplicados
# O serviço `api` no Railway tem Root Directory `backend/`, então nada fora
# dessa pasta entra na imagem dele. Todo snapshot que a carga do banco usa
# precisa ser espelhado aqui — senão o `railway ssh ... import-*` não acha.
for arquivo in electorate-go.json socioeconomic-go.json election-history-go.json \
               party-votes-go.json party-spectrum.json; do
  if [[ -f "src/data/$arquivo" ]]; then
    cp "src/data/$arquivo" "backend/data/$arquivo"
  fi
done
cp shared/agent-tools.json backend/data/agent-tools.json
echo "  Snapshots espelhados em backend/data/ (usados pelo serviço api)."

echo
echo "==========================================================================="
echo " PRONTO! Agora mande para o GitHub (o Railway faz o deploy sozinho):"
echo
echo "   git add ."
echo "   git commit -m \"Adiciona dados reais: locais de votação, eleições 2020/2024 e Censo 2022\""
echo "   git push"
echo "==========================================================================="
