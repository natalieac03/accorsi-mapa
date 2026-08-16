#!/usr/bin/env python3
"""Gera a alfabetização das pessoas de 15 anos ou mais dos 246 municípios de Goiás.

A fonte é a tabela 9542 do Censo Demográfico 2022 — "Pessoas de 15 anos ou mais
de idade, total e as alfabetizadas, por sexo, cor ou raça e grupos de idade" —,
variável 950 (Pessoas de 15 anos ou mais de idade, em pessoas, 0 casas
decimais), classificação C59 (Alfabetização: 93024 Total, 1023 Alfabetizadas,
1024 Não alfabetizadas). A 9542 foi preferida à 9543 ("Taxa de alfabetização…")
por trazer os VALORES ABSOLUTOS: com alfabetizados e população 15+ separados dá
para agregar recortes territoriais somando numerador e denominador — nunca
média de médias — e a taxa municipal sai daqui mesmo (alfabetizadas / total,
em % com 1 casa). O script aceita duas variantes de API:

1. API de agregados v3 (padrão, --api agregados):

       https://servicodados.ibge.gov.br/api/v3/agregados/9542/periodos/2022/
           variaveis/950?localidades=N6[4314902,...]&classificacao=59[all]

   Documentação: https://servicodados.ibge.gov.br/api/docs/agregados?versao=3

2. API SIDRA (--api sidra):

       https://apisidra.ibge.gov.br/values/t/9542/n6/4314902,.../v/950/p/2022/
           c59/all?formato=json

   Documentação: https://apisidra.ibge.gov.br/home/ajuda
   Estrutura da tabela: https://apisidra.ibge.gov.br/desctabapi.aspx?c=9542

Nas duas variantes as classificações não listadas (C2 Sexo, C86 Cor ou raça e
C287 Idade) devem voltar na categoria "Total"; por segurança o parser também
filtra pelo nome da categoria e descarta qualquer recorte que não seja "Total"
nessas dimensões. Como a variável 950 já é restrita a 15 anos ou mais, o
"Total" da idade É a população de 15+ — e o script confere o nome da variável
na resposta e FALHA se ele não disser "15 anos ou mais" (proteção contra
apontar para outra tabela ou outro recorte etário por engano).

Fechamentos exigidos (falha ruidosa em qualquer inconsistência):

* por localidade: Alfabetizadas + Não alfabetizadas == Total;
* estadual: a soma municipal de alfabetizadas e de população 15+ bate EXATA
  com a consulta do estado (N3 52);
* cobertura: os 246 municípios de src/data/electorate-go.json, nem um a menos
  nem uma localidade estranha a mais.

Como o scripts/process_ibge_age.py, este script guarda a resposta bruta da
API: com --cache-dir cada lote vira um arquivo JSON em disco, com SHA-256
registrado num manifest.json e repetido no metadado da saída. Com --from-cache
ele processa do cache sem rede (verificando os hashes) — é assim que o teste
roda:

    python3 scripts/tests/literacy_fixture.py
    python3 scripts/process_ibge_literacy.py \
        --electorate-file scripts/tests/fixtures/literacy/electorate-fixture.json \
        --cache-dir scripts/tests/fixtures/literacy/cache \
        --from-cache \
        --expected-municipalities 2 \
        --output scripts/tests/fixtures/literacy/out/literacy.json
    python3 scripts/tests/literacy_fixture.py \
        --check scripts/tests/fixtures/literacy/out/literacy.json

A saída (src/data/literacy-go.json) tem, por município, literate15Plus,
population15Plus e literacyRate (0-100, 1 casa decimal). Enquanto o arquivo
não é gerado o app usa o placeholder com status "pendente" e municipalities
vazio — dado ausente vira null no frontend, nunca zero.
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
# Rio Grande do Sul, esquecido aqui na primeira geração do fork (mesmo bug do
# process_ibge_age.py): a soma municipal batia com Goiás, mas o total estadual
# de conferência vinha de outro estado, e o fechamento estourava sem explicar.
STATE_IBGE_CODE = "52"
AGGREGATE = "9542"
VARIABLE = "950"
LITERACY_CLASSIFICATION = "59"
REFERENCE_YEAR = 2022
EXPECTED_MUNICIPALITIES = 246
API_VARIANTS = ("agregados", "sidra")
AGREGADOS_ROOT = "https://servicodados.ibge.gov.br/api/v3/agregados"
SIDRA_ROOT = "https://apisidra.ibge.gov.br/values"
SOURCE_NAME = "IBGE — Censo Demográfico 2022"
DATASET_NAME = (
    "Pessoas de 15 anos ou mais de idade, total e as alfabetizadas "
    "(Tabela 9542, variável 950, classificação C59)"
)
SOURCE_URLS = (
    "https://sidra.ibge.gov.br/tabela/9542",
    "https://servicodados.ibge.gov.br/api/docs/agregados?versao=3",
    "https://apisidra.ibge.gov.br/desctabapi.aspx?c=9542",
)
MANIFEST_NAME = "manifest.json"
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2.0
BATCH_PAUSE_SECONDS = 0.3
VARIABLE_AGE_MARKER = "15 anos ou mais"

# Convenção SIDRA/agregados: "-" é zero verdadeiro; os demais marcam ausência.
ZERO_MARKER = "-"
MISSING_MARKERS = {"..", "...", "X"}

# Categorias da C59 (Alfabetização) reconhecidas pelo nome normalizado.
CATEGORY_FIELDS = {
    "total": "total",
    "alfabetizadas": "literate",
    "nao alfabetizadas": "nonLiterate",
}
FIELD_LABELS = {
    "total": "Total",
    "literate": "Alfabetizadas",
    "nonLiterate": "Não alfabetizadas",
}


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description=(
            "Gera a alfabetização 15+ municipal de Goiás (Censo 2022, tabela 9542)."
        ),
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
        default=project_root / "src" / "data" / "literacy-go.json",
        help="Destino do JSON validado (padrão: src/data/literacy-go.json).",
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
            f"?localidades={level}[{joined}]&classificacao={LITERACY_CLASSIFICATION}[all]"
        )
    return (
        f"{SIDRA_ROOT}/t/{AGGREGATE}/{level.lower()}/{joined}/v/{VARIABLE}"
        f"/p/{REFERENCE_YEAR}/c{LITERACY_CLASSIFICATION}/all?formato=json"
    )


def http_get(url: str, timeout: int) -> bytes:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "ACCORSI-Mapa/1.0 (alfabetizacao 15+; dados publicos agregados)",
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
    return {"total": None, "literate": None, "nonLiterate": None, "other": set()}


def check_variable_age(name: str, label: str) -> None:
    """A variável 950 é 'Pessoas de 15 anos ou mais de idade'; outro recorte é erro."""
    if VARIABLE_AGE_MARKER not in normalize(name):
        raise RuntimeError(
            f"{label}: a variável {VARIABLE} veio nomeada {name!r}, sem o recorte "
            f"'{VARIABLE_AGE_MARKER}'. A consulta apontou para outra tabela ou outro "
            "recorte etário; nada foi aproveitado."
        )


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
    category_name: str,
    value: int,
    label: str,
) -> None:
    entry = entries.setdefault(code, new_entry())
    field = CATEGORY_FIELDS.get(normalize(category_name))
    if field is None:
        entry["other"].add(category_name)
        return
    if entry[field] is not None and entry[field] != value:
        raise RuntimeError(
            f"{label}: categoria {category_name!r} duplicada com valores divergentes "
            f"em {code}."
        )
    entry[field] = value


def parse_agregados(payload: Any, label: str, entries: dict[str, dict[str, Any]]) -> None:
    if not isinstance(payload, list) or not payload:
        raise RuntimeError(
            f"{label}: resposta da API de agregados não é uma lista com resultados; "
            f"recebido: {json.dumps(payload, ensure_ascii=False)[:300]!r}"
        )
    for variable in payload:
        if str(variable.get("id")) != VARIABLE:
            continue
        check_variable_age(str(variable.get("variavel", "")), label)
        for resultado in variable.get("resultados", []):
            category_name: str | None = None
            others_total = True
            for classification in resultado.get("classificacoes", []):
                names = list(classification.get("categoria", {}).values())
                if len(names) != 1:
                    raise RuntimeError(
                        f"{label}: classificação com {len(names)} categorias num mesmo "
                        "resultado; esperada exatamente uma."
                    )
                if str(classification.get("id")) == LITERACY_CLASSIFICATION:
                    category_name = str(names[0])
                elif normalize(str(names[0])) != "total":
                    others_total = False
            if category_name is None:
                raise RuntimeError(
                    f"{label}: resultado sem a classificação de alfabetização "
                    f"(C{LITERACY_CLASSIFICATION})."
                )
            if not others_total:
                continue
            for serie in resultado.get("series", []):
                code = str(serie.get("localidade", {}).get("id", "")).strip()
                value = parse_value(
                    serie.get("serie", {}).get(str(REFERENCE_YEAR)),
                    label,
                    f"{category_name!r} em {code}",
                )
                if code and value is not None:
                    record_value(entries, code, category_name, value, label)


def parse_sidra(payload: Any, label: str, entries: dict[str, dict[str, Any]]) -> None:
    if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[0], dict):
        raise RuntimeError(
            f"{label}: resposta do SIDRA não tem cabeçalho e linhas; recebido: "
            f"{json.dumps(payload, ensure_ascii=False)[:300]!r}"
        )
    header = payload[0]
    locality_key = category_name_key = variable_key = period_key = None
    variable_name_key: str | None = None
    other_name_keys: list[str] = []
    for key, raw_label in header.items():
        if not re.fullmatch(r"D\d+C", key):
            continue
        base = normalize(str(raw_label)).split(" (")[0]
        if base in {"municipio", "unidade da federacao"}:
            locality_key = key
        elif base == "alfabetizacao":
            category_name_key = key[:-1] + "N"
        elif base == "variavel":
            variable_key = key
            variable_name_key = key[:-1] + "N"
        elif base in {"ano", "trimestre", "mes"}:
            period_key = key
        else:
            other_name_keys.append(key[:-1] + "N")
    if locality_key is None or category_name_key is None:
        raise RuntimeError(
            f"{label}: cabeçalho do SIDRA sem dimensão de localidade ou de alfabetização; "
            f"cabeçalho: {json.dumps(header, ensure_ascii=False)[:500]}"
        )
    for row in payload[1:]:
        if variable_key and str(row.get(variable_key)) != VARIABLE:
            continue
        if variable_name_key and row.get(variable_name_key) is not None:
            check_variable_age(str(row.get(variable_name_key)), label)
        if period_key and str(row.get(period_key)) != str(REFERENCE_YEAR):
            continue
        if any(normalize(str(row.get(key, ""))) != "total" for key in other_name_keys):
            continue
        code = str(row.get(locality_key, "")).strip()
        category_name = str(row.get(category_name_key, ""))
        value = parse_value(row.get("V"), label, f"{category_name!r} em {code}")
        if code and value is not None:
            record_value(entries, code, category_name, value, label)


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


def derive_locality(entry: dict[str, Any], label: str) -> dict[str, Any]:
    """Deriva alfabetizados, população 15+ e taxa de uma localidade, com fechamento."""
    missing = [FIELD_LABELS[field] for field in FIELD_LABELS if entry[field] is None]
    if missing:
        raise RuntimeError(
            f"{label}: a resposta não trouxe as categorias {', '.join(missing)} da "
            f"C{LITERACY_CLASSIFICATION} (Alfabetização); sem elas não há taxa nem "
            "fechamento."
        )
    total = int(entry["total"])
    literate = int(entry["literate"])
    non_literate = int(entry["nonLiterate"])
    if literate + non_literate != total:
        raise RuntimeError(
            f"{label}: fechamento da alfabetização falhou: alfabetizadas ({literate}) + "
            f"não alfabetizadas ({non_literate}) = {literate + non_literate}, mas o "
            f"total 15+ é {total}."
        )
    if total == 0:
        raise RuntimeError(
            f"{label}: população 15+ igual a zero na fonte; o Censo 2022 não tem "
            "município assim e a taxa ficaria indefinida."
        )
    return {
        "literate15Plus": literate,
        "population15Plus": total,
        "literacyRate": round(literate / total * 100, 1),
    }


def check_state_closure(
    state_record: dict[str, Any], records: dict[str, dict[str, Any]]
) -> list[tuple[str, int, int]]:
    """Compara a soma municipal com o estado (exata); devolve (campo, soma, estado)."""
    checks: list[tuple[str, int, int]] = []
    for field in ("literate15Plus", "population15Plus"):
        municipal_sum = sum(record[field] for record in records.values())
        state_value = state_record[field]
        if municipal_sum != state_value:
            raise RuntimeError(
                f"Fechamento estadual falhou em {field}: soma municipal {municipal_sum}, "
                f"{STATE} {state_value}."
            )
        checks.append((field, municipal_sum, state_value))
    return checks


def build_payload(
    records: dict[str, dict[str, Any]],
    state_record: dict[str, Any],
    manifest: dict[str, Any],
    cache_dir: Path | None,
) -> dict[str, Any]:
    notes = [
        "literacyRate é alfabetizadas / população 15+ em %, com 1 casa decimal, "
        "calculada dos valores absolutos da tabela 9542.",
        "Para agregar recortes territoriais some literate15Plus e population15Plus "
        "separadamente e divida — nunca faça média das taxas municipais.",
    ]
    notes.extend(str(note) for note in manifest.get("notes", []))
    return {
        "metadata": {
            "schemaVersion": SCHEMA_VERSION,
            "state": STATE,
            "source": SOURCE_NAME,
            "dataset": DATASET_NAME,
            "aggregate": AGGREGATE,
            "variable": VARIABLE,
            "classification": LITERACY_CLASSIFICATION,
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
            f"ALERTA: {len(unrecognized)} nomes de categoria de alfabetização não "
            f"reconhecidos foram ignorados: {', '.join(unrecognized[:10])}"
        )

    records: dict[str, dict[str, Any]] = {}
    for code in sorted(entries):
        label = f"município {code} ({municipality_names[code]})"
        records[code] = derive_locality(entries[code], label)
    state_record = derive_locality(state_entry, f"{STATE} (N3 {STATE_IBGE_CODE})")
    state_checks = check_state_closure(state_record, records)

    payload = build_payload(records, state_record, manifest, cache_dir)

    literate = state_record["literate15Plus"]
    total = state_record["population15Plus"]
    print(
        f"Alfabetização 15+ do {STATE}: {len(records)} municípios · variante '{api}' · "
        f"{len(manifest['batches'])} lotes"
    )
    print(
        f"{STATE}: população 15+ {total:,} · alfabetizadas {literate:,} "
        f"(taxa {state_record['literacyRate']}%)"
    )
    print(
        "Fechamento 1 (alfabetizadas + não alfabetizadas == total 15+): OK nos "
        f"{len(records)} municípios."
    )
    print("Fechamento estadual (soma municipal vs. estado):")
    for field, municipal_sum, state_value in state_checks:
        print(f"  {field}: {municipal_sum:,} == {state_value:,}")

    if args.dry_run:
        print(f"Execução em modo --dry-run; nada foi gravado em {args.output.resolve()}.")
        return
    write_json_atomic(payload, args.output.resolve())
    print(f"JSON gerado: {args.output.resolve()}")


if __name__ == "__main__":
    main()
