#!/usr/bin/env python3
"""Diagnóstico do cadastro de locais de votação do TSE.

Descobre POR QUE uma mesma seção aparece em dois locais diferentes, para que o
process_tse_sections.py possa tratar o caso corretamente em vez de chutar.

Uso:

    python3 scripts/diagnostico_locais.py \
        --places-file dados_tse/eleitorado_local_votacao_2022.zip

Não escreve nada: só lê o arquivo e imprime um relatório.
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

STATE = "GO"
SOURCE_ENCODING = "latin-1"
MAX_EXEMPLOS = 3


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--places-file",
        type=Path,
        default=project_root / "dados_tse" / "eleitorado_local_votacao_2022.zip",
        help="ZIP ou CSV do cadastro de locais de votação.",
    )
    parser.add_argument(
        "--uf",
        default=STATE,
        help="UF a inspecionar (padrão: GO). Use TODAS para não filtrar.",
    )
    return parser.parse_args()


def abrir_tabela(path: Path):
    """Devolve (nome_do_membro, linhas_de_texto) para ZIP ou CSV solto."""
    if path.suffix.lower() == ".zip":
        archive = ZipFile(path)
        csvs = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        if len(csvs) != 1:
            print(f"AVISO: {len(csvs)} CSVs dentro do ZIP: {csvs}", file=sys.stderr)
        member = csvs[0]
        raw = archive.open(member)
        return member, io.TextIOWrapper(raw, encoding=SOURCE_ENCODING, newline="")
    return path.name, path.open(encoding=SOURCE_ENCODING, newline="")


def achar_coluna(campos: list[str], alternativas: tuple[str, ...]) -> str | None:
    disponiveis = {c.upper(): c for c in campos}
    for alt in alternativas:
        if alt.upper() in disponiveis:
            return disponiveis[alt.upper()]
    return None


def main() -> None:
    args = parse_args()
    path = args.places_file.resolve()
    if not path.is_file():
        raise SystemExit(f"Arquivo não encontrado: {path}")

    member, handle = abrir_tabela(path)
    with handle:
        reader = csv.DictReader(handle, delimiter=";", quotechar='"')
        campos = list(reader.fieldnames or [])

        print("=" * 78)
        print(f"ARQUIVO: {member}")
        print("=" * 78)
        print(f"\n{len(campos)} COLUNAS:\n")
        for i, campo in enumerate(campos, start=1):
            print(f"  {i:2d}. {campo}")

        col_uf = achar_coluna(campos, ("SG_UF", "SG_UF_SECAO"))
        col_mun = achar_coluna(campos, ("CD_MUNICIPIO", "CD_MUNICIPIO_SECAO"))
        col_zona = achar_coluna(campos, ("NR_ZONA", "NR_ZONA_SECAO"))
        col_secao = achar_coluna(campos, ("NR_SECAO", "NR_SECAO_SECAO"))
        col_local = achar_coluna(campos, ("NR_LOCAL_VOTACAO", "CD_LOCAL_VOTACAO", "NR_LOCAL"))

        faltando = [
            nome
            for nome, valor in (
                ("município", col_mun),
                ("zona", col_zona),
                ("seção", col_secao),
                ("local", col_local),
            )
            if valor is None
        ]
        if faltando:
            raise SystemExit(f"Colunas essenciais não encontradas: {', '.join(faltando)}")

        # (municipio, zona, secao) -> {local -> [linhas]}
        grupos: dict[tuple[str, str, str], dict[str, list[dict[str, str]]]] = defaultdict(
            lambda: defaultdict(list)
        )
        total_linhas = 0
        for row in reader:
            if col_uf and args.uf.upper() != "TODAS":
                if (row.get(col_uf) or "").strip().strip('"').upper() != args.uf.upper():
                    continue
            total_linhas += 1
            chave = (
                (row.get(col_mun) or "").strip(),
                (row.get(col_zona) or "").strip(),
                (row.get(col_secao) or "").strip(),
            )
            local = (row.get(col_local) or "").strip()
            grupos[chave][local].append(row)

    print("\n" + "=" * 78)
    print(f"LINHAS ({args.uf}): {total_linhas:,}")
    print(f"SEÇÕES DISTINTAS: {len(grupos):,}")

    conflitos = {k: v for k, v in grupos.items() if len(v) > 1}
    repetidas = {k: v for k, v in grupos.items() if len(v) == 1 and sum(len(r) for r in v.values()) > 1}

    print(f"SEÇÕES EM MAIS DE UM LOCAL: {len(conflitos):,}")
    print(f"SEÇÕES COM LINHA REPETIDA NO MESMO LOCAL: {len(repetidas):,}")
    print("=" * 78)

    if not conflitos:
        print("\nNenhum conflito. O erro deve vir de outra UF ou de linha repetida.")
        return

    # Quais colunas variam entre as linhas conflitantes? É isso que desempata.
    variacao: dict[str, int] = defaultdict(int)
    for locais in conflitos.values():
        linhas = [r for rows in locais.values() for r in rows]
        for campo in campos:
            valores = {(r.get(campo) or "").strip() for r in linhas}
            if len(valores) > 1:
                variacao[campo] += 1

    print("\nCOLUNAS QUE VARIAM DENTRO DE UM CONFLITO (quantos conflitos cada uma explica):\n")
    for campo, qtd in sorted(variacao.items(), key=lambda kv: -kv[1]):
        pct = 100 * qtd / len(conflitos)
        print(f"  {campo:<28} {qtd:>6,} de {len(conflitos):,}  ({pct:5.1f}%)")

    print("\n" + "=" * 78)
    print(f"EXEMPLOS (até {MAX_EXEMPLOS}):")
    print("=" * 78)
    for chave, locais in list(conflitos.items())[:MAX_EXEMPLOS]:
        print(f"\n--- município {chave[0]} · zona {chave[1]} · seção {chave[2]} ---")
        linhas = [r for rows in locais.values() for r in rows]
        # só imprime as colunas que diferem, mais as de identificação
        interessantes = [
            c
            for c in campos
            if len({(r.get(c) or "").strip() for r in linhas}) > 1 or c == col_local
        ]
        for i, linha in enumerate(linhas, start=1):
            print(f"  linha {i}:")
            for campo in interessantes:
                print(f"      {campo:<26} = {(linha.get(campo) or '').strip()!r}")


if __name__ == "__main__":
    main()
