#!/usr/bin/env python3
"""Gera a análise submunicipal de Goiás: votação agregada por local de votação.

São duas entradas, ambas do portal de dados abertos do TSE:

1. Votação por seção eleitoral (os mesmos ZIPs do scripts/process_tse_history.py):

       https://dadosabertos.tse.jus.br/dataset/resultados-2018
       https://dadosabertos.tse.jus.br/dataset/resultados-2022

   Baixe, para cada ano, "Votação nominal por seção eleitoral" da UF GO (traz
   Governador) e do Brasil (traz Presidente), e coloque os quatro arquivos no
   mesmo diretório apontado por --sections-dir:

       votacao_secao_2018_GO.zip   votacao_secao_2018_BR.zip
       votacao_secao_2022_GO.zip   votacao_secao_2022_BR.zip

2. Eleitorado por local de votação, do dataset "Eleitorado Atual":

       https://dadosabertos.tse.jus.br/dataset/eleitorado-atual

   Recurso "Eleitorado por local de votação" (eleitorado_local_votacao.zip).
   É esse arquivo que amarra zona+seção ao local de votação, com endereço,
   bairro, CEP e, nas versões recentes, latitude e longitude.

ATENÇÃO AO BAIXAR: o TSE renomeia colunas entre publicações. O script detecta o
cabeçalho do arquivo de locais em vez de assumir nomes fixos e aceita variações
conhecidas (NM_BAIRRO/DS_BAIRRO, DS_ENDERECO/NM_ENDERECO, NR_LOCAL_VOTACAO/
CD_LOCAL_VOTACAO etc.). Ainda assim, confira o cabeçalho do recurso baixado: se
um campo essencial mudar de nome o script falha listando o cabeçalho encontrado,
e se um campo opcional (coordenadas, CEP, eleitorado) mudar de nome ele sai como
nulo. O resumo final avisa quantos locais ficaram sem coordenada.

As seções sem correspondência no cadastro de locais não são descartadas em
silêncio: os votos órfãos são contados, reportados no metadado e no resumo, e
passam a ser um erro quando superam 2% dos votos do município no pleito.

A saída é fatiada de propósito, porque o frontend não carrega tudo de uma vez:
src/data/polling/places-go.json traz o cadastro dos locais sem votos e
src/data/polling/votes-<pleito>.json traz os votos por sigla de um único pleito.
Usa apenas a biblioteca padrão do Python.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import tempfile
import unicodedata
from collections import defaultdict
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO
from zipfile import ZipFile

SCHEMA_VERSION = 1
STATE = "GO"
OFFICES = {1: "Presidente", 3: "Governador", 11: "Prefeito", 13: "Vereador"}

# Cada ano tem os seus cargos e os seus pacotes, porque o calendário eleitoral
# brasileiro alterna eleição geral e municipal:
#   * geral (2018, 2022): Presidente vem no pacote nacional, Governador no da UF;
#   * municipal (2020, 2024): Prefeito e Vereador vêm só no pacote da UF, e não
#     existe pacote nacional de votação por seção.
YEAR_SCOPES: dict[int, dict[str, set[int]]] = {
    2018: {"BR": {1}, STATE: {3}},
    2020: {STATE: {11, 13}},
    2022: {"BR": {1}, STATE: {3}},
    2024: {STATE: {11, 13}},
}
YEARS = tuple(sorted(YEAR_SCOPES))
EXPECTED_MUNICIPALITIES = 246
ORDINARY_ELECTION_TYPE = 2
UNMATCHED_TOLERANCE = 0.02
COORDINATE_DECIMALS = 5
CEP_PREFIX_LENGTH = 5
SOURCE_ENCODING = "latin-1"
SECTIONS_URL = "https://dadosabertos.tse.jus.br/dataset/resultados-2022"
PLACES_URL = "https://dadosabertos.tse.jus.br/dataset/eleitorado-atual"

# Marcadores que o TSE usa para "sem informação" em campos numéricos e textuais.
MISSING_MARKERS = {"", "#NULO#", "#NULO", "#NE#", "#NE", "#NI#", "NA", "N/A", "NULL"}
# Sentinelas de coordenada ausente: o TSE grava -1 (e às vezes 0) quando não geocodificou.
COORDINATE_SENTINELS = {-1.0, 0.0}

SECTION_COLUMNS = {
    "DT_GERACAO",
    "ANO_ELEICAO",
    "CD_TIPO_ELEICAO",
    "NR_TURNO",
    "DT_ELEICAO",
    "SG_UF",
    "CD_MUNICIPIO",
    "NR_ZONA",
    "NR_SECAO",
    "CD_CARGO",
    "NR_VOTAVEL",
    "NM_VOTAVEL",
    "QT_VOTOS",
    "SQ_CANDIDATO",
}

# A sigla é a chave da camada de espectro; aceitamos as duas grafias já vistas.
# O pacote de 2018 não traz nenhuma delas: lá a sigla só existe no cadastro de
# candidaturas (consulta_cand), cruzado por SQ_CANDIDATO. Ver load_candidate_parties.
SECTION_PARTY_COLUMNS = ("SG_PARTIDO", "SG_PARTIDO_VOTAVEL")

# Colunas mínimas do cadastro de candidaturas usado como fallback da sigla.
CANDIDATE_COLUMNS = {"ANO_ELEICAO", "CD_CARGO", "SQ_CANDIDATO", "SG_PARTIDO"}

CANDIDATES_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand"

# Colunas do arquivo de locais de votação, em ordem de preferência. Sem estas o
# cruzamento seção -> local é impossível e o script falha.
REQUIRED_PLACE_COLUMNS = {
    "municipality": ("CD_MUNICIPIO", "CD_MUNICIPIO_SECAO", "CD_MUNICIPIO_TSE"),
    "zone": ("NR_ZONA", "NR_ZONA_SECAO"),
    "section": ("NR_SECAO", "NR_SECAO_SECAO"),
    "localCode": ("NR_LOCAL_VOTACAO", "CD_LOCAL_VOTACAO", "NR_LOCAL"),
    "name": ("NM_LOCAL_VOTACAO", "NM_LOCAL", "DS_LOCAL_VOTACAO"),
}

# Colunas desejáveis: quando faltam, o campo correspondente sai nulo e o resumo avisa.
OPTIONAL_PLACE_COLUMNS = {
    "uf": ("SG_UF", "SG_UF_SECAO"),
    "municipalityName": ("NM_MUNICIPIO", "NM_MUNICIPIO_SECAO"),
    "address": ("DS_ENDERECO", "NM_ENDERECO", "DS_LOGRADOURO"),
    "neighborhood": ("NM_BAIRRO", "DS_BAIRRO", "NM_BAIRRO_LOCAL_VOT"),
    "cep": ("NR_CEP", "CD_CEP", "NR_CEP_LOCAL"),
    "latitude": ("NR_LATITUDE", "VR_LATITUDE", "NR_LATITUDE_LOCAL"),
    "longitude": ("NR_LONGITUDE", "VR_LONGITUDE", "NR_LONGITUDE_LOCAL"),
    "electorate": ("QT_ELEITOR", "QT_ELEITORES", "QT_ELEITOR_SECAO", "QT_ELEITORES_SECAO"),
    # O cadastro do TSE traz uma linha por seção POR TURNO, e a mesma seção pode
    # votar em escolas diferentes no 1º e no 2º turno (em Goiás/2022 isso acontece
    # em 21 das 27.429 seções). Sem ler o turno essas linhas parecem um conflito
    # insolúvel; com ele, o índice seção -> local é construído separadamente para
    # cada turno e cada voto cai no local onde foi de fato depositado.
    "round": ("NR_TURNO", "NR_TURNO_SECAO"),
}

# Índice usado quando o cadastro não informa turno (formatos legados): serve de
# fallback para qualquer turno pedido na hora de atribuir os votos.
FALLBACK_ROUND = 0


def resolve_round_index(
    section_index: dict[tuple[int, int], dict[tuple[str, int, int], str]],
    year: int,
    round_number: int,
) -> tuple[dict[tuple[str, int, int], str], bool]:
    """Devolve (índice de (ano, turno), usou_fallback).

    O índice NUNCA cai no cadastro de outro ano: o TSE renumera seções entre
    eleições, então usar o cadastro errado atribuiria os votos ao bairro errado
    em silêncio. Falta de cadastro do ano é erro, não fallback.

    Dentro do mesmo ano, quando o turno pedido não existe no cadastro — caso do
    formato legado, sem NR_TURNO — cai no índice mais completo daquele ano e
    devolve o aviso para o chamador contabilizar.
    """
    exact = section_index.get((year, round_number))
    if exact is not None:
        return exact, False

    same_year = {key: value for key, value in section_index.items() if key[0] == year}
    if not same_year:
        raise RuntimeError(
            f"Nenhum cadastro de locais de votação carregado para {year}. "
            f"Passe --places-file {year}=caminho/eleitorado_local_votacao_{year}.zip "
            f"(ou tire {year} de --years)."
        )
    if list(same_year) == [(year, FALLBACK_ROUND)]:
        # Cadastro legado, sem coluna de turno: o índice único vale para todos os
        # turnos por definição, então isso não é um fallback digno de alerta.
        return same_year[(year, FALLBACK_ROUND)], False
    fallback = max(same_year, key=lambda item: len(same_year[item]))
    return same_year[fallback], True


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Gera a votação por local de votação em Goiás (Presidente e Governador).",
    )
    parser.add_argument(
        "--sections-dir",
        type=Path,
        required=True,
        help="Diretório com os ZIPs votacao_secao_<ano>_<GO|BR>.zip.",
    )
    parser.add_argument(
        "--places-file",
        action="append",
        required=True,
        metavar="ANO=CAMINHO",
        help=(
            "Cadastro do eleitorado por local de votação, na forma ANO=CAMINHO "
            "(ex.: 2022=dados/eleitorado_local_votacao_2022.zip). É preciso um "
            "por ano processado: o TSE renumera seções entre eleições, e usar o "
            "cadastro de outro ano jogaria os votos no bairro errado. Repita a "
            "opção para vários anos. Um caminho sem ANO= só é aceito quando "
            "--years tem um único ano."
        ),
    )
    parser.add_argument(
        "--electorate-file",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
        help="JSON do eleitorado, usado para a correspondência TSE/IBGE.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root / "src" / "data" / "polling",
        help="Diretório de saída (padrão: src/data/polling).",
    )
    parser.add_argument(
        "--spectrum-file",
        type=Path,
        default=project_root / "src" / "data" / "party-spectrum.json",
        help="JSON do espectro ideológico, usado apenas para alertar siglas ausentes.",
    )
    parser.add_argument(
        "--years",
        type=int,
        nargs="+",
        choices=YEARS,
        default=list(YEARS),
        help="Anos a processar. Reduza para reprocessar um ano só ou rodar o fixture.",
    )
    parser.add_argument(
        "--expected-municipalities",
        type=int,
        default=EXPECTED_MUNICIPALITIES,
        help=(
            "Cobertura municipal da base de correspondência. Só mude para rodar "
            "sobre o fixture sintético de testes; a produção usa 246."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Valida e resume sem gravar nenhum JSON.",
    )
    parser.add_argument(
        "--candidates-dir",
        type=Path,
        help=(
            "Diretório com os ZIPs consulta_cand_<ano>.zip. Obrigatório para anos "
            "cujo pacote de seção não traz a sigla do partido (é o caso de 2018)."
        ),
    )
    return parser.parse_args()


def require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"{label} não encontrado: {path}")


def parse_places_files(raw_values: list[str], years: list[int]) -> dict[int, Path]:
    """Interpreta os --places-file e exige um cadastro para cada ano processado.

    Aceita ANO=CAMINHO e, só quando há um único ano em --years, um caminho solto.
    Exigir o cadastro do ano é o que impede o erro silencioso de casar votos de
    uma eleição com o mapa de seções de outra.
    """
    resolved: dict[int, Path] = {}
    bare: list[Path] = []

    for value in raw_values:
        prefix, separator, remainder = value.partition("=")
        if separator and prefix.strip().isdigit():
            year = int(prefix.strip())
            if year in resolved:
                raise RuntimeError(f"--places-file repetido para o ano {year}.")
            resolved[year] = Path(remainder).expanduser().resolve()
        else:
            bare.append(Path(value).expanduser().resolve())

    if bare:
        if len(bare) > 1 or resolved:
            raise RuntimeError(
                "Misturar caminhos com e sem ANO= é ambíguo. Use a forma "
                "ANO=CAMINHO para todos os cadastros."
            )
        if len(years) != 1:
            raise RuntimeError(
                f"--places-file sem ANO= só vale quando --years tem um ano só; "
                f"foram pedidos {len(years)}: {years}. Use, por exemplo, "
                f"--places-file {years[0]}={bare[0].name}."
            )
        resolved[years[0]] = bare[0]

    faltando = [year for year in years if year not in resolved]
    if faltando:
        exemplos = " ".join(
            f"--places-file {year}=eleitorado_local_votacao_{year}.zip" for year in faltando
        )
        raise RuntimeError(
            f"Sem cadastro de locais de votação para: {faltando}. "
            f"O TSE renumera seções entre eleições, então cada ano precisa do "
            f"cadastro dele. Acrescente: {exemplos}"
        )

    sobrando = sorted(set(resolved) - set(years))
    for year in sobrando:
        del resolved[year]
    if sobrando:
        print(f"Cadastros ignorados (ano fora de --years): {sobrando}.")

    return resolved


def load_candidate_parties(path: Path, year: int) -> dict[str, str]:
    """Mapeia SQ_CANDIDATO -> sigla, a partir do cadastro de candidaturas do TSE.

    O pacote de votação por seção de 2018 não tem coluna de partido: identifica a
    candidatura só por SQ_CANDIDATO. A sigla vem daqui, que é a fonte oficial —
    inferir pelo número da urna seria frágil, porque a numeração dos partidos
    muda de uma eleição para a outra.
    """
    parties: dict[str, str] = {}
    with ZipFile(path) as archive:
        members = [
            name
            for name in archive.namelist()
            if Path(name).name.lower().startswith(f"consulta_cand_{year}_")
            and name.lower().endswith(".csv")
        ]
        if not members:
            raise RuntimeError(
                f"Nenhum CSV consulta_cand_{year}_*.csv dentro de {path.name}."
            )
        for member in members:
            with archive.open(member) as raw:
                reader = open_csv(raw)
                validate_columns(reader.fieldnames, CANDIDATE_COLUMNS, member)
                for row_number, row in enumerate(reader, start=2):
                    office_code = parse_int(row["CD_CARGO"], "CD_CARGO", row_number)
                    if office_code not in OFFICES:
                        continue
                    row_year = parse_int(row["ANO_ELEICAO"], "ANO_ELEICAO", row_number)
                    if row_year != year:
                        continue
                    candidate_id = clean_label(row["SQ_CANDIDATO"])
                    if not candidate_id or candidate_id.startswith("-"):
                        continue
                    party = clean_label(row["SG_PARTIDO"]).upper()
                    if not party:
                        continue
                    previous = parties.get(candidate_id)
                    if previous and previous != party:
                        raise RuntimeError(
                            f"Candidatura {candidate_id} com duas siglas em "
                            f"{member}: {previous} e {party}."
                        )
                    parties[candidate_id] = party
    if not parties:
        raise RuntimeError(
            f"Nenhuma candidatura de Presidente ou Governador de {year} em {path.name}."
        )
    return parties


def find_member(archive: ZipFile, suffix: str, label: str) -> str:
    matches = [name for name in archive.namelist() if name.lower().endswith(suffix)]
    if len(matches) != 1:
        raise RuntimeError(
            f"Esperado exatamente um {label} terminado em {suffix!r}; "
            f"encontrados: {matches}"
        )
    return matches[0]


def open_csv(raw: BinaryIO) -> csv.DictReader:
    text = io.TextIOWrapper(raw, encoding=SOURCE_ENCODING, newline="")
    return csv.DictReader(text, delimiter=";", quotechar='"')


@contextmanager
def open_table(path: Path, label: str) -> Iterator[tuple[str, csv.DictReader]]:
    """Abre o CSV do TSE esteja ele solto ou dentro do ZIP publicado."""
    if path.suffix.lower() == ".zip":
        with ZipFile(path) as archive:
            member = find_member(archive, ".csv", label)
            with archive.open(member) as raw:
                yield member, open_csv(raw)
    else:
        with path.open("rb") as raw:
            yield path.name, open_csv(raw)


def validate_columns(
    fieldnames: Iterable[str] | None,
    required: set[str],
    label: str,
) -> None:
    missing = sorted(required - set(fieldnames or []))
    if missing:
        raise RuntimeError(f"Colunas ausentes em {label}: {', '.join(missing)}")


def resolve_optional_column(
    fieldnames: Iterable[str] | None,
    alternatives: tuple[str, ...],
) -> str | None:
    available = set(fieldnames or [])
    found = [name for name in alternatives if name in available]
    return found[0] if found else None


def resolve_column(
    fieldnames: Iterable[str] | None,
    alternatives: tuple[str, ...],
    field: str,
    label: str,
) -> str:
    column = resolve_optional_column(fieldnames, alternatives)
    if column:
        return column
    header = ", ".join(fieldnames or []) or "(cabeçalho vazio)"
    raise RuntimeError(
        f"Nenhuma coluna reconhecida para {field} em {label}; esperada uma de: "
        f"{', '.join(alternatives)}. Cabeçalho encontrado: {header}"
    )


def parse_int(value: str | None, field: str, row_number: int) -> int:
    raw = (value or "").strip()
    try:
        return int(raw or "0")
    except ValueError as error:
        raise ValueError(
            f"Valor inválido em {field}, linha {row_number}: {raw!r}"
        ) from error


def clean_label(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def clean_text(value: str | None) -> str:
    label = clean_label(value)
    return "" if label.upper() in MISSING_MARKERS else label


def display_name(value: str | None) -> str:
    words = clean_text(value).title().split()
    connectors = {"Da", "Das", "De", "Do", "Dos", "E"}
    return " ".join(
        word.lower() if index > 0 and word in connectors else word
        for index, word in enumerate(words)
    )


def normalize_code(value: str | None) -> str:
    return (value or "").strip().zfill(5)


def neighborhood_key(value: str) -> str:
    """Replica src/utils/registrations.ts:normalizeNeighborhoodKey.

    NFD, sem diacríticos, minúsculas, espaços colapsados: a chave gerada aqui
    precisa casar exatamente com a que o frontend calcula em tempo de execução.
    """
    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(stripped.lower().split())


def parse_cep_prefix(value: str | None) -> str | None:
    digits = "".join(char for char in clean_text(value) if char.isdigit())
    if len(digits) == 8:
        return digits[:CEP_PREFIX_LENGTH]
    if len(digits) == CEP_PREFIX_LENGTH:
        return digits
    return None


def parse_coordinate(value: str | None, limit: float) -> float | None:
    raw = clean_text(value).replace(",", ".")
    if not raw:
        return None
    try:
        number = float(raw)
    except ValueError:
        return None
    if number in COORDINATE_SENTINELS or abs(number) > limit:
        return None
    return round(number, COORDINATE_DECIMALS)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_entry(path: Path) -> dict[str, str]:
    return {"name": path.name, "sha256": sha256(path)}


def load_municipality_mapping(path: Path, expected: int) -> tuple[dict[str, str], dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    metadata = payload.get("metadata", {})
    records = payload.get("municipalities")
    if (
        metadata.get("state") != STATE
        or not isinstance(records, dict)
        or len(records) != expected
    ):
        raise RuntimeError(f"A base municipal precisa conter os {expected} municípios de Goiás.")

    mapping: dict[str, str] = {}
    names: dict[str, str] = {}
    for ibge_code, record in records.items():
        tse_code = normalize_code(str(record.get("tseCode", "")))
        if not tse_code.strip("0") or tse_code in mapping:
            raise RuntimeError(f"Código TSE ausente ou duplicado em {ibge_code}.")
        if str(ibge_code) in names:
            raise RuntimeError(f"Código IBGE duplicado na base municipal: {ibge_code}.")
        mapping[tse_code] = str(ibge_code)
        names[str(ibge_code)] = str(record["name"])
    return mapping, names


def load_spectrum_codes(path: Path) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    parties = payload.get("parties")
    if not isinstance(parties, list) or not parties:
        raise RuntimeError(f"Espectro ideológico inválido ou vazio: {path}.")
    known: set[str] = set()
    for party in parties:
        known.add(clean_label(party.get("code")).upper())
        known.update(clean_label(alias).upper() for alias in party.get("aliases", []))
    known.discard("")
    return known


def new_place(
    place_id: str,
    ibge_code: str,
    municipality_name: str,
    zone: int,
    local_code: int,
    row: dict[str, str],
    columns: dict[str, str | None],
) -> dict[str, Any]:
    neighborhood = display_name(row.get(columns["neighborhood"] or "", ""))
    latitude = parse_coordinate(row.get(columns["latitude"] or "", ""), 90.0)
    longitude = parse_coordinate(row.get(columns["longitude"] or "", ""), 180.0)
    if latitude is None or longitude is None:
        latitude = None
        longitude = None
    return {
        "id": place_id,
        "ibgeCode": ibge_code,
        "municipalityName": municipality_name,
        "zone": zone,
        "localCode": local_code,
        "name": display_name(row.get(columns["name"] or "", "")),
        "address": display_name(row.get(columns["address"] or "", "")),
        "neighborhood": neighborhood,
        "neighborhoodKey": neighborhood_key(neighborhood),
        "cep": parse_cep_prefix(row.get(columns["cep"] or "", "")),
        "latitude": latitude,
        "longitude": longitude,
        "sections": set(),
        "electorate": 0 if columns["electorate"] else None,
        "registryYear": None,
    }


def load_places(
    places_files: dict[int, Path],
    tse_to_ibge: dict[str, str],
    municipality_names: dict[str, str],
) -> tuple[
    dict[str, dict[str, Any]],
    dict[tuple[int, int], dict[tuple[str, int, int], str]],
    dict[str, Any],
]:
    """Lê os cadastros de locais e devolve (locais, índices, contadores).

    O índice é uma dict de (ano, turno) -> {(município, zona, seção): local}.
    São duas dimensões porque o TSE renumera seções entre eleições (daí o ano) e
    porque a mesma seção pode votar em prédios diferentes em cada turno da mesma
    eleição (daí o turno).

    Os anos são lidos do mais recente para o mais antigo, então os atributos
    descritivos de cada local (nome, endereço, bairro, coordenada) e o eleitorado
    vêm sempre do cadastro mais novo em que aquele local aparece — o retrato mais
    fiel de hoje. Os anos anteriores só acrescentam o mapeamento seção -> local
    dos seus próprios índices, sem somar eleitorado de novo.
    """
    places: dict[str, dict[str, Any]] = {}
    section_index: dict[tuple[int, int], dict[tuple[str, int, int], str]] = {}
    conflitos: list[str] = []
    counters: dict[str, Any] = dict.fromkeys(
        (
            "sourceRows",
            "outras_uf",
            "cadastros_divergentes",
            "secoes_repetidas",
            "secoes_realocadas",
            "secoes_conflitantes",
        ),
        0,
    )
    secoes_por_ano: dict[int, int] = {}

    for registry_year in sorted(places_files, reverse=True):
        _load_places_year(
            places_files[registry_year],
            registry_year,
            places,
            section_index,
            conflitos,
            counters,
            tse_to_ibge,
            municipality_names,
        )

    if not places:
        raise RuntimeError(f"Nenhum local de votação do {STATE} encontrado nos cadastros.")

    for (registry_year, _), index in section_index.items():
        secoes_por_ano[registry_year] = len(
            {key for ano, turno in section_index if ano == registry_year
             for key in section_index[(ano, turno)]}
        )

    # Seções que trocaram de local entre turnos DO MESMO ANO.
    realocadas = 0
    for registry_year in places_files:
        do_ano = {
            turno: index for (ano, turno), index in section_index.items()
            if ano == registry_year
        }
        chaves = {key for index in do_ano.values() for key in index}
        realocadas += sum(
            1
            for key in chaves
            if len({index[key] for index in do_ano.values() if key in index}) > 1
        )
    counters["secoes_realocadas"] = realocadas
    counters["secoesPorAno"] = secoes_por_ano
    counters["secoesDistintas"] = max(secoes_por_ano.values(), default=0)
    counters["turnos"] = sorted({turno for _, turno in section_index})
    counters["anos"] = sorted(places_files)
    counters["conflitosExemplos"] = conflitos

    counters["locaisSemCoordenada"] = sum(
        1 for place in places.values() if place["latitude"] is None
    )
    counters["locaisSemBairro"] = sum(
        1 for place in places.values() if not place["neighborhood"]
    )
    counters["locaisSemCep"] = sum(1 for place in places.values() if place["cep"] is None)
    return places, section_index, counters


def _load_places_year(
    path: Path,
    registry_year: int,
    places: dict[str, dict[str, Any]],
    section_index: dict[tuple[int, int], dict[tuple[str, int, int], str]],
    conflitos: list[str],
    counters: dict[str, Any],
    tse_to_ibge: dict[str, str],
    municipality_names: dict[str, str],
) -> None:
    """Acrescenta um ano de cadastro aos locais e ao índice, in place."""
    with open_table(path, "CSV de locais de votação") as (member, reader):
        columns: dict[str, str | None] = {
            field: resolve_column(reader.fieldnames, alternatives, field, member)
            for field, alternatives in REQUIRED_PLACE_COLUMNS.items()
        }
        columns |= {
            field: resolve_optional_column(reader.fieldnames, alternatives)
            for field, alternatives in OPTIONAL_PLACE_COLUMNS.items()
        }
        # O resumo reporta as colunas detectadas; com vários anos, vale o do mais
        # recente, que é o primeiro a ser lido.
        counters.setdefault("columns", {})
        if not counters["columns"]:
            counters["columns"] = columns
        uf_column = columns["uf"]

        for row_number, row in enumerate(reader, start=2):
            counters["sourceRows"] += 1
            if uf_column and clean_label(row[uf_column]).upper() != STATE:
                counters["outras_uf"] += 1
                continue

            tse_code = normalize_code(row[columns["municipality"] or ""])
            ibge_code = tse_to_ibge.get(tse_code)
            if not ibge_code:
                if uf_column:
                    raise RuntimeError(
                        f"Município TSE {tse_code} sem correspondência em {member}, "
                        f"linha {row_number}."
                    )
                # Sem coluna de UF só dá para reconhecer Goiás pelo código municipal.
                counters["outras_uf"] += 1
                continue

            zone = parse_int(row[columns["zone"] or ""], "NR_ZONA", row_number)
            section = parse_int(row[columns["section"] or ""], "NR_SECAO", row_number)
            local_code = parse_int(
                row[columns["localCode"] or ""], "NR_LOCAL_VOTACAO", row_number
            )
            if zone <= 0 or section <= 0 or local_code <= 0:
                raise RuntimeError(
                    f"Zona, seção ou local inválidos em {member}, linha {row_number}: "
                    f"{zone}/{section}/{local_code}."
                )

            place_id = f"{tse_code}-{zone}-{local_code}"
            place = places.get(place_id)
            if place is None:
                place = new_place(
                    place_id,
                    ibge_code,
                    municipality_names[ibge_code],
                    zone,
                    local_code,
                    row,
                    columns,
                )
                if not place["name"]:
                    raise RuntimeError(
                        f"Local {place_id} sem nome em {member}, linha {row_number}."
                    )
                place["registryYear"] = registry_year
                places[place_id] = place
            else:
                candidate = new_place(
                    place_id,
                    ibge_code,
                    municipality_names[ibge_code],
                    zone,
                    local_code,
                    row,
                    columns,
                )
                divergent = [
                    field
                    for field in ("name", "address", "neighborhood", "cep", "latitude")
                    if candidate[field] != place[field]
                ]
                if divergent and place["registryYear"] == registry_year:
                    # O TSE às vezes varia grafia ou geocodificação entre seções do
                    # mesmo local; mantemos a primeira ocorrência e contamos o caso.
                    # Divergência entre anos diferentes é esperada (o cadastro é
                    # corrigido com o tempo) e não entra nessa conta.
                    counters["cadastros_divergentes"] += 1

            round_number = FALLBACK_ROUND
            if columns["round"]:
                round_number = parse_int(
                    row[columns["round"]], columns["round"], row_number
                )
                if round_number not in (1, 2):
                    raise RuntimeError(
                        f"Turno inválido no cadastro de locais em {member}, "
                        f"linha {row_number}: {round_number}."
                    )

            section_key = (tse_code, zone, section)
            round_places = section_index.setdefault((registry_year, round_number), {})
            previous = round_places.get(section_key)
            if previous is None:
                round_places[section_key] = place_id
                # O eleitorado e a contagem de seções descrevem o local HOJE, então
                # só entram pelo cadastro mais recente em que ele aparece; anos
                # anteriores apenas mapeiam seção -> local. E, dentro do mesmo ano,
                # cada par (local, seção) entra uma vez só, para não dobrar a soma
                # quando os dois turnos usam o mesmo local.
                if place["registryYear"] == registry_year and section not in place["sections"]:
                    place["sections"].add(section)
                    if columns["electorate"]:
                        electorate = parse_int(
                            row[columns["electorate"]], columns["electorate"], row_number
                        )
                        if electorate < 0:
                            raise RuntimeError(
                                f"Eleitorado negativo em {member}, linha {row_number}."
                            )
                        place["electorate"] += electorate
            elif previous == place_id:
                counters["secoes_repetidas"] += 1
            else:
                # Duas linhas do MESMO turno mandando a seção para locais
                # diferentes: isso o cadastro não explica. Mantemos a primeira,
                # contamos e gritamos no resumo — nunca em silêncio.
                counters["secoes_conflitantes"] += 1
                if len(conflitos) < 10:
                    conflitos.append(
                        f"{tse_code}/{zone}/{section} (turno {round_number}): "
                        f"{previous} vs {place_id}, linha {row_number}"
                    )


def new_contest(year: int, round_number: int, office_code: int) -> dict[str, Any]:
    return {
        "id": f"{year}-{office_code}-{round_number}",
        "electionYear": year,
        "round": round_number,
        "officeCode": office_code,
        "officeName": OFFICES[office_code],
        "electionDates": set(),
        "generationDates": set(),
        "places": defaultdict(lambda: defaultdict(int)),
        "municipalTotals": defaultdict(int),
        "unmatchedVotes": 0,
        "unmatchedByMunicipality": defaultdict(int),
        "unmatchedSections": set(),
        "sourceFiles": set(),
    }


def aggregate_sections(
    path: Path,
    year: int,
    scope: str,
    section_index: dict[tuple[int, int], dict[tuple[str, int, int], str]],
    places: dict[str, dict[str, Any]],
    tse_to_ibge: dict[str, str],
    contests: dict[str, dict[str, Any]],
    counters: dict[str, int],
    candidate_parties: dict[str, str] | None = None,
) -> None:
    """Soma os votos das seções nos locais de votação, in place em `contests`."""
    allowed_offices = YEAR_SCOPES[year][scope]
    with ZipFile(path) as archive:
        members = [
            name
            for name in archive.namelist()
            if Path(name).name.lower().startswith(f"votacao_secao_{year}_")
            and name.lower().endswith(".csv")
        ]
        if len(members) != 1:
            raise RuntimeError(
                f"CSV de votação por seção de {year}/{scope} não encontrado em "
                f"{path.name}; encontrados: {members}"
            )
        member = members[0]
        with archive.open(member) as raw:
            reader = open_csv(raw)
            validate_columns(reader.fieldnames, SECTION_COLUMNS, member)
            # A partir de 2020 o pacote traz a sigla na própria linha. Em 2018 ela
            # só existe no cadastro de candidaturas, cruzada por SQ_CANDIDATO.
            party_column = resolve_optional_column(
                reader.fieldnames, SECTION_PARTY_COLUMNS
            )
            if party_column is None and not candidate_parties:
                raise RuntimeError(
                    f"{member} não traz a sigla do partido (esperada uma de: "
                    f"{', '.join(SECTION_PARTY_COLUMNS)}) e nenhum cadastro de "
                    f"candidaturas de {year} foi carregado. Baixe "
                    f"{CANDIDATES_URL}/consulta_cand_{year}.zip e informe a pasta "
                    "em --candidates-dir."
                )

            for row_number, row in enumerate(reader, start=2):
                counters["sourceRows"] += 1
                office_code = parse_int(row["CD_CARGO"], "CD_CARGO", row_number)
                if office_code not in allowed_offices:
                    counters["outros_cargos"] += 1
                    continue
                if clean_label(row["SG_UF"]).upper() != STATE:
                    if scope == STATE:
                        raise RuntimeError(
                            f"UF divergente em {member}, linha {row_number}: {row['SG_UF']!r}."
                        )
                    counters["outras_uf"] += 1
                    continue
                election_type = parse_int(
                    row["CD_TIPO_ELEICAO"], "CD_TIPO_ELEICAO", row_number
                )
                if election_type != ORDINARY_ELECTION_TYPE:
                    counters["tipo_eleicao"] += 1
                    continue
                row_year = parse_int(row["ANO_ELEICAO"], "ANO_ELEICAO", row_number)
                if row_year != year:
                    raise RuntimeError(
                        f"Ano divergente em {member}, linha {row_number}: {row_year}."
                    )

                candidate_id = clean_label(row["SQ_CANDIDATO"])
                if not candidate_id or candidate_id.startswith("-"):
                    # Convenção do TSE para branco, nulo e agregados não nominais.
                    counters["brancos_e_nulos"] += 1
                    continue

                tse_code = normalize_code(row["CD_MUNICIPIO"])
                ibge_code = tse_to_ibge.get(tse_code)
                if not ibge_code:
                    raise RuntimeError(
                        f"Município TSE {tse_code} sem correspondência em {member}, "
                        f"linha {row_number}."
                    )

                if party_column is not None:
                    party_code = clean_label(row[party_column]).upper()
                else:
                    party_code = (candidate_parties or {}).get(candidate_id, "")
                if not party_code:
                    origem = (
                        f"coluna {party_column}"
                        if party_column is not None
                        else f"cadastro de candidaturas de {year}"
                    )
                    raise RuntimeError(
                        f"Sigla de partido não resolvida pelo {origem} em {member}, "
                        f"linha {row_number} (candidatura {candidate_id})."
                    )
                votes = parse_int(row["QT_VOTOS"], "QT_VOTOS", row_number)
                if votes < 0:
                    raise RuntimeError(f"Votos negativos em {member}, linha {row_number}.")
                round_number = parse_int(row["NR_TURNO"], "NR_TURNO", row_number)
                if round_number not in (1, 2):
                    raise RuntimeError(f"Turno inválido em {member}, linha {row_number}.")

                contest_id = f"{year}-{office_code}-{round_number}"
                contest = contests.setdefault(
                    contest_id, new_contest(year, round_number, office_code)
                )
                contest["electionDates"].add(clean_label(row["DT_ELEICAO"]))
                contest["generationDates"].add(clean_label(row["DT_GERACAO"]))
                contest["sourceFiles"].add(path.name)
                contest["municipalTotals"][ibge_code] += votes

                zone = parse_int(row["NR_ZONA"], "NR_ZONA", row_number)
                section = parse_int(row["NR_SECAO"], "NR_SECAO", row_number)
                # O local é o do turno em que o voto foi depositado: seções
                # realocadas entre turnos têm um índice para cada um.
                round_places, usou_fallback = resolve_round_index(
                    section_index, year, round_number
                )
                if usou_fallback:
                    counters["cadastro_de_outro_turno"] += 1
                place_id = round_places.get((tse_code, zone, section))
                if place_id is None:
                    # Seção órfã: contabilizada, nunca descartada em silêncio.
                    contest["unmatchedVotes"] += votes
                    contest["unmatchedByMunicipality"][ibge_code] += votes
                    contest["unmatchedSections"].add((tse_code, zone, section))
                    counters["secoes_sem_local"] += 1
                    continue
                if places[place_id]["ibgeCode"] != ibge_code:
                    raise RuntimeError(
                        f"Local {place_id} pertence a outro município que não {ibge_code}."
                    )
                contest["places"][place_id][party_code] += votes
                counters["selectedRows"] += 1


def finalize_contest(contest: dict[str, Any], places: dict[str, dict[str, Any]]) -> dict[str, Any]:
    contest_id = contest["id"]
    if len(contest["generationDates"]) != 1:
        raise RuntimeError(
            f"Datas de geração inesperadas em {contest_id}: {sorted(contest['generationDates'])}"
        )
    if len(contest["electionDates"]) != 1:
        raise RuntimeError(
            f"Datas de eleição inesperadas em {contest_id}: {sorted(contest['electionDates'])}"
        )

    output_votes: dict[str, dict[str, int]] = {}
    municipal_from_places: dict[str, int] = defaultdict(int)
    party_totals: dict[str, int] = defaultdict(int)
    for place_id, party_votes in sorted(contest["places"].items()):
        place = places.get(place_id)
        if place is None:
            raise RuntimeError(f"Local {place_id} de {contest_id} não está no cadastro.")
        votes = {code: total for code, total in sorted(party_votes.items()) if total > 0}
        if not votes:
            continue
        for code, total in votes.items():
            if not code:
                raise RuntimeError(f"Sigla vazia no local {place_id} de {contest_id}.")
            if total < 0:
                raise RuntimeError(f"Votos negativos no local {place_id} de {contest_id}.")
            party_totals[code] += total
        output_votes[place_id] = votes
        municipal_from_places[place["ibgeCode"]] += sum(votes.values())

    if not output_votes:
        raise RuntimeError(f"Nenhum voto casado com locais de votação em {contest_id}.")

    total_votes = sum(sum(votes.values()) for votes in output_votes.values())
    if total_votes != sum(party_totals.values()):
        raise RuntimeError(f"Votos por sigla e por local não fecham em {contest_id}.")

    unmatched_votes = contest["unmatchedVotes"]
    municipal_totals = dict(contest["municipalTotals"])
    if sum(municipal_totals.values()) != total_votes + unmatched_votes:
        raise RuntimeError(
            f"Votos por local e por município não fecham em {contest_id}: "
            f"{total_votes + unmatched_votes} e {sum(municipal_totals.values())}."
        )
    for ibge_code, municipal_total in sorted(municipal_totals.items()):
        unmatched = contest["unmatchedByMunicipality"].get(ibge_code, 0)
        if municipal_from_places.get(ibge_code, 0) + unmatched != municipal_total:
            raise RuntimeError(
                f"Votos não fecham no município {ibge_code} de {contest_id}."
            )
        if municipal_total > 0 and unmatched > municipal_total * UNMATCHED_TOLERANCE:
            share = unmatched / municipal_total * 100
            raise RuntimeError(
                f"Município {ibge_code} tem {unmatched:,} votos ({share:.2f}%) em seções "
                f"sem local de votação em {contest_id}; o limite é "
                f"{UNMATCHED_TOLERANCE * 100:.0f}%. Baixe o cadastro de locais atualizado."
            )

    return {
        "id": contest_id,
        "electionYear": contest["electionYear"],
        "round": contest["round"],
        "officeCode": contest["officeCode"],
        "officeName": contest["officeName"],
        "electionDate": next(iter(contest["electionDates"])),
        "generatedAt": next(iter(contest["generationDates"])),
        "sourceFiles": sorted(contest["sourceFiles"]),
        "placeCount": len(output_votes),
        "municipalityCount": len(municipal_totals),
        "partyCount": len(party_totals),
        "totalVotes": total_votes,
        "unmatchedVotes": unmatched_votes,
        "unmatchedSectionCount": len(contest["unmatchedSections"]),
        "partyTotals": dict(party_totals),
        "votes": output_votes,
    }


def build_places_payload(
    places: dict[str, dict[str, Any]],
    input_files: dict[str, dict[str, str]],
    place_counters: dict[str, Any],
) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for place in sorted(
        places.values(), key=lambda item: (item["ibgeCode"], item["zone"], item["localCode"])
    ):
        records.append(
            {key: place[key] for key in ("id", "ibgeCode", "municipalityName", "zone", "localCode")}
            | {
                key: place[key]
                for key in (
                    "name",
                    "address",
                    "neighborhood",
                    "neighborhoodKey",
                    "cep",
                    "latitude",
                    "longitude",
                )
            }
            | {"sectionCount": len(place["sections"]), "electorate": place["electorate"]}
        )

    identifiers = [record["id"] for record in records]
    if len(identifiers) != len(set(identifiers)):
        raise RuntimeError("Há identificadores de local duplicados na saída.")

    columns: dict[str, str | None] = place_counters["columns"]
    return {
        "metadata": {
            "schemaVersion": SCHEMA_VERSION,
            "state": STATE,
            "source": "Tribunal Superior Eleitoral",
            "dataset": "Eleitorado por local de votação",
            "sourceUrl": PLACES_URL,
            "processedAtUtc": datetime.now(UTC).isoformat(timespec="seconds"),
            "placeCount": len(records),
            "municipalityCount": len({record["ibgeCode"] for record in records}),
            "sectionCount": place_counters["secoesDistintas"],
            "registryRounds": place_counters["turnos"],
            "registryYears": place_counters["anos"],
            "sectionsByRegistryYear": {
                str(ano): total for ano, total in sorted(place_counters["secoesPorAno"].items())
            },
            "sectionsRelocatedBetweenRounds": place_counters["secoes_realocadas"],
            "sectionsConflictingWithinRound": place_counters["secoes_conflitantes"],
            "placesWithoutCoordinates": place_counters["locaisSemCoordenada"],
            "placesWithoutNeighborhood": place_counters["locaisSemBairro"],
            "placesWithoutCep": place_counters["locaisSemCep"],
            "detectedColumns": {field: columns[field] for field in sorted(columns)},
            "coordinatePrecision": COORDINATE_DECIMALS,
            "privacyLevel": (
                "Cadastro público de locais de votação; coordenadas arredondadas a "
                f"{COORDINATE_DECIMALS} casas e CEP truncado em {CEP_PREFIX_LENGTH} dígitos."
            ),
            "inputFiles": input_files,
        },
        "places": records,
    }


def build_votes_payload(
    contest: dict[str, Any],
    input_files: dict[str, dict[str, str]],
) -> dict[str, Any]:
    return {
        "metadata": {
            "schemaVersion": SCHEMA_VERSION,
            "contestId": contest["id"],
            "state": STATE,
            "electionYear": contest["electionYear"],
            "round": contest["round"],
            "officeCode": contest["officeCode"],
            "officeName": contest["officeName"],
            "electionDate": contest["electionDate"],
            "generatedAt": contest["generatedAt"],
            "source": "Tribunal Superior Eleitoral",
            "dataset": "Votação nominal por seção eleitoral",
            "sourceUrl": SECTIONS_URL,
            "processedAtUtc": datetime.now(UTC).isoformat(timespec="seconds"),
            "placeCount": contest["placeCount"],
            "municipalityCount": contest["municipalityCount"],
            "partyCount": contest["partyCount"],
            "totalVotes": contest["totalVotes"],
            "unmatchedVotes": contest["unmatchedVotes"],
            "unmatchedSectionCount": contest["unmatchedSectionCount"],
            "inputFiles": input_files,
        },
        "votes": contest["votes"],
    }


def unmapped_parties(
    contests: list[dict[str, Any]], known_codes: set[str]
) -> list[tuple[str, int]]:
    totals: dict[str, int] = defaultdict(int)
    for contest in contests:
        for code, votes in contest["partyTotals"].items():
            if code not in known_codes:
                totals[code] += votes
    return sorted(totals.items(), key=lambda item: (-item[1], item[0]))


def write_json_atomic(payload: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=output.parent, delete=False
    ) as temporary:
        temporary.write(serialized)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, output)


def main() -> None:
    args = parse_args()
    sections_dir = args.sections_dir.resolve()
    if not sections_dir.is_dir():
        raise FileNotFoundError(f"Diretório de entrada não encontrado: {sections_dir}")
    years = sorted(set(args.years))
    section_paths = {
        (year, scope): sections_dir / f"votacao_secao_{year}_{scope}.zip"
        for year in years
        for scope in YEAR_SCOPES[year]
    }
    for (year, scope), path in section_paths.items():
        require_file(path, f"ZIP oficial de votação por seção de {year}/{scope}")

    places_files = parse_places_files(args.places_file, years)
    for year, path in places_files.items():
        require_file(path, f"Cadastro de locais de votação de {year}")

    expected_municipalities = args.expected_municipalities
    if expected_municipalities < 1:
        raise RuntimeError("A cobertura municipal esperada precisa ser positiva.")

    tse_to_ibge, municipality_names = load_municipality_mapping(
        args.electorate_file.resolve(), expected_municipalities
    )
    known_party_codes = load_spectrum_codes(args.spectrum_file.resolve())
    places, section_index, place_counters = load_places(
        places_files, tse_to_ibge, municipality_names
    )

    # Cadastro de candidaturas: só é lido para os anos em que faz falta, e uma
    # vez por ano, não uma vez por pacote.
    candidates_dir = args.candidates_dir.resolve() if args.candidates_dir else None
    candidate_parties: dict[int, dict[str, str]] = {}
    for year in years:
        if candidates_dir is None:
            continue
        candidates_file = candidates_dir / f"consulta_cand_{year}.zip"
        if candidates_file.is_file():
            candidate_parties[year] = load_candidate_parties(candidates_file, year)
            print(
                f"Cadastro de candidaturas de {year}: "
                f"{len(candidate_parties[year]):,} candidaturas com sigla."
            )

    contests: dict[str, dict[str, Any]] = {}
    counters: dict[str, int] = defaultdict(int)
    for (year, scope), path in sorted(section_paths.items()):
        aggregate_sections(
            path,
            year,
            scope,
            section_index,
            places,
            tse_to_ibge,
            contests,
            counters,
            candidate_parties.get(year),
        )
    if not contests:
        raise RuntimeError("Nenhum pleito ordinário encontrado nos ZIPs de votação por seção.")

    finalized = [finalize_contest(contest, places) for contest in contests.values()]
    finalized.sort(
        key=lambda contest: (
            -int(contest["electionYear"]),
            int(contest["officeCode"]),
            int(contest["round"]),
        )
    )
    contest_ids = [contest["id"] for contest in finalized]
    if len(contest_ids) != len(set(contest_ids)):
        raise RuntimeError(f"Pleitos duplicados na saída: {sorted(contest_ids)}.")

    input_files = {
        f"places{year}": file_entry(path) for year, path in sorted(places_files.items())
    }
    input_files["electorate"] = file_entry(args.electorate_file.resolve())
    input_files |= {
        f"sections{year}{scope}": file_entry(path)
        for (year, scope), path in sorted(section_paths.items())
    }
    places_keys = {f"places{year}" for year in places_files}

    places_payload = build_places_payload(places, input_files, place_counters)
    outputs: list[tuple[Path, dict[str, Any]]] = [
        (args.output_dir.resolve() / "places-go.json", places_payload)
    ]
    for contest in finalized:
        contest_inputs = {
            key: entry
            for key, entry in input_files.items()
            if key in places_keys or entry["name"] in contest["sourceFiles"]
        }
        outputs.append(
            (
                args.output_dir.resolve() / f"votes-{contest['id']}.json",
                build_votes_payload(contest, contest_inputs),
            )
        )

    if args.dry_run:
        print(f"Execução em modo --dry-run; nada foi gravado em {args.output_dir.resolve()}.")
    else:
        for path, payload in outputs:
            write_json_atomic(payload, path)

    total_sections = place_counters["secoesDistintas"]
    print(f"Locais de votação processados: {len(places):,} em {expected_municipalities} municípios")
    turnos = place_counters["turnos"]
    if turnos == [FALLBACK_ROUND]:
        print("Cadastro sem coluna de turno: um índice único vale para todos os turnos.")
    else:
        print(f"Cadastro indexado por turno: {', '.join(f'{t}º' for t in turnos)}.")
    por_ano = place_counters["secoesPorAno"]
    print(
        "Cadastro de locais por ano: "
        + " · ".join(f"{ano} ({por_ano[ano]:,} seções)" for ano in sorted(por_ano))
    )
    print(
        f"Seções no cadastro: {total_sections:,} · "
        f"casadas com votos: {counters['selectedRows']:,} linhas · "
        f"órfãs: {counters['secoes_sem_local']:,} linhas"
    )
    print(f"Linhas lidas nos ZIPs de seção: {counters['sourceRows']:,}")
    print(
        f"Linhas descartadas: {counters['outros_cargos']:,} de outros cargos, "
        f"{counters['outras_uf']:,} de outra UF, "
        f"{counters['tipo_eleicao']:,} de outro tipo de eleição, "
        f"{counters['brancos_e_nulos']:,} de brancos/nulos."
    )
    for contest in finalized:
        orphan = ""
        if contest["unmatchedVotes"]:
            share = contest["unmatchedVotes"] / (
                contest["totalVotes"] + contest["unmatchedVotes"]
            ) * 100
            orphan = (
                f" · {contest['unmatchedVotes']:,} votos órfãos ({share:.2f}%) em "
                f"{contest['unmatchedSectionCount']:,} seções sem local"
            )
        print(
            f"  {contest['id']} {contest['officeName']} turno {contest['round']}: "
            f"{contest['totalVotes']:,} votos · {contest['placeCount']:,} locais · "
            f"{contest['partyCount']} siglas{orphan}"
        )

    missing_columns = sorted(
        field
        for field, column in place_counters["columns"].items()
        # "round" não vira campo da saída: quando falta, o efeito já é anunciado
        # na linha "Cadastro sem coluna de turno" acima.
        if column is None and field != "round"
    )
    if missing_columns:
        print(
            f"ALERTA: {len(missing_columns)} campo(s) do cadastro de locais não existem no "
            f"cabeçalho e saíram nulos: {', '.join(missing_columns)}."
        )
    if place_counters["cadastros_divergentes"]:
        print(
            f"ALERTA: {place_counters['cadastros_divergentes']:,} linhas divergem do primeiro "
            "cadastro do mesmo local (grafia ou geocodificação); manteve-se a primeira."
        )
    if place_counters["secoes_realocadas"]:
        share = place_counters["secoes_realocadas"] / max(total_sections, 1) * 100
        print(
            f"{place_counters['secoes_realocadas']:,} de {total_sections:,} seções ({share:.2f}%) "
            "mudaram de local entre os turnos; cada turno usa o local correto."
        )
    if place_counters["secoes_conflitantes"]:
        print(
            f"ALERTA: {place_counters['secoes_conflitantes']:,} seções apontam para dois locais "
            "DENTRO DO MESMO TURNO; manteve-se o primeiro cadastro. Exemplos:"
        )
        for exemplo in place_counters["conflitosExemplos"]:
            print(f"  {exemplo}")
    if counters.get("cadastro_de_outro_turno"):
        print(
            f"ALERTA: {counters['cadastro_de_outro_turno']:,} linhas de voto foram atribuídas "
            "usando o cadastro de outro turno, porque o turno pedido não existe no arquivo "
            "de locais."
        )

    without_coordinates = place_counters["locaisSemCoordenada"]
    if without_coordinates:
        share = without_coordinates / len(places) * 100
        print(
            f"ALERTA: {without_coordinates:,} de {len(places):,} locais ({share:.2f}%) estão "
            "sem coordenada e saíram com latitude e longitude nulas."
        )
    else:
        print("Todos os locais têm coordenada.")

    missing_parties = unmapped_parties(finalized, known_party_codes)
    if missing_parties:
        singular = len(missing_parties) == 1
        label = "sigla" if singular else "siglas"
        verb = "ficaria" if singular else "ficariam"
        print(
            f"ALERTA: {len(missing_parties)} {label} sem correspondência em "
            f"party-spectrum.json; {verb} fora do índice ideológico:"
        )
        for party_code, votes in missing_parties:
            print(f"  {party_code}: {votes:,} votos")
    else:
        print("Todas as siglas encontradas constam em party-spectrum.json.")

    if not args.dry_run:
        print(f"JSONs gerados em: {args.output_dir.resolve()}")
        for path, _ in outputs:
            print(f"  {path.name}")


if __name__ == "__main__":
    main()
