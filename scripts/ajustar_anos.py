#!/usr/bin/env python3
"""Mostra o que já foi gerado em src/data e remove anos do histórico eleitoral.

Duas funções, porque as duas dúvidas costumam vir juntas:

1. `--status` (padrão): diz, arquivo por arquivo, o que já tem dado real e o que
   ainda está com o placeholder "pendente". É como conferir se o gerar_dados.sh
   terminou de verdade.

2. `--remover-anos 2018`: tira aqueles anos do election-history-go.json (o painel
   "Histórico de votação", de Presidente e Governador). O arquivo NÃO é gerado
   pelo gerar_dados.sh — vem pronto no repositório — então é aqui que se mexe.

   Atenção: o histórico é a única fonte da métrica "Evolução", que compara um
   candidato com o pleito anterior. Removendo 2018, a comparação de 2022 fica
   sem par e some da interface. Dá para desfazer com `git checkout` nos dois
   arquivos, já que nada é apagado do repositório remoto.

Uso:

    python3 scripts/ajustar_anos.py
    python3 scripts/ajustar_anos.py --remover-anos 2018
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
HISTORICO = RAIZ / "src" / "data" / "election-history-go.json"
HISTORICO_BACKEND = RAIZ / "backend" / "data" / "election-history-go.json"


def carregar(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def gravar(payload: dict, path: Path) -> None:
    temporario = path.with_suffix(path.suffix + ".tmp")
    temporario.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporario.replace(path)


def status() -> None:
    print("=" * 70)
    print("O QUE JÁ FOI GERADO")
    print("=" * 70)

    def linha(rotulo: str, ok: bool, detalhe: str) -> None:
        marca = "PRONTO  " if ok else "PENDENTE"
        print(f"  [{marca}] {rotulo:<34} {detalhe}")

    dados = RAIZ / "src" / "data"

    for nome, rotulo in (
        ("electorate-go.json", "Eleitorado / municípios"),
        ("socioeconomic-go.json", "Indicadores socioeconômicos"),
    ):
        caminho = dados / nome
        if not caminho.is_file():
            linha(rotulo, False, "arquivo não existe")
            continue
        meta = carregar(caminho).get("metadata", {})
        total = meta.get("municipalityCount", 0)
        linha(rotulo, total > 0, f"{total} municípios")

    caminho = dados / "election-history-go.json"
    if caminho.is_file():
        meta = carregar(caminho).get("metadata", {})
        anos = meta.get("years", [])
        linha("Histórico eleitoral", bool(anos), f"anos: {anos}")

    caminho = dados / "party-votes-go.json"
    if caminho.is_file():
        payload = carregar(caminho)
        pleitos = payload.get("contests") or []
        anos = sorted({p.get("electionYear") for p in pleitos})
        linha(
            "Eleições municipais (Espectro)",
            bool(pleitos),
            f"{len(pleitos)} pleitos, anos: {anos}" if pleitos else "rode o gerar_dados.sh",
        )

    caminho = dados / "age-structure-go.json"
    if caminho.is_file():
        meta = carregar(caminho).get("metadata", {})
        total = meta.get("municipalityCount", 0)
        linha(
            "Estrutura etária (Censo 2022)",
            total > 0,
            f"{total} municípios" if total else "rode o gerar_dados.sh",
        )

    polling = dados / "polling"
    lugares = polling / "places-go.json"
    if lugares.is_file():
        payload = carregar(lugares)
        total = len(payload.get("places") or [])
        votos = sorted(p.name for p in polling.glob("votes-*.json"))
        linha(
            "Locais de votação",
            total > 0,
            f"{total} locais · {len(votos)} pleitos" if total else "rode o gerar_dados.sh",
        )
        for nome in votos:
            pleito = nome.removeprefix("votes-").removesuffix(".json")
            print(f"              · {pleito}")

    print("=" * 70)
    print("Lembrete: 2024 foi eleição MUNICIPAL (Prefeito e Vereador).")
    print("Ela aparece nas camadas Espectro e Locais — nunca no painel")
    print("'Histórico de votação', que é de Presidente e Governador.")
    print("=" * 70)


def remover_anos(anos: list[int]) -> None:
    if not HISTORICO.is_file():
        raise SystemExit(f"Não encontrei {HISTORICO}.")

    payload = carregar(HISTORICO)
    pleitos = payload.get("contests") or []
    restantes = [p for p in pleitos if p.get("electionYear") not in anos]

    removidos = len(pleitos) - len(restantes)
    if removidos == 0:
        print(f"Nenhum pleito de {anos} no arquivo; nada a fazer.")
        return
    if not restantes:
        raise SystemExit(
            "Isso removeria TODOS os pleitos e deixaria o painel vazio. Abortado."
        )

    anos_restantes = sorted({p["electionYear"] for p in restantes})
    payload["contests"] = restantes
    meta = payload.setdefault("metadata", {})
    meta["years"] = anos_restantes
    meta["contestCount"] = len(restantes)
    meta["municipalResultCount"] = sum(
        len(p.get("municipalResults") or p.get("municipalities") or []) for p in restantes
    )
    meta["removedYears"] = sorted(anos)
    meta["removalNote"] = (
        f"Anos {sorted(anos)} removidos do histórico a pedido do produto. "
        "Regerar com scripts/process_tse_history.py para trazê-los de volta."
    )
    # Os arquivos de entrada dos anos removidos deixam de descrever a saída.
    entradas = meta.get("inputFiles") or {}
    meta["inputFiles"] = {
        chave: valor
        for chave, valor in entradas.items()
        if not any(str(ano) in chave for ano in anos)
    }

    gravar(payload, HISTORICO)
    print(f"Removidos {removidos} pleitos de {sorted(anos)} em {HISTORICO.name}.")
    print(f"Anos restantes: {anos_restantes}")

    if HISTORICO_BACKEND.is_file():
        shutil.copyfile(HISTORICO, HISTORICO_BACKEND)
        print(f"Cópia do backend atualizada: {HISTORICO_BACKEND.relative_to(RAIZ)}")

    print()
    print("A métrica 'Evolução' fica sem par de comparação e some da interface.")
    print("Para desfazer:")
    print("  git checkout src/data/election-history-go.json backend/data/election-history-go.json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--remover-anos",
        type=int,
        nargs="+",
        metavar="ANO",
        help="Anos a remover do histórico eleitoral (ex.: --remover-anos 2018).",
    )
    args = parser.parse_args()

    if args.remover_anos:
        remover_anos(args.remover_anos)
        print()
    status()


if __name__ == "__main__":
    main()
