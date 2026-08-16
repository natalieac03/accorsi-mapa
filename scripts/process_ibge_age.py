#!/usr/bin/env python3
"""Gera a estrutura etária da população dos 246 municípios de Goiás (Censo 2022).

A fonte é a tabela 9514 do Censo Demográfico 2022 — "População residente, por
sexo, idade e forma de declaração da idade" —, variável 93 (População
residente), classificação de idade C287. O script aceita duas variantes de API:

1. API de agregados v3 (padrão, --api agregados):

       https://servicodados.ibge.gov.br/api/v3/agregados/9514/periodos/2022/
           variaveis/93?localidades=N6[4314902,...]&classificacao=287[all]

   Documentação: https://servicodados.ibge.gov.br/api/docs/agregados?versao=3

2. API SIDRA (--api sidra):

       https://apisidra.ibge.gov.br/values/t/9514/n6/4314902,.../v/93/p/2022/
           c287/all?formato=json

   Documentação: https://apisidra.ibge.gov.br/home/ajuda

Nas duas variantes as classificações não listadas (C2 Sexo e C286 Forma de
declaração da idade) devem voltar na categoria "Total"; por segurança o parser
também filtra pelo nome da categoria e descarta qualquer recorte que não seja
"Total" nessas dimensões.

PONTO METODOLÓGICO: as faixas quinquenais do Censo trazem "15 a 19 anos", que
mistura quem tem 15 anos (não vota) com 16 a 19. A C287 da tabela 9514 tem
idades simples, e é delas (15, 16, 17, 18 e 19 anos) que sai a população de
16+ EXATA. Se a resposta não trouxer as idades simples esperadas o script
FALHA explicando o problema; a aproximação de 3/5 da faixa 15-19 só existe
atrás da flag --allow-quinquennial-approximation e sai gritada no metadado.

Diferente do scripts/process_ibge.py, este script guarda a resposta bruta da
API: com --cache-dir cada lote vira um arquivo JSON em disco, com SHA-256
registrado num manifest.json e repetido no metadado da saída. Com --from-cache
ele processa do cache sem rede (verificando os hashes) — é assim que o teste
roda:

    python3 scripts/tests/age_fixture.py
    python3 scripts/process_ibge_age.py \
        --electorate-file scripts/tests/fixtures/age/electorate-fixture.json \
        --cache-dir scripts/tests/fixtures/age/cache \
        --from-cache \
        --expected-municipalities 2 \
        --output scripts/tests/fixtures/age/out/age-structure.json

Além da consulta municipal (N6, em lotes), o script consulta o total de Goiás
(N3[52]) e valida o fechamento estadual: a soma dos 246 municípios precisa
bater com o estado em todas as bandas. Por município valem dois fechamentos:
as bandas somam exatamente population16Plus, e 0-15 + 16+ = populationTotal.
Usa apenas a biblioteca padrão do Python.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import tempfile
import time
import unicodedata
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SCHEMA_VERSION = 1
STATE = "GO"
# Código IBGE (N3) da unidade federativa consultada. 52 é Goiás — 43 seria o
# Rio Grande do Sul, esquecido aqui na primeira geração do fork: a soma dos
# 246 municípios batia com Goiás, mas o total contra o qual ela era conferida
# vinha de outro estado inteiro, e o fechamento estourava sem dizer por quê.
STATE_IBGE_CODE = "52"
AGGREGATE = "9514"
VARIABLE = "93"
AGE_CLASSIFICATION = "287"
REFERENCE_YEAR = 2022
EXPECTED_MUNICIPALITIES = 246
API_VARIANTS = ("agregados", "sidra")
AGREGADOS_ROOT = "https://servicodados.ibge.gov.br/api/v3/agregados"
SIDRA_ROOT = "https://apisidra.ibge.gov.br/values"
SOURCE_NAME = "IBGE — Censo Demográfico 2022"
DATASET_NAME = "População residente por idade (Tabela 9514, variável 93)"
SOURCE_URLS = (
    "https://servicodados.ibge.gov.br/api/docs/agregados?versao=3",
    "https://apisidra.ibge.gov.br/home/ajuda",
)
MANIFEST_NAME = "manifest.json"
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2.0
BATCH_PAUSE_SECONDS = 0.3
BAND_KEYS = ("a16to17", "a18to24", "a25to39", "a40to59", "a60plus")

# Convenção SIDRA/agregados: "-" é zero verdadeiro; os demais marcam ausência.
ZERO_MARKER = "-"
MISSING_MARKERS = {"..", "...", "X"}

AGE_OPEN_RE = re.compile(r"(\d+) anos? ou mais")
AGE_BAND_RE = re.compile(r"(\d+) a (\d+) anos")
AGE_SIMPLE_RE = re.compile(r"(\d+) anos?")

METHOD_NOTE = (
    "A faixa quinquenal '15 a 19 anos' mistura quem tem 15 anos (não vota) com quem tem "
    "16 a 19; sem as idades simples de 15 a 19 da C287 não há como calcular a população de "
    "16+ com exatidão. Confira se a consulta trouxe as idades simples da tabela 9514 "
    "(classificacao=287[all]) ou, em último caso, rode com "
    "--allow-quinquennial-approximation para aceitar a aproximação de 3/5, que sai "
    "declarada em alerta no metadado."
)


class CoverageError(RuntimeError):
    """Nenhuma categoria de idade cobre o ponto pedido da faixa alvo."""

    def __init__(self, label: str, cursor: int, lo: int, hi: int | None, entry: dict[str, Any]):
        if hi is None:
            target = f"{lo} anos ou mais"
        elif hi == lo:
            target = f"{lo} anos (idade simples)"
        else:
            target = f"{lo} a {hi} anos"
        super().__init__(
            f"{label}: não há categoria de idade cobrindo {cursor} anos ao montar a faixa "
            f"{target}. Categorias reconhecidas: {describe_categories(entry)}."
        )
        self.cursor = cursor


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Gera a estrutura etária municipal de Goiás (Censo 2022, tabela 9514).",
    )
    parser.add_argument(
        "--electorate-file",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
        help="JSON eleitoral validado que fornece os códigos IBGE dos municípios.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "src" / "data" / "age-structure-go.json",
        help="Destino do JSON validado (padrão: src/data/age-structure-go.json).",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help=(
            "Diretório onde as respostas brutas da API são gravadas com SHA-256 "
            "registrado em manifest.json. Recomendado sempre; obrigatório com --from-cache."
        ),
    )
    parser.add_argument(
        "--from-cache",
        action="store_true",
        help="Processa do cache (--cache-dir) sem rede, verificando os SHA-256.",
    )
    parser.add_argument(
        "--api",
        choices=API_VARIANTS,
        default="agregados",
        help="Variante de API do IBGE. Com --from-cache vale a variante do manifesto.",
    )
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument(
        "--expected-municipalities",
        type=int,
        default=EXPECTED_MUNICIPALITIES,
        help=(
            "Cobertura municipal esperada. Só mude para rodar sobre o fixture "
            "sintético de testes; a produção usa 246."
        ),
    )
    parser.add_argument(
        "--allow-quinquennial-approximation",
        action="store_true",
        help=(
            "ÚLTIMO RECURSO: se as idades simples 15-19 faltarem, aproxima 16-17 e 18-19 "
            "como 2/5 da faixa '15 a 19 anos' cada, com alerta gritante no metadado."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Valida e resume sem gravar a saída (o cache, se pedido, é gravado).",
    )
    return parser.parse_args()


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(stripped.lower().split())


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def compact_ranges(values: list[int]) -> str:
    parts: list[str] = []
    start = previous = values[0]
    for value in values[1:]:
        if value == previous + 1:
            previous = value
            continue
        parts.append(str(start) if start == previous else f"{start}-{previous}")
        start = previous = value
    parts.append(str(start) if start == previous else f"{start}-{previous}")
    return ", ".join(parts)


def describe_categories(entry: dict[str, Any]) -> str:
    parts: list[str] = []
    if entry["total"] is not None:
        parts.append("total")
    if entry["simple"]:
        parts.append("idades simples " + compact_ranges(sorted(entry["simple"])))
    if entry["bands"]:
        parts.append("faixas " + ", ".join(f"{lo}-{hi}" for lo, hi in sorted(entry["bands"])))
    if entry["open"]:
        parts.append("abertas " + ", ".join(f"{lo}+" for lo in sorted(entry["open"])))
    return "; ".join(parts) or "nenhuma"


def load_municipalities(path: Path, expected: int) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    metadata = payload.get("metadata", {})
    records = payload.get("municipalities")
    if (
        metadata.get("state") != STATE
        or metadata.get("municipalityCount") != expected
        or not isinstance(records, dict)
        or len(records) != expected
    ):
        raise SystemExit(
            f"A base eleitoral {path} não contém o recorte validado de {expected} "
            f"municípios do {STATE}."
        )
    result: dict[str, str] = {}
    for key, record in records.items():
        code = str(record.get("ibgeCode", "")) if isinstance(record, dict) else ""
        name = str(record.get("name", "")).strip() if isinstance(record, dict) else ""
        if code != key or len(code) != 7 or not code.isdigit() or not name:
            raise SystemExit(f"Código ou nome municipal inválido na base eleitoral: {key}.")
        result[code] = name
    return result


def build_url(api: str, level: str, codes: list[str]) -> str:
    joined = ",".join(codes)
    if api == "agregados":
        return (
            f"{AGREGADOS_ROOT}/{AGGREGATE}/periodos/{REFERENCE_YEAR}/variaveis/{VARIABLE}"
            f"?localidades={level}[{joined}]&classificacao={AGE_CLASSIFICATION}[all]"
        )
    return (
        f"{SIDRA_ROOT}/t/{AGGREGATE}/{level.lower()}/{joined}/v/{VARIABLE}"
        f"/p/{REFERENCE_YEAR}/c{AGE_CLASSIFICATION}/all?formato=json"
    )


def http_get(url: str, timeout: int) -> bytes:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "ACCORSI-Mapa/1.0 (estrutura etaria; dados publicos agregados)",
        },
    )
    last_error: Exception | None = None
    for attempt in range(RETRY_ATTEMPTS):
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read()
            if raw.startswith(b"\x1f\x8b"):
                raw = gzip.decompress(raw)
            return raw
        except HTTPError as error:
            body = error.read()[:1000].decode("utf-8", "replace")
            last_error = RuntimeError(f"HTTP {error.code} em {url}; corpo da resposta: {body!r}")
        except (URLError, TimeoutError, OSError) as error:
            last_error = RuntimeError(f"Falha de rede em {url}: {error}")
        if attempt < RETRY_ATTEMPTS - 1:
            time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
    raise RuntimeError(f"Falha após {RETRY_ATTEMPTS} tentativas: {last_error}")


def decode_json(raw: bytes, label: str) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        snippet = raw[:500].decode("utf-8", "replace")
        raise RuntimeError(
            f"{label}: a resposta não é JSON válido ({error}); início do corpo: {snippet!r}"
        ) from error


def write_bytes_atomic(raw: bytes, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", dir=output.parent, delete=False) as temporary:
        temporary.write(raw)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, output)


def write_json_atomic(payload: dict[str, Any], output: Path) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    write_bytes_atomic(serialized.encode("utf-8"), output)


def fetch_all(
    codes: list[str],
    api: str,
    batch_size: int,
    timeout: int,
    cache_dir: Path | None,
) -> tuple[dict[str, Any], list[tuple[dict[str, Any], Any]]]:
    """Consulta o estado (N3) e os municípios (N6) em lotes; devolve manifesto e payloads."""
    if not 1 <= batch_size <= 100:
        raise SystemExit("--batch-size deve estar entre 1 e 100.")
    plan: list[tuple[str, str, list[str]]] = [("state", "N3", [STATE_IBGE_CODE])]
    plan += [
        (f"batch_{index // batch_size + 1:03d}", "N6", codes[index : index + batch_size])
        for index in range(0, len(codes), batch_size)
    ]

    batches: list[dict[str, Any]] = []
    payloads: list[tuple[dict[str, Any], Any]] = []
    for position, (name, level, chunk) in enumerate(plan):
        url = build_url(api, level, chunk)
        raw = http_get(url, timeout)
        file_name = f"{api}_{AGGREGATE}_{name}.json"
        entry = {
            "file": file_name,
            "url": url,
            "level": level,
            "localities": chunk,
            "sha256": sha256_bytes(raw),
        }
        payloads.append((entry, decode_json(raw, file_name)))
        batches.append(entry)
        if cache_dir is not None:
            write_bytes_atomic(raw, cache_dir / file_name)
        if position < len(plan) - 1:
            time.sleep(BATCH_PAUSE_SECONDS)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "apiVariant": api,
        "aggregate": AGGREGATE,
        "variable": VARIABLE,
        "referenceYear": REFERENCE_YEAR,
        "retrievedAtUtc": datetime.now(UTC).isoformat(timespec="seconds"),
        "notes": [],
        "batches": batches,
    }
    if cache_dir is not None:
        write_json_atomic(manifest, cache_dir / MANIFEST_NAME)
    return manifest, payloads


def load_from_cache(cache_dir: Path) -> tuple[dict[str, Any], list[tuple[dict[str, Any], Any]]]:
    manifest_path = cache_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        raise SystemExit(f"Manifesto do cache não encontrado: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        manifest.get("aggregate") != AGGREGATE
        or manifest.get("apiVariant") not in API_VARIANTS
        or not isinstance(manifest.get("batches"), list)
        or not manifest["batches"]
    ):
        raise SystemExit(f"Manifesto de cache inválido ou de outro agregado: {manifest_path}")

    payloads: list[tuple[dict[str, Any], Any]] = []
    for entry in manifest["batches"]:
        file_path = cache_dir / str(entry.get("file", ""))
        if not file_path.is_file():
            raise SystemExit(f"Arquivo do cache ausente: {file_path}")
        raw = file_path.read_bytes()
        digest = sha256_bytes(raw)
        if digest != entry.get("sha256"):
            raise SystemExit(
                f"SHA-256 divergente em {file_path}: manifesto {entry.get('sha256')}, "
                f"arquivo {digest}. O cache foi alterado; baixe de novo sem --from-cache."
            )
        payloads.append((entry, decode_json(raw, file_path.name)))
    return manifest, payloads


def new_entry() -> dict[str, Any]:
    return {"total": None, "simple": {}, "bands": {}, "open": {}, "other": set()}


def parse_age_category(name: str) -> tuple[str, Any] | None:
    text = normalize(name)
    if text == "total":
        return ("total", None)
    if text in {"menos de 1 ano", "menos de um ano"}:
        return ("simple", 0)
    if match := AGE_OPEN_RE.fullmatch(text):
        return ("open", int(match.group(1)))
    if match := AGE_BAND_RE.fullmatch(text):
        lo, hi = int(match.group(1)), int(match.group(2))
        return ("band", (lo, hi)) if lo <= hi else None
    if match := AGE_SIMPLE_RE.fullmatch(text):
        return ("simple", int(match.group(1)))
    return None


def parse_value(raw: object, label: str, context: str) -> int | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if text == ZERO_MARKER:
        return 0
    if not text or text in MISSING_MARKERS:
        return None
    try:
        number = int(text)
    except ValueError as error:
        raise RuntimeError(f"{label}: valor não inteiro para {context}: {text!r}.") from error
    if number < 0:
        raise RuntimeError(f"{label}: valor negativo para {context}: {number}.")
    return number


def record_value(
    entries: dict[str, dict[str, Any]],
    code: str,
    age_name: str,
    value: int,
    label: str,
) -> None:
    entry = entries.setdefault(code, new_entry())
    category = parse_age_category(age_name)
    if category is None:
        entry["other"].add(age_name)
        return
    kind, key = category
    if kind == "total":
        if entry["total"] is not None and entry["total"] != value:
            raise RuntimeError(f"{label}: categoria 'Total' duplicada e divergente em {code}.")
        entry["total"] = value
        return
    mapping = entry["bands"] if kind == "band" else entry[kind]
    if key in mapping and mapping[key] != value:
        raise RuntimeError(
            f"{label}: categoria {age_name!r} duplicada com valores divergentes em {code}."
        )
    mapping[key] = value


def parse_agregados(payload: Any, label: str, entries: dict[str, dict[str, Any]]) -> None:
    if not isinstance(payload, list) or not payload:
        raise RuntimeError(
            f"{label}: resposta da API de agregados não é uma lista com resultados; "
            f"recebido: {json.dumps(payload, ensure_ascii=False)[:300]!r}"
        )
    for variable in payload:
        if str(variable.get("id")) != VARIABLE:
            continue
        for resultado in variable.get("resultados", []):
            age_name: str | None = None
            others_total = True
            for classification in resultado.get("classificacoes", []):
                names = list(classification.get("categoria", {}).values())
                if len(names) != 1:
                    raise RuntimeError(
                        f"{label}: classificação com {len(names)} categorias num mesmo "
                        "resultado; esperada exatamente uma."
                    )
                if str(classification.get("id")) == AGE_CLASSIFICATION:
                    age_name = str(names[0])
                elif normalize(str(names[0])) != "total":
                    others_total = False
            if age_name is None:
                raise RuntimeError(
                    f"{label}: resultado sem a classificação de idade (C{AGE_CLASSIFICATION})."
                )
            if not others_total:
                continue
            for serie in resultado.get("series", []):
                code = str(serie.get("localidade", {}).get("id", "")).strip()
                value = parse_value(
                    serie.get("serie", {}).get(str(REFERENCE_YEAR)),
                    label,
                    f"{age_name!r} em {code}",
                )
                if code and value is not None:
                    record_value(entries, code, age_name, value, label)


def parse_sidra(payload: Any, label: str, entries: dict[str, dict[str, Any]]) -> None:
    if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[0], dict):
        raise RuntimeError(
            f"{label}: resposta do SIDRA não tem cabeçalho e linhas; recebido: "
            f"{json.dumps(payload, ensure_ascii=False)[:300]!r}"
        )
    header = payload[0]
    locality_key = age_name_key = variable_key = period_key = None
    other_name_keys: list[str] = []
    for key, raw_label in header.items():
        if not re.fullmatch(r"D\d+C", key):
            continue
        base = normalize(str(raw_label)).split(" (")[0]
        if base in {"municipio", "unidade da federacao"}:
            locality_key = key
        elif base == "idade":
            age_name_key = key[:-1] + "N"
        elif base == "variavel":
            variable_key = key
        elif base in {"ano", "trimestre", "mes"}:
            period_key = key
        else:
            other_name_keys.append(key[:-1] + "N")
    if locality_key is None or age_name_key is None:
        raise RuntimeError(
            f"{label}: cabeçalho do SIDRA sem dimensão de localidade ou de idade; "
            f"cabeçalho: {json.dumps(header, ensure_ascii=False)[:500]}"
        )
    for row in payload[1:]:
        if variable_key and str(row.get(variable_key)) != VARIABLE:
            continue
        if period_key and str(row.get(period_key)) != str(REFERENCE_YEAR):
            continue
        if any(normalize(str(row.get(key, ""))) != "total" for key in other_name_keys):
            continue
        code = str(row.get(locality_key, "")).strip()
        age_name = str(row.get(age_name_key, ""))
        value = parse_value(row.get("V"), label, f"{age_name!r} em {code}")
        if code and value is not None:
            record_value(entries, code, age_name, value, label)


def parse_batches(
    api: str, payloads: list[tuple[dict[str, Any], Any]]
) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    parser = parse_agregados if api == "agregados" else parse_sidra
    for meta, payload in payloads:
        parser(payload, str(meta.get("file", "lote sem nome")), entries)
    if not entries:
        raise RuntimeError("Nenhuma localidade foi extraída das respostas da API.")
    return entries


def sum_range(entry: dict[str, Any], lo: int, hi: int | None, label: str) -> int:
    """Soma categorias de idade cobrindo [lo, hi] sem lacunas nem sobreposição.

    Prefere a faixa que começa no cursor (a mais curta que caiba), depois a idade
    simples; hi=None fecha numa categoria aberta ("N anos ou mais") exatamente
    no cursor. Funciona tanto com quinquenais + idades simples quanto só com
    idades simples.
    """
    cursor, total = lo, 0
    while True:
        if hi is not None and cursor > hi:
            return total
        if hi is None and cursor in entry["open"]:
            return total + entry["open"][cursor]
        fitting = [
            band_hi
            for band_lo, band_hi in entry["bands"]
            if band_lo == cursor and (hi is None or band_hi <= hi)
        ]
        if fitting:
            band_hi = min(fitting)
            total += entry["bands"][(cursor, band_hi)]
            cursor = band_hi + 1
        elif cursor in entry["simple"]:
            total += entry["simple"][cursor]
            cursor += 1
        else:
            raise CoverageError(label, cursor, lo, hi, entry)


def derive_locality(
    entry: dict[str, Any], label: str, allow_approximation: bool
) -> tuple[dict[str, Any], bool]:
    """Deriva total, 16+ e bandas de uma localidade; devolve (registro, aproximado?)."""
    total = entry["total"]
    if total is None:
        raise RuntimeError(f"{label}: sem a categoria 'Total' da classificação de idade.")

    approximated = False
    try:
        age15 = sum_range(entry, 15, 15, label)
        a16to17 = sum_range(entry, 16, 17, label)
        a18to19 = sum_range(entry, 18, 19, label)
    except CoverageError as error:
        band = entry["bands"].get((15, 19))
        has_any_simple = any(age in entry["simple"] for age in range(15, 20))
        if band is None or has_any_simple or not allow_approximation:
            raise RuntimeError(f"{error} {METHOD_NOTE}") from error
        # Aproximação declarada: 2/5 da faixa para 16-17 e para 18-19; o resto é 15.
        a16to17 = (2 * band) // 5
        a18to19 = (2 * band) // 5
        age15 = band - a16to17 - a18to19
        approximated = True

    if not approximated and (15, 19) in entry["bands"]:
        expected = age15 + a16to17 + a18to19
        found = entry["bands"][(15, 19)]
        if found != expected:
            raise RuntimeError(
                f"{label}: a faixa '15 a 19 anos' ({found}) difere da soma das idades "
                f"simples 15-19 ({expected}); a fonte está inconsistente."
            )

    bands = {
        "a16to17": a16to17,
        "a18to24": a18to19 + sum_range(entry, 20, 24, label),
        "a25to39": sum_range(entry, 25, 39, label),
        "a40to59": sum_range(entry, 40, 59, label),
        "a60plus": sum_range(entry, 60, None, label),
    }
    population_16_plus = sum(bands.values())
    a0to15 = sum_range(entry, 0, 14, label) + age15
    if a0to15 + population_16_plus != total:
        raise RuntimeError(
            f"{label}: fechamento municipal falhou: 0-15 ({a0to15}) + 16+ "
            f"({population_16_plus}) = {a0to15 + population_16_plus}, mas o total é {total}."
        )
    record = {
        "populationTotal": total,
        "population16Plus": population_16_plus,
        "bands": bands,
    }
    return record, approximated


def validate_band_closure(code: str, record: dict[str, Any]) -> None:
    values = [record["populationTotal"], record["population16Plus"], *record["bands"].values()]
    if any(value < 0 for value in values):
        raise RuntimeError(f"Valor negativo na saída de {code}.")
    band_sum = sum(record["bands"].values())
    if band_sum != record["population16Plus"]:
        raise RuntimeError(
            f"Fechamento das bandas falhou em {code}: soma {band_sum}, "
            f"population16Plus {record['population16Plus']}."
        )


def check_state_closure(
    state_record: dict[str, Any],
    records: dict[str, dict[str, Any]],
    slack_units: int,
) -> list[tuple[str, int, int, int]]:
    """Compara a soma municipal com o estado; devolve (campo, soma, estado, folga)."""
    checks: list[tuple[str, int, int, int]] = []
    approx_fields = {"population16Plus": 2 * slack_units, "a16to17": slack_units,
                     "a18to24": slack_units}
    fields: list[tuple[str, int, int]] = [
        ("populationTotal", sum(r["populationTotal"] for r in records.values()),
         state_record["populationTotal"]),
        ("population16Plus", sum(r["population16Plus"] for r in records.values()),
         state_record["population16Plus"]),
    ]
    fields += [
        (key, sum(r["bands"][key] for r in records.values()), state_record["bands"][key])
        for key in BAND_KEYS
    ]
    for field, municipal_sum, state_value in fields:
        allowed = approx_fields.get(field, 0) if slack_units else 0
        if abs(municipal_sum - state_value) > allowed:
            raise RuntimeError(
                f"Fechamento estadual falhou em {field}: soma municipal {municipal_sum}, "
                f"{STATE} {state_value} (folga permitida {allowed})."
            )
        checks.append((field, municipal_sum, state_value, allowed))
    return checks


def build_payload(
    records: dict[str, dict[str, Any]],
    state_record: dict[str, Any],
    manifest: dict[str, Any],
    cache_dir: Path | None,
    approximated_codes: list[str],
    state_approximated: bool,
) -> dict[str, Any]:
    notes = [
        "População residente. O eleitorado pode exceder a população 16+ em municípios "
        "com títulos não transferidos.",
        "population16Plus usa as idades simples 15-19 da C287 para separar 15 anos "
        "(não vota) de 16 a 19.",
    ]
    notes.extend(str(note) for note in manifest.get("notes", []))
    approximation: dict[str, Any] | None = None
    if approximated_codes or state_approximated:
        warning = (
            "ATENÇÃO — APROXIMAÇÃO QUINQUENAL: as idades simples 15-19 não estavam na "
            "resposta e 16-17/18-19 foram aproximadas como 2/5 da faixa '15 a 19 anos' "
            "cada. Os fechamentos estaduais de 16+, a16to17 e a18to24 valem com folga de "
            "arredondamento. NÃO use este arquivo como população apta exata."
        )
        notes.append(warning)
        approximation = {
            "enabled": True,
            "municipalityCodes": approximated_codes,
            "stateApproximated": state_approximated,
            "warning": warning,
        }
    return {
        "metadata": {
            "schemaVersion": SCHEMA_VERSION,
            "state": STATE,
            "source": SOURCE_NAME,
            "dataset": DATASET_NAME,
            "aggregate": AGGREGATE,
            "variable": VARIABLE,
            "apiVariant": manifest["apiVariant"],
            "sourceUrls": list(SOURCE_URLS),
            "referenceYear": REFERENCE_YEAR,
            "retrievedAtUtc": manifest.get("retrievedAtUtc"),
            "processedAtUtc": datetime.now(UTC).isoformat(timespec="seconds"),
            "municipalityCount": len(records),
            "stateTotals": state_record,
            "rawResponseSha256": {
                str(entry["file"]): str(entry["sha256"]) for entry in manifest["batches"]
            },
            "cacheDir": str(cache_dir) if cache_dir is not None else None,
            "quinquennialApproximation": approximation,
            "notes": notes,
        },
        "municipalities": {code: records[code] for code in sorted(records)},
    }


def main() -> None:
    args = parse_args()
    if args.from_cache and args.cache_dir is None:
        raise SystemExit("--from-cache exige --cache-dir apontando para o cache gravado.")
    cache_dir = args.cache_dir.resolve() if args.cache_dir is not None else None
    municipality_names = load_municipalities(
        args.electorate_file.resolve(), args.expected_municipalities
    )

    if args.from_cache:
        manifest, payloads = load_from_cache(cache_dir)
        api = str(manifest["apiVariant"])
        if api != args.api:
            print(f"Nota: o cache foi gravado pela variante '{api}'; é ela que vale.")
    else:
        api = args.api
        manifest, payloads = fetch_all(
            sorted(municipality_names), api, args.batch_size, args.timeout, cache_dir
        )
        if cache_dir is None:
            print(
                "ALERTA: rodando sem --cache-dir; a resposta bruta não ficou em disco "
                "e só os SHA-256 do metadado permitem auditoria."
            )

    entries = parse_batches(api, payloads)
    state_entry = entries.pop(STATE_IBGE_CODE, None)
    if state_entry is None:
        raise SystemExit(
            f"A consulta estadual (N3[{STATE_IBGE_CODE}]) não veio na resposta; sem ela "
            "não há fechamento estadual."
        )
    missing = sorted(set(municipality_names) - set(entries))
    if missing:
        raise SystemExit(
            f"{len(missing)} municípios sem dados na resposta do IBGE (o Censo cobre "
            f"todos): {', '.join(missing[:10])}{'…' if len(missing) > 10 else ''}"
        )
    unexpected = sorted(set(entries) - set(municipality_names))
    if unexpected:
        raise SystemExit(
            f"Localidades fora da base eleitoral na resposta: {', '.join(unexpected[:10])}"
        )

    unrecognized = sorted({name for entry in entries.values() for name in entry["other"]})
    if unrecognized:
        print(
            f"ALERTA: {len(unrecognized)} nomes de categoria de idade não reconhecidos "
            f"foram ignorados: {', '.join(unrecognized[:10])}"
        )

    approximated_codes: list[str] = []
    records: dict[str, dict[str, Any]] = {}
    for code in sorted(entries):
        label = f"município {code} ({municipality_names[code]})"
        record, approximated = derive_locality(
            entries[code], label, args.allow_quinquennial_approximation
        )
        records[code] = record
        if approximated:
            approximated_codes.append(code)
    state_record, state_approximated = derive_locality(
        state_entry, f"{STATE} (N3 {STATE_IBGE_CODE})", args.allow_quinquennial_approximation
    )

    for code, record in records.items():
        validate_band_closure(code, record)
    validate_band_closure(STATE, state_record)
    slack_units = len(approximated_codes) + (1 if state_approximated else 0)
    state_checks = check_state_closure(state_record, records, slack_units)

    payload = build_payload(
        records, state_record, manifest, cache_dir, approximated_codes, state_approximated
    )

    total = state_record["populationTotal"]
    p16 = state_record["population16Plus"]
    print(
        f"Estrutura etária do {STATE}: {len(records)} municípios · variante '{api}' · "
        f"{len(manifest['batches'])} lotes"
    )
    print(f"{STATE}: população {total:,} · 16+ {p16:,} ({p16 / total * 100:.2f}%)")
    print(
        "Bandas do estado: "
        + " · ".join(f"{key}={state_record['bands'][key]:,}" for key in BAND_KEYS)
    )
    print(f"Fechamento 1 (bandas == population16Plus): OK nos {len(records)} municípios.")
    print(f"Fechamento 2 (0-15 + 16+ == total): OK nos {len(records)} municípios.")
    print("Fechamento estadual (soma municipal vs. estado):")
    for field, municipal_sum, state_value, allowed in state_checks:
        slack = f" (folga {allowed})" if allowed else ""
        print(f"  {field}: {municipal_sum:,} == {state_value:,}{slack}")
    if approximated_codes or state_approximated:
        print(
            f"ATENÇÃO: APROXIMAÇÃO QUINQUENAL usada em {len(approximated_codes)} "
            "municípios (idades simples 15-19 ausentes). O metadado carrega o alerta; "
            "NÃO trate 16+ como exato."
        )

    if args.dry_run:
        print(f"Execução em modo --dry-run; nada foi gravado em {args.output.resolve()}.")
        return
    write_json_atomic(payload, args.output.resolve())
    print(f"JSON gerado: {args.output.resolve()}")


if __name__ == "__main__":
    main()
