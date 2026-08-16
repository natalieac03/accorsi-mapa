#!/usr/bin/env python3
"""Gera um cache SINTÉTICO no formato da API de agregados v3 do IBGE (tabela 9514).

Nada aqui é dado oficial: todos os valores populacionais são inventados para
exercitar o scripts/process_ibge_age.py sem rede. Só os códigos IBGE e os nomes
dos dois municípios vêm de src/data/electorate-go.json, para que a validação da
base eleitoral continue valendo — e são ESCOLHIDOS NO MOMENTO (o de menor e o
de maior eleitorado), nunca fixados de antemão: um código fixo corre o risco de
não existir mais na base real quando ela mudar, e foi exatamente isso que
aconteceu quando este fixture ainda carregava dois municípios do Rio Grande do
Sul, herdados do projeto original — o script falhava com "município ausente"
sem dizer que a causa era o fixture, não o processamento.

O fixture reproduz a estrutura de resposta da API de agregados v3 (variável 93,
classificação C287 com uma categoria por "resultado" e as localidades em
"series") e cobre, de propósito, os casos que o processamento precisa tratar:

* idades simples de "Menos de 1 ano" a "19 anos" e faixas quinquenais de
  "0 a 4 anos" a "95 a 99 anos" + "100 anos ou mais" + "Total", consistentes
  entre si (as faixas 0-19 são a soma das idades simples correspondentes);
* uma consulta estadual (N3, código 52 — Goiás) cujos valores são a soma dos
  dois municípios, para o fechamento estadual;
* o marcador "-" do IBGE para zero verdadeiro (95 a 99 anos do município de
  menor eleitorado);
* um manifest.json com SHA-256 de cada arquivo, como o script grava.

Além do cache bom, saem três variantes de falha:

* cache-missing-simple/: sem as idades simples 15-19 (o script deve falhar
  explicando o problema metodológico do 16+; com
  --allow-quinquennial-approximation deve passar com alerta gritante);
* cache-bad-sum/: o "Total" do município de menor eleitorado foi adulterado
  (+1000) e o fechamento municipal 0-15 + 16+ == total deve falhar;
* cache-missing-muni/: a consulta municipal não traz esse município (município
  faltante deve ser falha, o Censo cobre todos).

Uso:

    python3 scripts/tests/age_fixture.py
    python3 scripts/process_ibge_age.py \
        --electorate-file scripts/tests/fixtures/age/electorate-fixture.json \
        --cache-dir scripts/tests/fixtures/age/cache \
        --from-cache \
        --expected-municipalities 2 \
        --output scripts/tests/fixtures/age/out/age-structure.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

STATE_CODE = "52"  # Goiás. NUNCA hardcode dois municípios específicos aqui em
# baixo — veja pick_two_municipalities: o código do estado pode ficar fixo
# porque é o mesmo em qualquer base GO, mas município específico não.
YEAR = "2022"
RETRIEVED_AT = "2026-08-15T00:00:00+00:00"
SYNTHETIC_NOTE = (
    "FIXTURE SINTÉTICO: valores populacionais inventados por "
    "scripts/tests/age_fixture.py; apenas códigos e nomes municipais são reais."
)


def pick_two_municipalities(electorate: dict[str, Any]) -> list[tuple[str, int]]:
    """O de menor e o de maior eleitorado da base real, com semente 1 e 6.

    Nunca dois códigos fixos: uma base real muda de município para município
    entre gerações (fusão, nome corrigido, o que for), e um código fixo que
    deixa de existir vira uma falha do FIXTURE disfarçada de falha do
    processamento — foi o que aconteceu com os dois municípios do Rio Grande
    do Sul que ficaram aqui, esquecidos, depois do fork para Goiás.
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


def simple_age_name(age: int) -> str:
    if age == 0:
        return "Menos de 1 ano"
    return "1 ano" if age == 1 else f"{age} anos"


def category_names() -> list[str]:
    names = ["Total"]
    names += [simple_age_name(age) for age in range(20)]
    names += [f"{lo} a {lo + 4} anos" for lo in range(0, 100, 5)]
    names.append("100 anos ou mais")
    return names


def synthetic_values(seed: int) -> dict[str, int]:
    """Valores inventados, porém internamente consistentes (faixas 0-19 = idades)."""
    simple = {age: 40 * seed + 7 * age + 13 for age in range(20)}
    values = {simple_age_name(age): count for age, count in simple.items()}
    for lo in range(0, 20, 5):
        values[f"{lo} a {lo + 4} anos"] = sum(simple[age] for age in range(lo, lo + 5))
    for lo in range(20, 100, 5):
        values[f"{lo} a {lo + 4} anos"] = seed * (110 - lo)
    if seed == 1:
        values["95 a 99 anos"] = 0  # sai como "-", o marcador de zero do IBGE
    values["100 anos ou mais"] = seed
    values["Total"] = (
        sum(values[f"{lo} a {lo + 4} anos"] for lo in range(0, 100, 5))
        + values["100 anos ou mais"]
    )
    return values


