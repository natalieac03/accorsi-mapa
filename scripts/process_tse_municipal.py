#!/usr/bin/env python3
"""Gera a votação por partido das eleições municipais de 2020 e 2024 em Goiás.

Os ZIPs oficiais saem do portal de dados abertos do TSE:

    https://dadosabertos.tse.jus.br/dataset/resultados-2020
    https://dadosabertos.tse.jus.br/dataset/resultados-2024

Em cada página, baixe o pacote "Votação partido por município e zona" da UF GO:

    votacao_partido_munzona_2020_GO.zip
    votacao_partido_munzona_2024_GO.zip

Coloque os dois arquivos no mesmo diretório e aponte --input-dir para ele. O
script lê os CSVs diretamente de dentro dos ZIPs (ISO-8859-1, separador ";"),
soma as zonas eleitorais por município, cruza o código TSE com o código IBGE de
src/data/electorate-go.json e grava o snapshot compacto usado pelo frontend.
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
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO
from zipfile import ZipFile

SCHEMA_VERSION = 1
STATE = "GO"
YEARS = (2020, 2024)
OFFICES = {11: "Prefeito", 13: "Vereador"}
FULL_COVERAGE_OFFICES = {13}
EXPECTED_MUNICIPALITIES = 246

# Cobertura municipal mínima para o cargo de Vereador.
#
# O ideal é 100%: todo município elege vereador. Mas "ideal" e "real" se separam
# de vez em quando — eleição anulada e refeita como suplementar em outro ano,
# resultado publicado pelo TSE fora do pacote ordinário. Nesses casos o certo é
# o município sair como SEM DADO (o mapa já sabe pintar assim e a legenda já
# conta quantos são), não o processamento inteiro morrer.
#
# O que uma falta GRANDE continua indicando é bug de filtro meu — daí o piso.
# Abaixo dele o script para; acima, ele segue e GRITA a lista de faltantes, com
# nome, para conferência humana. Silêncio aqui nunca é opção.
MINIMUM_COVERAGE_RATIO = 0.95
ORDINARY_ELECTION_TYPE = 2
SHARE_TOLERANCE = 0.01
SOURCE_ENCODING = "latin-1"
SOURCE_URL = "https://dadosabertos.tse.jus.br/dataset/resultados-2024"

REQUIRED_COLUMNS = {
    "DT_GERACAO",
    "ANO_ELEICAO",
    "CD_TIPO_ELEICAO",
    "NR_TURNO",
    "CD_ELEICAO",
    "DT_ELEICAO",
    "SG_UF",
    "CD_MUNICIPIO",
    "NM_MUNICIPIO",
    "NR_ZONA",
    "CD_CARGO",
    "DS_CARGO",
    "NR_PARTIDO",
    "SG_PARTIDO",
    "NM_PARTIDO",
}

# O TSE renomeou as colunas de voto entre 2020 e 2024; aceitamos as duas formas.
NOMINAL_VOTE_COLUMNS = ("QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS")
PARTY_VOTE_COLUMNS = ("QT_VOTOS_LEGENDA_VALIDOS", "QT_VOTOS_LEGENDA")


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Gera a votação municipal por partido em Goiás (2020 e 2024).",
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        required=True,
        help="Diretório com os ZIPs votacao_partido_munzona_<ano>_RS.zip.",
    )
    parser.add_argument(
        "--electorate-file",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
        help="JSON do eleitorado, usado para a correspondência TSE/IBGE.",
    )
    parser.add_argument(
        "--spectrum-file",
        type=Path,
        default=project_root / "src" / "data" / "party-spectrum.json",
        help="JSON do espectro ideológico, usado apenas para alertar siglas ausentes.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "src" / "data" / "party-votes-go.json",
        help="JSON de saída (padrão: src/data/party-votes-go.json).",
    )
    parser.add_argument(
        "--expected-municipalities",
        type=int,
        default=EXPECTED_MUNICIPALITIES,
        help=(
            "Cobertura municipal exigida. Só mude para rodar sobre o fixture "
            "sintético de testes; a produção usa 246."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Valida e resume sem gravar o JSON de saída.",
    )
    return parser.parse_args()


def require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"{label} não encontrado: {path}")


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


def validate_columns(
    fieldnames: Iterable[str] | None,
    required: set[str],
    label: str,
) -> None:
    missing = sorted(required - set(fieldnames or []))
    if missing:
        raise RuntimeError(f"Colunas ausentes em {label}: {', '.join(missing)}")


def resolve_vote_column(
    fieldnames: Iterable[str] | None,
    alternatives: tuple[str, ...],
    label: str,
) -> str:
    available = set(fieldnames or [])
    found = [name for name in alternatives if name in available]
    if not found:
        raise RuntimeError(
            f"Nenhuma coluna de votos reconhecida em {label}; "
            f"esperada uma de: {', '.join(alternatives)}."
        )
    if len(found) > 1:
        raise RuntimeError(
            f"Colunas de votos ambíguas em {label}: {', '.join(found)}."
        )
    return found[0]


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


def display_name(value: str | None) -> str:
    words = clean_label(value).title().split()
    connectors = {"Da", "Das", "De", "Do", "Dos", "E"}
    return " ".join(
        word.lower() if index > 0 and word in connectors else word
        for index, word in enumerate(words)
    )


def normalize_code(value: str | None) -> str:
    return (value or "").strip().zfill(5)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_municipality_mapping(
    path: Path, expected: int
) -> tuple[dict[str, str], dict[str, str]]:
    """Devolve (código TSE -> código IBGE, código IBGE -> nome).

    O nome só serve para os alertas: "faltam 8 municípios" não diz nada a quem
    lê; "faltam Anhanguera, Cachoeira Dourada, ..." pode ser conferido contra a
    realidade em dois minutos.
    """
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
    seen_ibge: set[str] = set()
    for ibge_code, record in records.items():
        tse_code = normalize_code(str(record.get("tseCode", "")))
        if not tse_code.strip("0") or tse_code in mapping:
            raise RuntimeError(f"Código TSE ausente ou duplicado em {ibge_code}.")
        if str(ibge_code) in seen_ibge:
            raise RuntimeError(f"Código IBGE duplicado na base municipal: {ibge_code}.")
        seen_ibge.add(str(ibge_code))
        mapping[tse_code] = str(ibge_code)
        names[str(ibge_code)] = clean_label(record.get("name")) or str(ibge_code)
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


def new_contest(year: int, round_number: int, office_code: int) -> dict[str, Any]:
    return {
        "id": f"{year}-{office_code}-{round_number}",
        "electionYear": year,
        "round": round_number,
        "officeCode": office_code,
        "officeName": OFFICES[office_code],
        "electionDates": set(),
        "generationDates": set(),
        "electionCodes": set(),
        "partyRegistry": {},
        "partyTotals": defaultdict(int),
        "municipalities": {},
    }


def aggregate_party_votes(
    path: Path,
    year: int,
    tse_to_ibge: dict[str, str],
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    contests: dict[str, dict[str, Any]] = {}
    counters = {"sourceRows": 0, "selectedRows": 0, "tipo_eleicao": 0, "outras_uf": 0}

    with ZipFile(path) as archive:
        member = find_member(
            archive,
            f"votacao_partido_munzona_{year}_{STATE.lower()}.csv",
            f"CSV de votação por partido de {year}/{STATE}",
        )
        with archive.open(member) as raw:
            reader = open_csv(raw)
            validate_columns(reader.fieldnames, REQUIRED_COLUMNS, member)
            nominal_column = resolve_vote_column(
                reader.fieldnames, NOMINAL_VOTE_COLUMNS, member
            )
            party_column = resolve_vote_column(
                reader.fieldnames, PARTY_VOTE_COLUMNS, member
            )

            for row_number, row in enumerate(reader, start=2):
                counters["sourceRows"] += 1
                if clean_label(row["SG_UF"]).upper() != STATE:
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
                office_code = parse_int(row["CD_CARGO"], "CD_CARGO", row_number)
                if office_code not in OFFICES:
                    continue

                tse_code = normalize_code(row["CD_MUNICIPIO"])
                ibge_code = tse_to_ibge.get(tse_code)
                if not ibge_code:
                    raise RuntimeError(
                        f"Município TSE {tse_code} sem correspondência, linha {row_number}."
                    )

                party_code = clean_label(row["SG_PARTIDO"]).upper()
                if not party_code:
                    raise RuntimeError(f"Sigla de partido vazia na linha {row_number}.")
                party_number = str(parse_int(row["NR_PARTIDO"], "NR_PARTIDO", row_number))

                nominal_votes = parse_int(row[nominal_column], nominal_column, row_number)
                party_votes = parse_int(row[party_column], party_column, row_number)
                if nominal_votes < 0 or party_votes < 0:
                    raise RuntimeError(f"Votos negativos na linha {row_number}.")
                votes = nominal_votes + party_votes

                round_number = parse_int(row["NR_TURNO"], "NR_TURNO", row_number)
                if round_number not in (1, 2):
                    raise RuntimeError(f"Turno inválido na linha {row_number}.")

                contest_id = f"{year}-{office_code}-{round_number}"
                contest = contests.setdefault(
                    contest_id, new_contest(year, round_number, office_code)
                )
                contest["electionDates"].add(clean_label(row["DT_ELEICAO"]))
                contest["generationDates"].add(clean_label(row["DT_GERACAO"]))
                contest["electionCodes"].add(clean_label(row["CD_ELEICAO"]))

                registry = contest["partyRegistry"]
                party = {"number": party_number, "name": display_name(row["NM_PARTIDO"])}
                previous = registry.get(party_code)
                if previous and previous != party:
                    raise RuntimeError(
                        f"Cadastro conflitante para o partido {party_code} em {contest_id}: "
                        f"{previous} e {party}."
                    )
                registry[party_code] = party

                contest["partyTotals"][party_code] += votes
                municipality = contest["municipalities"].setdefault(
                    ibge_code,
                    {"totalVotes": 0, "votes": defaultdict(int)},
                )
                municipality["totalVotes"] += votes
                municipality["votes"][party_code] += votes
                counters["selectedRows"] += 1

    if not contests:
        raise RuntimeError(f"Nenhum pleito ordinário encontrado em {path.name}.")
    return contests, counters


def finalize_contest(
    contest: dict[str, Any],
    expected_municipalities: int,
    municipality_names: dict[str, str] | None = None,
) -> dict[str, Any]:
    contest_id = contest["id"]
    names = municipality_names or {}
    if len(contest["generationDates"]) != 1:
        raise RuntimeError(
            f"Datas de geração inesperadas em {contest_id}: {sorted(contest['generationDates'])}"
        )
    if len(contest["electionDates"]) != 1:
        raise RuntimeError(
            f"Datas de eleição inesperadas em {contest_id}: {sorted(contest['electionDates'])}"
        )
    if len(contest["electionCodes"]) != 1:
        raise RuntimeError(
            f"Códigos de eleição inesperados em {contest_id}: {sorted(contest['electionCodes'])}"
        )

    municipal_results = contest["municipalities"]
    municipality_count = len(municipal_results)
    if municipality_count > expected_municipalities:
        raise RuntimeError(
            f"{contest_id} traz {municipality_count} municípios; "
            f"o máximo é {expected_municipalities}."
        )
    missing_municipalities: list[dict[str, str]] = []
    if (
        contest["officeCode"] in FULL_COVERAGE_OFFICES
        and municipality_count != expected_municipalities
    ):
        ausentes = sorted(set(names) - set(municipal_results))
        missing_municipalities = [
            {"ibgeCode": code, "name": names.get(code, code)} for code in ausentes
        ]
        ratio = municipality_count / expected_municipalities
        if ratio < MINIMUM_COVERAGE_RATIO or not ausentes:
            detalhe = ", ".join(item["name"] for item in missing_municipalities[:15])
            if len(missing_municipalities) > 15:
                detalhe += f" e mais {len(missing_municipalities) - 15}"
            raise RuntimeError(
                f"Cobertura incompleta em {contest_id}: {municipality_count} de "
                f"{expected_municipalities} municípios ({ratio:.1%}). Falta tanto "
                f"município que isto é filtro errado, não realidade"
                + (f": {detalhe}." if detalhe else ".")
            )

    state_total_votes = sum(item["totalVotes"] for item in municipal_results.values())
    party_totals = {
        code: total for code, total in contest["partyTotals"].items() if total > 0
    }
    if state_total_votes <= 0:
        raise RuntimeError(f"Total de votos inválido em {contest_id}.")
    if sum(party_totals.values()) != state_total_votes:
        raise RuntimeError(
            f"Votos por partido e por município não fecham em {contest_id}: "
            f"{sum(party_totals.values())} e {state_total_votes}."
        )

    leading_counts: dict[str, int] = defaultdict(int)
    output_municipalities: dict[str, dict[str, Any]] = {}
    for ibge_code, result in sorted(municipal_results.items()):
        votes = {code: total for code, total in sorted(result["votes"].items()) if total > 0}
        if not votes:
            raise RuntimeError(f"Município {ibge_code} sem votos em {contest_id}.")
        if sum(votes.values()) != result["totalVotes"]:
            raise RuntimeError(f"Votos não fecham no município {ibge_code} de {contest_id}.")
        leading_code = max(votes, key=lambda code: (votes[code], code))
        leading_counts[leading_code] += 1
        output_municipalities[ibge_code] = {
            "totalVotes": result["totalVotes"],
            "leadingPartyCode": leading_code,
            "votes": votes,
        }

    output_parties: list[dict[str, Any]] = []
    for party_code in sorted(party_totals, key=lambda code: (-party_totals[code], code)):
        total = party_totals[party_code]
        registry = contest["partyRegistry"][party_code]
        output_parties.append(
            {
                "code": party_code,
                "number": registry["number"],
                "name": registry["name"],
                "stateVotes": total,
                "stateSharePct": round(total / state_total_votes * 100, 4),
                "municipalitiesLed": leading_counts[party_code],
            }
        )

    share_total = sum(party["stateSharePct"] for party in output_parties)
    if abs(share_total - 100) > SHARE_TOLERANCE:
        raise RuntimeError(
            f"Percentuais não fecham em {contest_id}: {share_total:.4f}%."
        )

    return {
        key: contest[key]
        for key in ("id", "electionYear", "round", "officeCode", "officeName")
    } | {
        "electionDate": next(iter(contest["electionDates"])),
        "stateTotalVotes": state_total_votes,
        "municipalityCount": municipality_count,
        "missingMunicipalities": missing_municipalities,
        "parties": output_parties,
        "municipalities": output_municipalities,
    }


def unmapped_parties(
    contests: list[dict[str, Any]], known_codes: set[str]
) -> list[tuple[str, int]]:
    totals: dict[str, int] = defaultdict(int)
    for contest in contests:
        for party in contest["parties"]:
            if party["code"] not in known_codes:
                totals[party["code"]] += party["stateVotes"]
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
    input_dir = args.input_dir.resolve()
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Diretório de entrada não encontrado: {input_dir}")
    paths = {
        year: input_dir / f"votacao_partido_munzona_{year}_{STATE}.zip" for year in YEARS
    }
    for year, path in paths.items():
        require_file(path, f"ZIP oficial de votação por partido de {year}")

    expected_municipalities = args.expected_municipalities
    if expected_municipalities < 1:
        raise RuntimeError("A cobertura municipal esperada precisa ser positiva.")

    tse_to_ibge, municipality_names = load_municipality_mapping(
        args.electorate_file.resolve(), expected_municipalities
    )
    known_party_codes = load_spectrum_codes(args.spectrum_file.resolve())

    finalized_contests: list[dict[str, Any]] = []
    totals = {"sourceRows": 0, "selectedRows": 0, "tipo_eleicao": 0, "outras_uf": 0}
    for year in YEARS:
        contests, counters = aggregate_party_votes(paths[year], year, tse_to_ibge)
        for key, value in counters.items():
            totals[key] += value
        finalized_contests.extend(
            finalize_contest(contest, expected_municipalities, municipality_names)
            for contest in contests.values()
        )

    finalized_contests.sort(
        key=lambda contest: (
            -int(contest["electionYear"]),
            int(contest["officeCode"]),
            int(contest["round"]),
        )
    )
    contest_ids = [contest["id"] for contest in finalized_contests]
    if len(contest_ids) != len(set(contest_ids)):
        raise RuntimeError(f"Pleitos duplicados na saída: {sorted(contest_ids)}.")

    payload = {
        "metadata": {
            "schemaVersion": SCHEMA_VERSION,
            "state": STATE,
            "source": "Tribunal Superior Eleitoral",
            "dataset": "Votação por partido, município e zona",
            "sourceUrl": SOURCE_URL,
            "processedAtUtc": datetime.now(UTC).isoformat(timespec="seconds"),
            "municipalityCount": expected_municipalities,
            "contestCount": len(finalized_contests),
            "years": list(YEARS),
            "offices": list(OFFICES.values()),
            "sourceRows": totals["sourceRows"],
            "selectedRows": totals["selectedRows"],
            "discardedRows": {
                "tipo_eleicao": totals["tipo_eleicao"],
                "outras_uf": totals["outras_uf"],
            },
            "inputFiles": {
                f"partyVotes{year}": {
                    "name": paths[year].name,
                    "sha256": sha256(paths[year]),
                }
                for year in YEARS
            },
        },
        "contests": finalized_contests,
    }

    output = args.output.resolve()
    if args.dry_run:
        print(f"Execução em modo --dry-run; nada foi gravado em {output}.")
    else:
        write_json_atomic(payload, output)

    print(f"Linhas lidas: {totals['sourceRows']:,}")
    print(f"Linhas agregadas: {totals['selectedRows']:,}")
    print(
        f"Linhas descartadas: {totals['tipo_eleicao']:,} de outro tipo de eleição, "
        f"{totals['outras_uf']:,} de outra UF."
    )
    for contest in finalized_contests:
        coverage = ""
        if contest["municipalityCount"] != expected_municipalities:
            coverage = (
                f" · cobertura parcial: {contest['municipalityCount']} de "
                f"{expected_municipalities} municípios"
            )
        print(
            f"  {contest['id']} {contest['officeName']} turno {contest['round']}: "
            f"{contest['stateTotalVotes']:,} votos · "
            f"{len(contest['parties'])} partidos{coverage}"
        )

    # Cobertura parcial: nome por nome, com o cruzamento que separa "não houve
    # eleição ali" de "meu filtro comeu o dado". Se o município também falta em
    # Prefeito do mesmo ano, o pacote inteiro do TSE não tem aquele município —
    # é realidade. Se ele APARECE em Prefeito e some em Vereador, é anomalia e
    # precisa de investigação antes de virar mapa.
    por_ano_cargo = {
        (contest["electionYear"], contest["officeCode"]): set(contest["municipalities"])
        for contest in finalized_contests
    }
    for contest in finalized_contests:
        faltantes = contest.get("missingMunicipalities") or []
        if not faltantes:
            continue
        prefeito = por_ano_cargo.get((contest["electionYear"], 11), set())
        print(
            f"ALERTA: {contest['id']} saiu com {contest['municipalityCount']} de "
            f"{expected_municipalities} municípios. Estes ficam SEM DADO no mapa "
            "(cinza), não com zero:"
        )
        for item in faltantes:
            tambem = "também sem Prefeito" if item["ibgeCode"] not in prefeito else (
                "TEM Prefeito no mesmo ano — anomalia, me avise"
            )
            print(f"  {item['name']} ({item['ibgeCode']}) · {tambem}")

    missing_parties = unmapped_parties(finalized_contests, known_party_codes)
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
        print(f"JSON gerado em: {output}")


if __name__ == "__main__":
    main()
