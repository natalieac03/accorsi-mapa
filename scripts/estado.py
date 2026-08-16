"""Configuração do estado atendido por esta instalação (lado Python).

Espelha `src/config/estado.ts`. Os dois arquivos precisam concordar — há um
teste no frontend que lê este aqui e compara, porque uma divergência entre a
sigla do ETL e a do mapa produziria um app que carrega a malha de um estado e
os dados de outro, sem erro nenhum na tela.

Todo script de ETL importa daqui em vez de repetir a sigla do estado e a contagem de
municípios como literal.
"""

from __future__ import annotations

from typing import Final

UF: Final[str] = "GO"
NOME: Final[str] = "Goiás"
CODIGO_IBGE: Final[str] = "52"

# Validação dura: os processadores recusam uma base que não cubra exatamente
# este número de municípios, em vez de gerar mapa com buraco.
MUNICIPIOS: Final[int] = 246

CAPITAL_IBGE: Final[str] = "5208707"  # Goiânia
CAPITAL_NOME: Final[str] = "Goiânia"
