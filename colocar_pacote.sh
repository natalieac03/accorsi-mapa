#!/usr/bin/env bash
# Põe um ZIP do TSE baixado à mão no lugar certo dentro de dados_tse/.
#
# Cada tipo de pacote mora numa pasta diferente, e o gerar_dados.sh procura
# exatamente naquele caminho — arquivo no lugar errado é o mesmo que arquivo
# ausente, e ele baixa tudo de novo. Este script descobre o destino pelo NOME
# do arquivo, confere que o ZIP não veio corrompido e cria o marcador ".ok"
# que faz o download ser pulado na próxima rodada.
#
# Uso, na raiz do projeto:
#   bash colocar_pacote.sh ~/Downloads/votacao_secao_2022_GO.zip
#   bash colocar_pacote.sh ~/Downloads/*.zip        (vários de uma vez)

set -uo pipefail
cd "$(dirname "$0")" || exit 1

if [[ $# -eq 0 ]]; then
  echo "Uso: bash colocar_pacote.sh <arquivo.zip> [outro.zip ...]" >&2
  exit 1
fi

PYTHON="$(command -v python3.11 || command -v python3)"
instalados=0

instalar() { # instalar <origem> <destino-completo>
  local origem="$1" destino="$2"
  mkdir -p "$(dirname "$destino")"
  cp "$origem" "$destino"
  # O .ok só nasce DEPOIS de o ZIP provar que abre. Marcar antes de conferir
  # transformaria um download pela metade em "já baixado, pulando" — e o erro
  # só apareceria lá na frente, no processamento, sem dizer a causa.
  # stderr silenciado: o traceback do Python nao ajuda quem so quer saber
  # que o arquivo veio quebrado. A mensagem util vem no else.
  if "$PYTHON" - "$destino" 2>/dev/null <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    if z.testzip() is not None:
        raise SystemExit("conteudo corrompido")
PY
  then
    touch "$destino.ok"
    echo "  [ok] $destino"
  else
    rm -f "$destino"
    echo "  !! $(basename "$origem") está corrompido — apaguei a cópia. Baixe de novo." >&2
    return 1
  fi
}

for origem in "$@"; do
  if [[ ! -f "$origem" ]]; then
    echo "!! não achei: $origem" >&2
    continue
  fi
  nome="$(basename "$origem")"
  base="${nome%.zip}"
  echo "$nome"

  case "$nome" in
    votacao_secao_*_GO.zip | votacao_secao_*_BR.zip)
      instalar "$origem" "dados_tse/secoes/$nome" && instalados=$((instalados + 1))
      ;;
    consulta_cand_*.zip)
      instalar "$origem" "dados_tse/candidaturas/$nome" && instalados=$((instalados + 1))
      ;;
    votacao_partido_munzona_*.zip)
      instalar "$origem" "dados_tse/munzona/$nome" && instalados=$((instalados + 1))
      ;;
    eleitorado_local_votacao_*.zip)
      # Este é o único que o pipeline procura em DOIS lugares: o PASSO 1 lê o
      # cadastro de 2022 e 2024 na raiz de dados_tse/, e o PASSO 1b lê o de
      # cada ano em dados_tse/locais/. Copiar para os dois evita a pegadinha
      # de "coloquei o arquivo e ele baixou de novo assim mesmo".
      ano="${base##*_}"
      instalar "$origem" "dados_tse/locais/$nome" && instalados=$((instalados + 1))
      if [[ "$ano" == "2022" || "$ano" == "2024" ]]; then
        instalar "$origem" "dados_tse/$nome" && instalados=$((instalados + 1))
      fi
      ;;
    perfil_eleitorado_*.zip | municipio_tse_ibge.zip)
      instalar "$origem" "dados_tse/$nome" && instalados=$((instalados + 1))
      ;;
    *)
      echo "  ?? não sei onde vai '$nome'. Nomes reconhecidos:" >&2
      echo "     votacao_secao_ANO_GO.zip / _BR.zip · consulta_cand_ANO.zip" >&2
      echo "     votacao_partido_munzona_ANO_GO.zip · eleitorado_local_votacao_ANO.zip" >&2
      echo "     perfil_eleitorado_ANO.zip · municipio_tse_ibge.zip" >&2
      ;;
  esac
done

echo
if [[ "$instalados" -gt 0 ]]; then
  echo "Pronto. Agora rode:  bash gerar_dados.sh"
else
  echo "Nenhum pacote foi instalado — veja as mensagens acima."
fi