def serialize_value(value: int) -> str:
    return "-" if value == 0 else str(value)


def agregados_payload(
    localities: list[tuple[str, str, str]],
    values_by_code: dict[str, dict[str, int]],
    names: list[str],
) -> list[dict[str, Any]]:
    """Monta a lista de resultados no formato da API de agregados v3."""
    resultados = []
    for index, name in enumerate(names):
        resultados.append(
            {
                "classificacoes": [
                    {"id": 2, "nome": "Sexo", "categoria": {"6794": "Total"}},
                    {
                        "id": 286,
                        "nome": "Forma de declaração da idade",
                        "categoria": {"113635": "Total"},
                    },
                    {"id": 287, "nome": "Idade", "categoria": {str(93000 + index): name}},
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
            "id": 93,
            "variavel": "População residente",
            "unidade": "Pessoas",
            "resultados": resultados,
        }
    ]


def write_cache(
    cache_dir: Path,
    municipal_values: dict[str, dict[str, int]],
    state_values: dict[str, int],
    municipality_names: dict[str, str],
    names: list[str],
    municipal_codes: list[str],
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    state_payload = agregados_payload(
        [(STATE_CODE, "N3", "Goiás")], {STATE_CODE: state_values}, names
    )
    municipal_payload = agregados_payload(
        [(code, "N6", municipality_names[code]) for code in municipal_codes],
        municipal_values,
        names,
    )
    batches = []
    for file_name, level, codes, payload in (
        ("agregados_9514_state.json", "N3", [STATE_CODE], state_payload),
        ("agregados_9514_batch_001.json", "N6", municipal_codes, municipal_payload),
    ):
        raw = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
        (cache_dir / file_name).write_bytes(raw)
        batches.append(
            {
                "file": file_name,
                "url": (
                    "https://servicodados.ibge.gov.br/api/v3/agregados/9514/periodos/2022/"
                    f"variaveis/93?localidades={level}[{','.join(codes)}]"
                    "&classificacao=287[all]"
                ),
                "level": level,
                "localities": codes,
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    manifest = {
        "schemaVersion": 1,
        "apiVariant": "agregados",
        "aggregate": "9514",
        "variable": "93",
        "referenceYear": 2022,
        "retrievedAtUtc": RETRIEVED_AT,
        "notes": [SYNTHETIC_NOTE],
        "batches": batches,
    }
    (cache_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


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
        default=project_root / "scripts" / "tests" / "fixtures" / "age",
        help="Diretório onde o fixture é gravado.",
    )
    args = parser.parse_args()

    electorate = json.loads(args.electorate_file.read_text(encoding="utf-8"))
    municipalities_plan = pick_two_municipalities(electorate)
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

    names = category_names()
    municipal_values = {code: synthetic_values(seed) for code, seed in municipalities_plan}
    state_values = {
        name: sum(municipal_values[code][name] for code in codes) for name in names
    }

    write_cache(
        output_dir / "cache", municipal_values, state_values, municipality_names, names, codes
    )

    simple_15_19 = {simple_age_name(age) for age in range(15, 20)}
    trimmed_names = [name for name in names if name not in simple_15_19]
    trimmed_municipal = {
        code: {name: value for name, value in values.items() if name not in simple_15_19}
        for code, values in municipal_values.items()
    }
    trimmed_state = {
        name: value for name, value in state_values.items() if name not in simple_15_19
    }
    write_cache(
        output_dir / "cache-missing-simple",
        trimmed_municipal,
        trimmed_state,
        municipality_names,
        trimmed_names,
        codes,
    )

    tampered = {code: dict(values) for code, values in municipal_values.items()}
    tampered[codes[0]]["Total"] += 1000
    write_cache(
        output_dir / "cache-bad-sum", tampered, state_values, municipality_names, names, codes
    )

    write_cache(
        output_dir / "cache-missing-muni",
        municipal_values,
        state_values,
        municipality_names,
        names,
        codes[1:],  # a consulta municipal perde o primeiro município
    )

    print(f"Fixture sintético gravado em {output_dir}")
    for code in codes:
        total = municipal_values[code]["Total"]
        print(f"  {code} {municipality_names[code]}: população sintética {total:,}")
    print(f"  Estado {STATE_CODE}: população sintética {state_values['Total']:,}")
    print("  Caches: cache/, cache-missing-simple/, cache-bad-sum/, cache-missing-muni/")


if __name__ == "__main__":
    main()
