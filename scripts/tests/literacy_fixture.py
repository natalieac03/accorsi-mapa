#!/usr/bin/env python3
"""Gera um cache SINTÉTICO no formato da API de agregados v3 do IBGE (tabela 9542).

Nada aqui é dado oficial: todos os valores são inventados para exercitar o
scripts/process_ibge_literacy.py sem rede. Só os códigos IBGE e os nomes dos
dois municípios vêm de src/data/electorate-go.json, para que a validação da
base eleitoral continue valendo — e são ESCOLHIDOS NO MOMENTO (o de menor e o
de maior eleitorado), nunca fixados de antemão: um código fixo corre o risco de
não existir mais na base real quando ela mudar, e foi exatamente isso que
aconteceu quando este fixture ainda carregava dois municípios do Rio Grande do
Sul, herdados do projeto original.

O fixture reproduz a estrutura de resposta da API de agregados v3 (variável
950 "Pessoas de 15 anos ou mais de idade", classificação C59 Alfabetização com
uma categoria por "resultado" e as localidades em "series") e cobre, de
propósito, os casos que o processamento precisa tratar:

* as três categorias da C59 — Total, Alfabetizadas e Não alfabetizadas —
  consistentes entre si (Alfabetizadas + Não alfabetizadas == Total);
* uma consulta estadual (N3, código 52 — Goiás) cujos valores são a soma dos
  dois municípios, para o fechamento estadual;
* o marcador "-" do IBGE para zero verdadeiro (Não alfabetizadas do município
  de menor eleitorado é zero no fixture, logo a taxa municipal é 100.0);
* um manifest.json com SHA-256 de cada arquivo, como o script grava.

Além do cache bom, saem três variantes de falha:

* cache-bad-sum/: o "Total" do município de menor eleitorado foi adulterado
  (+500) e o fechamento Alfabetizadas + Não alfabetizadas == Total deve falhar;
* cache-missing-muni/: a consulta municipal não traz esse município (município
  faltante deve ser falha, o Censo cobre todos);
* cache-wrong-age/: a variável veio nomeada como "Pessoas de 10 anos ou mais
  de idade" (recorte etário errado deve ser falha).

Com --check o script confere a saída do processamento contra os valores
esperados, inclusive taxa == alfabetizados / população 15+ com 1 casa decimal.

Uso:

    python3 scripts/tests/literacy_fixture.py
    python3 scripts/process_ibge_literacy.py \
        --electorate-file scripts/tests/fixtures/literacy/electorate-fixture.json \
        --cache-dir scripts/tests/fixtures/literacy/cache \
        --from-cache \
        --expected-municipalities 2 \
        --output scripts/tests/fixtures/literacy/out/literacy.json
    python3 scripts/tests/literacy_fixture.py \
        --check scripts/tests/fixtures/literacy/out/literacy.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

STATE_CODE = "52"  # Goiás. NUNCA hardcode dois municípios específicos aqui em
# baixo — veja pick_two_municipalities: o código do estado pode ficar fixo
# porque é o mesmo em qualquer base GO, mas município específico não.
YEAR = "2022"
RETRIEVED_AT = "2026-08-16T00:00:00+00:00"
VARIABLE_NAME = "Pessoas de 15 anos ou mais de idade"
SYNTHETIC_NOTE = (
    "FIXTURE SINTÉTICO: valores de alfabetização inventados por "
    "scripts/tests/literacy_fixture.py; apenas códigos e nomes municipais são reais."
)
CATEGORY_NAMES = ("Total", "Alfabetizadas", "Não alfabetizadas")


def pick_two_municipalities(electorate: dict[str, Any]) -> list[tuple[str, int]]:
    """O de menor e o de maior eleitorado da base real, com semente 1 e 6.

    Nunca dois códigos fixos: uma base real muda de município para município
    entre gerações, e um código fixo que deixa de existir vira uma falha do
    FIXTURE disfarçada de falha do processamento — foi o que aconteceu com os
    dois municípios do Rio Grande do Sul que ficaram aqui depois do fork.
    """
    municipios = electorate.get("municipalities") or {}
    if len(municipios) < 2:
        raise SystemExit(
            f"A base eleitoral em {electorate.get('metadata', {})} tem menos de "
            "dois municípios; não dá para montar o fixture."
        )
    ordenados = sorted(
        municipios.items(), key=lambda item: item[1].get("electorate", 0)
    )
    menor_code, _ = ordenados[0]
    maior_code, _ = ordenados[-1]
    return [(menor_code, 1), (maior_code, 6)]


def synthetic_values(seed: int) -> dict[str, int]:
    """Valores inventados, porém fechados (Alfabetizadas + Não alfabetizadas = Total).

    A semente 1 tem zero não alfabetizadas de propósito: o zero sai serializado
    como "-", o marcador de zero verdadeiro do IBGE, e a taxa vira 100.0.
    """
    total = 4_000 * seed + 137
    non_literate = 0 if seed == 1 else 150 * seed + 37
    return {
        "Total": total,
        "Alfabetizadas": total - non_literate,
        "Não alfabetizadas": non_literate,
    }


def expected_rate(values: dict[str, int]) -> float:
    return round(values["Alfabetizadas"] / values["Total"] * 100, 1)


def serialize_value(value: int) -> str:
    return "-" if value == 0 else str(value)


def agregados_payload(
    localities: list[tuple[str, str, str]],
    values_by_code: dict[str, dict[str, int]],
    names: tuple[str, ...],
    variable_name: str,
) -> list[dict[str, Any]]:
    """Monta a lista de resultados no formato da API de agregados v3."""
    resultados = []
    for index, name in enumerate(names):
        resultados.append(
            {
                "classificacoes": [
                    {"id": 2, "nome": "Sexo", "categoria": {"6794": "Total"}},
                    {"id": 86, "nome": "Cor ou raça", "categoria": {"95251": "Total"}},
                    {"id": 287, "nome": "Idade", "categoria": {"100362": "Total"}},
                    {
                        "id": 59,
                        "nome": "Alfabetização",
                        "categoria": {str(93024 + index): name},
                    },
                ],
                "series": [
                    {
                        "localidade": {
                            "id": code,
                            "nivel": {
                                "id": level,
                                "nome": "Município" if level == "N6" else "Unidade da Federação",
                            },
                            "nome": locality_name,
                        },
                        "serie": {YEAR: serialize_value(values_by_code[code][name])},
                    }
                    for code, level, locality_name in localities
                    if name in values_by_code[code]
                ],
            }
        )
    return [
        {
            "id": 950,
            "variavel": variable_name,
            "unidade": "Pessoas",
            "resultados": resultados,
        }
    ]


def write_cache(
    cache_dir: Path,
    municipal_values: dict[str, dict[str, int]],
    state_values: dict[str, int],
    municipality_names: dict[str, str],
    municipal_codes: list[str],
    variable_name: str = VARIABLE_NAME,
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    state_payload = agregados_payload(
        [(STATE_CODE, "N3", "Goiás")],
        {STATE_CODE: state_values},
        CATEGORY_NAMES,
        variable_name,
    )
    municipal_payload = agregados_payload(
        [(code, "N6", municipality_names[code]) for code in municipal_codes],
        municipal_values,
        CATEGORY_NAMES,
        variable_name,
    )
    batches = []
    for file_name, level, codes, payload in (
        ("agregados_9542_state.json", "N3", [STATE_CODE], state_payload),
        ("agregados_9542_batch_001.json", "N6", municipal_codes, municipal_payload),
    ):
        raw = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
        (cache_dir / file_name).write_bytes(raw)
        batches.append(
            {
                "file": file_name,
                "url": (
                    "https://servicodados.ibge.gov.br/api/v3/agregados/9542/periodos/2022/"
                    f"variaveis/950?localidades={level}[{','.join(codes)}]"
                    "&classificacao=59[all]"
                ),
                "level": level,
                "localities": codes,
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    manifest = {
        "schemaVersion": 1,
        "apiVariant": "agregados",
        "aggregate": "9542",
        "variable": "950",
        "referenceYear": 2022,
        "retrievedAtUtc": RETRIEVED_AT,
        "notes": [SYNTHETIC_NOTE],
        "batches": batches,
    }
    (cache_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def check(output_file: Path, municipalities_plan: list[tuple[str, int]]) -> int:
    """Confere a saída do processamento contra os valores sintéticos esperados."""
    failures: list[str] = []
    payload = json.loads(output_file.read_text(encoding="utf-8"))
    metadata = payload.get("metadata", {})
    municipalities = payload.get("municipalities", {})

    if metadata.get("aggregate") != "9542" or metadata.get("variable") != "950":
        failures.append(
            f"metadado aponta agregado/variável errados: "
            f"{metadata.get('aggregate')}/{metadata.get('variable')} != 9542/950"
        )
    if metadata.get("municipalityCount") != len(municipalities_plan):
        failures.append(
            f"municipalityCount {metadata.get('municipalityCount')} != "
            f"{len(municipalities_plan)}"
        )

    state_literate = state_total = 0
    for code, seed in municipalities_plan:
        values = synthetic_values(seed)
        state_literate += values["Alfabetizadas"]
        state_total += values["Total"]
        record = municipalities.get(code)
        if record is None:
            failures.append(f"faltou o município {code} na saída")
            continue
        expected = {
            "literate15Plus": values["Alfabetizadas"],
            "population15Plus": values["Total"],
            "literacyRate": expected_rate(values),
        }
        if record != expected:
            failures.append(f"{code}: {record} != {expected}")
        # A taxa publicada tem de ser exatamente alfabetizados / população 15+.
        recomputed = round(record["literate15Plus"] / record["population15Plus"] * 100, 1)
        if record["literacyRate"] != recomputed:
            failures.append(
                f"{code}: literacyRate {record['literacyRate']} != recalculada {recomputed}"
            )

    expected_state = {
        "literate15Plus": state_literate,
        "population15Plus": state_total,
        "literacyRate": round(state_literate / state_total * 100, 1),
    }
    if metadata.get("stateTotals") != expected_state:
        failures.append(f"stateTotals: {metadata.get('stateTotals')} != {expected_state}")

    if failures:
        print("FALHOU:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    menor = synthetic_values(municipalities_plan[0][1])
    maior = synthetic_values(municipalities_plan[1][1])
    print("Fixture de alfabetização: valores e taxas conferem nos 2 municípios.")
    print(
        f"  {municipalities_plan[0][0]}: {menor['Alfabetizadas']}/{menor['Total']} "
        f"-> {expected_rate(menor)}% (zero não alfabetizadas via marcador '-')"
    )
    print(
        f"  {municipalities_plan[1][0]}: {maior['Alfabetizadas']}/{maior['Total']} "
        f"-> {expected_rate(maior)}%"
    )
    print(
        f"  Estado {STATE_CODE}: {state_literate}/{state_total} "
        f"-> {expected_state['literacyRate']}% (fechamento por soma, não média)"
    )
    return 0


def main() -> None:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--electorate-file",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
        help="Base eleitoral real de onde vêm códigos e nomes dos dois municípios.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root / "scripts" / "tests" / "fixtures" / "literacy",
        help="Diretório onde o fixture é gravado.",
    )
    parser.add_argument(
        "--check",
        type=Path,
        help="Em vez de gerar, confere o JSON de saída do processamento neste caminho.",
    )
    args = parser.parse_args()

    electorate = json.loads(args.electorate_file.read_text(encoding="utf-8"))
    municipalities_plan = pick_two_municipalities(electorate)

    if args.check:
        sys.exit(check(args.check.resolve(), municipalities_plan))

    codes = [code for code, _ in municipalities_plan]
    municipality_names: dict[str, str] = {}
    fixture_records: dict[str, Any] = {}
    for code in codes:
        record = electorate["municipalities"][code]
        municipality_names[code] = record["name"]
        fixture_records[code] = {
            "ibgeCode": record["ibgeCode"],
            "tseCode": record["tseCode"],
            "name": record["name"],
            "electorate": record["electorate"],
        }

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    electorate_fixture = {
        "metadata": {
            "state": "GO",
            "municipalityCount": len(codes),
            "source": SYNTHETIC_NOTE,
        },
        "municipalities": fixture_records,
    }
    (output_dir / "electorate-fixture.json").write_text(
        json.dumps(electorate_fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    municipal_values = {code: synthetic_values(seed) for code, seed in municipalities_plan}
    state_values = {
        name: sum(municipal_values[code][name] for code in codes)
        for name in CATEGORY_NAMES
    }

    write_cache(output_dir / "cache", municipal_values, state_values,
                municipality_names, codes)

    tampered = {code: dict(values) for code, values in municipal_values.items()}
    tampered[codes[0]]["Total"] += 500
    write_cache(output_dir / "cache-bad-sum", tampered, state_values,
                municipality_names, codes)

    write_cache(
        output_dir / "cache-missing-muni",
        municipal_values,
        state_values,
        municipality_names,
        codes[1:],  # a consulta municipal perde o primeiro município
    )

    write_cache(
        output_dir / "cache-wrong-age",
        municipal_values,
        state_values,
        municipality_names,
        codes,
        variable_name="Pessoas de 10 anos ou mais de idade",
    )

    print(f"Fixture sintético gravado em {output_dir}")
    for code in codes:
        values = municipal_values[code]
        print(
            f"  {code} {municipality_names[code]}: {values['Alfabetizadas']}/"
            f"{values['Total']} alfabetizadas (taxa {expected_rate(values)}%)"
        )
    print(
        f"  Estado {STATE_CODE}: {state_values['Alfabetizadas']}/{state_values['Total']} "
        f"(taxa {expected_rate(state_values)}%)"
    )
    print("  Caches: cache/, cache-bad-sum/, cache-missing-muni/, cache-wrong-age/")


if __name__ == "__main__":
    main()
