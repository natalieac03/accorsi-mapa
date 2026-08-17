#!/usr/bin/env python3
"""Gera o histórico municipal de Presidente e Governador em Goiás.

Lê os ZIPs oficiais de votação por seção e de candidaturas do TSE, agrega os
votos válidos por município e produz o snapshot compacto usado pelo frontend.
O processamento não extrai os CSVs de mais de 1 GB e usa só a biblioteca
padrão do Python.
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
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO, Iterable
from zipfile import ZipFile

STATE = "GO"
YEARS = (2018, 2022)
OFFICES = {1: "Presidente", 3: "Governador"}

# Só eleição ORDINÁRIA. Os pacotes de votação por seção do TSE trazem, no mesmo
# arquivo, eleições suplementares e outros pleitos extraordinários — cujas
# candidaturas NÃO estão no cadastro do pleito geral daquele ano. Sem este
# filtro, a primeira linha dessas outras eleições derrubava o processamento
# inteiro com "candidatura não está no cadastro". process_tse_sections.py e
# process_candidato_foco.py já filtravam; este arquivo era o único que não.
ORDINARY_ELECTION_TYPE = 2

# Fração máxima de votos em candidaturas fora do cadastro que ainda deixa o
# processamento seguir. Acima disso alguma premissa quebrou de verdade e falhar
# é o certo; abaixo, o que existe é ruído de borda do TSE, e derrubar o
# pipeline inteiro por causa dele impede TODOS os passos seguintes de rodar.
MAX_UNKNOWN_VOTE_RATIO = 0.005
EXPECTED_MUNICIPALITIES = 246
SOURCE_ENCODING = "latin-1"
SOURCE_URL = "https://dadosabertos.tse.jus.br/dataset/resultados-2022"

SECTION_COLUMNS = {
    "DT_GERACAO",
    "ANO_ELEICAO",
    "NR_TURNO",
    "DT_ELEICAO",
    "SG_UF",
    "CD_MUNICIPIO",
    "NM_MUNICIPIO",
    "CD_CARGO",
    "DS_CARGO",
    "NR_VOTAVEL",
    "NM_VOTAVEL",
    "QT_VOTOS",
    "SQ_CANDIDATO",
}

CANDIDATE_COLUMNS = {
    "ANO_ELEICAO",
    "SG_UF",
    "CD_CARGO",
    "SQ_CANDIDATO",
    "NR_CANDIDATO",
    "NM_CANDIDATO",
    "NM_URNA_CANDIDATO",
    "SG_PARTIDO",
    "NM_PARTIDO",
    "DS_SITUACAO_CANDIDATURA",
    "DS_SIT_TOT_TURNO",
}


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Gera o histórico oficial TSE de Presidente e Governador em Goiás."
    )
    parser.add_argument("--section-2018", type=Path, required=True)
    parser.add_argument("--section-2022", type=Path, required=True)
    parser.add_argument("--president-2018", type=Path, required=True)
    parser.add_argument("--president-2022", type=Path, required=True)
    parser.add_argument("--candidates-2018", type=Path, required=True)
    parser.add_argument("--candidates-2022", type=Path, required=True)
    parser.add_argument(
        "--electorate-file",
        type=Path,
        default=project_root / "src" / "data" / "electorate-go.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "src" / "data" / "election-history-go.json",
    )
    return parser.parse_args()


def open_csv(raw: BinaryIO) -> csv.DictReader:
    text = io.TextIOWrapper(raw, encoding=SOURCE_ENCODING, newline="")
    return csv.DictReader(text, delimiter=";", quotechar='"')


def validate_columns(
    fieldnames: Iterable[str] | None, required: set[str], label: str
) -> None:
    missing = sorted(required - set(fieldnames or []))
    if missing:
        raise RuntimeError(f"Colunas ausentes em {label}: {', '.join(missing)}")


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


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_municipality_mapping(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    metadata = payload.get("metadata", {})
    records = payload.get("municipalities")
    if (
        metadata.get("state") != STATE
        or metadata.get("municipalityCount") != EXPECTED_MUNICIPALITIES
        or not isinstance(records, dict)
        or len(records) != EXPECTED_MUNICIPALITIES
    ):
        raise RuntimeError("A base municipal precisa conter os 246 municípios de Goiás.")

    mapping: dict[str, str] = {}
    names: dict[str, str] = {}
    for ibge_code, record in records.items():
        tse_code = str(record.get("tseCode", "")).zfill(5)
        if not tse_code or tse_code in mapping:
            raise RuntimeError(f"Código TSE ausente ou duplicado em {ibge_code}.")
        mapping[tse_code] = str(ibge_code)
        names[str(ibge_code)] = str(record["name"])
    return mapping, names


def candidate_members(archive: ZipFile, year: int) -> list[str]:
    # Presidente se registra no pacote BR (nacional); Governador, no pacote do
    # próprio estado. Um "_rs" fixo aqui pegava as candidaturas do Rio Grande
    # do Sul — o cadastro carregava sem erro (o zip tem os 27 estados, dois
    # sufixos batiam), só que era o cadastro do estado errado: nenhum
    # SQ_CANDIDATO de Goiás batia nele, daí "candidatura não está no cadastro"
    # em toda linha de Governador.
    suffixes = (f"consulta_cand_{year}_{STATE.lower()}.csv", f"consulta_cand_{year}_br.csv")
    members = [
        name
        for name in archive.namelist()
        if name.lower().endswith(suffixes)
    ]
    if len(members) != 2:
        raise RuntimeError(
            f"Esperados os CSVs GO e BR de candidaturas de {year}; encontrados {members}."
        )
    return members


def load_candidates(path: Path, year: int) -> dict[str, dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    with ZipFile(path) as archive:
        for member in candidate_members(archive, year):
            antes_deste_membro = len(candidates)
            with archive.open(member) as raw:
                reader = open_csv(raw)
                validate_columns(reader.fieldnames, CANDIDATE_COLUMNS, member)
                for row_number, row in enumerate(reader, start=2):
                    office_code = parse_int(row["CD_CARGO"], "CD_CARGO", row_number)
                    if office_code not in OFFICES:
                        continue
                    if parse_int(row["ANO_ELEICAO"], "ANO_ELEICAO", row_number) != year:
                        raise RuntimeError(f"Ano divergente em {member}, linha {row_number}.")
                    candidate_id = clean_label(row["SQ_CANDIDATO"])
                    if not candidate_id or candidate_id.startswith("-"):
                        continue
                    candidate = {
                        "id": candidate_id,
                        "number": clean_label(row["NR_CANDIDATO"]),
                        "ballotName": display_name(row["NM_URNA_CANDIDATO"]),
                        "fullName": display_name(row["NM_CANDIDATO"]),
                        "party": clean_label(row["SG_PARTIDO"]),
                        "partyName": display_name(row["NM_PARTIDO"]),
                        "registrationStatus": clean_label(
                            row["DS_SITUACAO_CANDIDATURA"]
                        ),
                        "resultStatus": clean_label(row["DS_SIT_TOT_TURNO"]),
                        "officeCode": office_code,
                    }
                    previous = candidates.get(candidate_id)
                    if previous:
                        stable_keys = set(candidate) - {"resultStatus"}
                        if any(previous[key] != candidate[key] for key in stable_keys):
                            raise RuntimeError(
                                f"Cadastro conflitante para candidatura {candidate_id}."
                            )
                    candidates[candidate_id] = candidate
            # Impresso sempre: se algum dia o cadastro do estado errado voltar
            # a ser lido, o número aqui denuncia antes de qualquer outra coisa.
            print(
                f"  cadastro {year}: {Path(member).name} -> "
                f"{len(candidates) - antes_deste_membro:,} candidaturas"
            )
    return candidates


def procurar_candidatura_no_zip(path: Path, candidate_id: str) -> list[str]:
    """Em quais CSVs do pacote de candidaturas esse SQ_CANDIDATO aparece.

    Existe para responder à única pergunta que importa quando uma candidatura
    não é encontrada: ela está em OUTRO arquivo do mesmo ZIP (leitura do
    recorte errado) ou não está em lugar nenhum (o pacote de votação e o de
    candidatura são de pleitos diferentes)? Sem isso o erro é um beco sem saída.
    """
    achados: list[str] = []
    alvo = candidate_id.encode("latin-1", errors="ignore")
    with ZipFile(path) as archive:
        for nome in archive.namelist():
            if not nome.lower().endswith(".csv"):
                continue
            with archive.open(nome) as raw:
                if alvo in raw.read():
                    achados.append(Path(nome).name)
    return achados


def new_contest(year: int, round_number: int, office_code: int) -> dict[str, Any]:
    return {
        "id": f"{year}-{office_code}-{round_number}",
        "electionYear": year,
        "round": round_number,
        "officeCode": office_code,
        "officeName": OFFICES[office_code],
        "electionDate": "",
        "generatedAt": "",
        "candidateTotals": defaultdict(int),
        "municipalities": {},
    }


def aggregate_sections(
    path: Path,
    year: int,
    candidates: dict[str, dict[str, Any]],
    tse_to_ibge: dict[str, str],
    allowed_offices: set[int],
    skip_unmapped_municipalities: bool = False,
    candidates_path: Path | None = None,
) -> tuple[dict[str, dict[str, Any]], int, int]:
    contests: dict[str, dict[str, Any]] = {}
    source_rows = 0
    selected_rows = 0
    outras_eleicoes = 0
    votos_desconhecidos = 0
    votos_validos = 0
    desconhecidas: dict[str, dict[str, Any]] = {}
    with ZipFile(path) as archive:
        members = [
            name
            for name in archive.namelist()
            if Path(name).name.lower().startswith(f"votacao_secao_{year}_")
            and name.lower().endswith(".csv")
        ]
        if len(members) != 1:
            raise RuntimeError(f"CSV de votação por seção de {year}/GO não encontrado.")
        member = members[0]
        with archive.open(member) as raw:
            reader = open_csv(raw)
            validate_columns(reader.fieldnames, SECTION_COLUMNS, member)
            for row_number, row in enumerate(reader, start=2):
                source_rows += 1
                office_code = parse_int(row["CD_CARGO"], "CD_CARGO", row_number)
                if office_code not in allowed_offices:
                    continue
                row_uf = clean_label(row["SG_UF"]).upper()
                if row_uf != STATE:
                    if skip_unmapped_municipalities:
                        continue
                    raise RuntimeError(
                        f"UF divergente em {member}, linha {row_number}: {row_uf}."
                    )
                row_year = parse_int(row["ANO_ELEICAO"], "ANO_ELEICAO", row_number)
                if row_year != year:
                    raise RuntimeError(f"Ano divergente em {member}, linha {row_number}.")

                # Eleição suplementar/extraordinária no mesmo pacote: as
                # candidaturas dela não estão no cadastro do pleito geral.
                # A coluna não existe nos pacotes mais antigos, daí o get.
                if "CD_TIPO_ELEICAO" in row:
                    tipo = parse_int(
                        row.get("CD_TIPO_ELEICAO"), "CD_TIPO_ELEICAO", row_number
                    )
                    if tipo != ORDINARY_ELECTION_TYPE:
                        outras_eleicoes += 1
                        continue

                candidate_id = clean_label(row["SQ_CANDIDATO"])
                if not candidate_id or candidate_id.startswith("-"):
                    continue
                candidate = candidates.get(candidate_id)
                if not candidate:
                    # NÃO derruba o processamento: acumula, e quem decide é o
                    # balanço no fim (ver MAX_UNKNOWN_VOTE_RATIO). Uma linha de
                    # borda do TSE não pode impedir os passos seguintes do
                    # pipeline de rodar.
                    votos_desconhecidos += parse_int(
                        row["QT_VOTOS"], "QT_VOTOS", row_number
                    )
                    if candidate_id not in desconhecidas:
                        desconhecidas[candidate_id] = {
                            "linha": row_number,
                            "cargo": office_code,
                            "turno": clean_label(row.get("NR_TURNO")),
                            "numero": clean_label(row.get("NR_VOTAVEL")),
                            "nome": clean_label(row.get("NM_VOTAVEL")),
                            "municipio": clean_label(row.get("NM_MUNICIPIO")),
                        }
                    continue
                if int(candidate["officeCode"]) != office_code:
                    raise RuntimeError(f"Cargo divergente na candidatura {candidate_id}.")

                tse_code = clean_label(row["CD_MUNICIPIO"]).zfill(5)
                ibge_code = tse_to_ibge.get(tse_code)
                if not ibge_code:
                    if skip_unmapped_municipalities:
                        continue
                    raise RuntimeError(
                        f"Município TSE {tse_code} sem correspondência, linha {row_number}."
                    )
                votes = parse_int(row["QT_VOTOS"], "QT_VOTOS", row_number)
                if votes < 0:
                    raise RuntimeError(f"Votos negativos na linha {row_number}.")

                round_number = parse_int(row["NR_TURNO"], "NR_TURNO", row_number)
                if round_number not in (1, 2):
                    raise RuntimeError(f"Turno inválido na linha {row_number}.")
                contest_id = f"{year}-{office_code}-{round_number}"
                contest = contests.setdefault(
                    contest_id, new_contest(year, round_number, office_code)
                )
                contest["electionDate"] = clean_label(row["DT_ELEICAO"])
                contest["generatedAt"] = clean_label(row["DT_GERACAO"])
                contest["candidateTotals"][candidate_id] += votes
                municipality = contest["municipalities"].setdefault(
                    ibge_code,
                    {"validVotes": 0, "votes": defaultdict(int)},
                )
                municipality["validVotes"] += votes
                municipality["votes"][candidate_id] += votes
                votos_validos += votes
                selected_rows += 1

    if outras_eleicoes:
        print(
            f"  {year}: {outras_eleicoes:,} linhas de eleição não ordinária "
            "(suplementar/extraordinária) descartadas."
        )

    if desconhecidas:
        total = votos_validos + votos_desconhecidos
        fracao = votos_desconhecidos / total if total else 1.0
        print(
            f"  ALERTA {year}: {len(desconhecidas):,} candidatura(s) fora do "
            f"cadastro, somando {votos_desconhecidos:,} votos "
            f"({fracao:.3%} do apurado)."
        )
        # Para as primeiras, dizemos ONDE elas realmente estão dentro do pacote
        # de candidaturas. É isso que separa "li o recorte errado do ZIP" de
        # "esta candidatura não existe no pacote deste ano".
        for candidate_id, info in list(desconhecidas.items())[:5]:
            onde = (
                procurar_candidatura_no_zip(candidates_path, candidate_id)
                if candidates_path is not None
                else []
            )
            print(
                f"    SQ {candidate_id} (linha {info['linha']}, cargo "
                f"{info['cargo']}, turno {info['turno']}, nº {info['numero']}, "
                f"{info['nome']} em {info['municipio']})"
            )
            print(
                "      no pacote de candidaturas: "
                + (", ".join(onde) if onde else "NÃO aparece em nenhum CSV")
            )
        if len(desconhecidas) > 5:
            print(f"    ... e mais {len(desconhecidas) - 5} candidatura(s).")

        if fracao > MAX_UNKNOWN_VOTE_RATIO:
            raise RuntimeError(
                f"{fracao:.2%} dos votos de {year} estão em candidaturas fora "
                f"do cadastro (teto {MAX_UNKNOWN_VOTE_RATIO:.2%}). Isso não é "
                "ruído de borda: o pacote de votação e o de candidaturas não "
                "batem. Veja as linhas acima para saber onde cada SQ está."
            )
        print(
            "    Abaixo do teto: essas linhas ficam de fora e o processamento segue."
        )

    return contests, source_rows, selected_rows


def finalize_contest(
    contest: dict[str, Any],
    candidates: dict[str, dict[str, Any]],
    municipality_names: dict[str, str],
) -> dict[str, Any]:
    municipal_results = contest["municipalities"]
    if set(municipal_results) != set(municipality_names):
        missing = sorted(set(municipality_names) - set(municipal_results))
        extra = sorted(set(municipal_results) - set(municipality_names))
        raise RuntimeError(
            f"Cobertura incompleta em {contest['id']}: sem {missing}, extras {extra}."
        )

    state_valid_votes = sum(item["validVotes"] for item in municipal_results.values())
    candidate_totals = dict(contest["candidateTotals"])
    if state_valid_votes <= 0 or sum(candidate_totals.values()) != state_valid_votes:
        raise RuntimeError(f"Votos válidos não fecham em {contest['id']}.")

    ordered_candidates = sorted(
        candidate_totals,
        key=lambda candidate_id: (
            -candidate_totals[candidate_id],
            candidates[candidate_id]["ballotName"],
        ),
    )
    winner_counts: dict[str, int] = defaultdict(int)
    output_municipalities: dict[str, dict[str, Any]] = {}
    for ibge_code, result in sorted(municipal_results.items()):
        votes = dict(sorted(result["votes"].items()))
        winner_id = max(votes, key=lambda candidate_id: (votes[candidate_id], candidate_id))
        winner_counts[winner_id] += 1
        output_municipalities[ibge_code] = {
            "validVotes": result["validVotes"],
            "winnerCandidateId": winner_id,
            "votes": votes,
        }

    output_candidates: list[dict[str, Any]] = []
    for rank, candidate_id in enumerate(ordered_candidates, start=1):
        total = candidate_totals[candidate_id]
        metadata = candidates[candidate_id]
        output_candidates.append(
            {
                key: metadata[key]
                for key in (
                    "id",
                    "number",
                    "ballotName",
                    "fullName",
                    "party",
                    "partyName",
                    "registrationStatus",
                    "resultStatus",
                )
            }
            | {
                "stateVotes": total,
                "stateSharePct": round(total / state_valid_votes * 100, 6),
                "stateRank": rank,
                "municipalitiesWon": winner_counts[candidate_id],
            }
        )

    return {
        key: contest[key]
        for key in (
            "id",
            "electionYear",
            "round",
            "officeCode",
            "officeName",
            "electionDate",
            "generatedAt",
        )
    } | {
        "stateValidVotes": state_valid_votes,
        "municipalityCount": len(output_municipalities),
        "candidates": output_candidates,
        "municipalities": output_municipalities,
    }


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
    paths = {
        2018: {
            "governor": args.section_2018.resolve(),
            "president": args.president_2018.resolve(),
            "candidates": args.candidates_2018.resolve(),
        },
        2022: {
            "governor": args.section_2022.resolve(),
            "president": args.president_2022.resolve(),
            "candidates": args.candidates_2022.resolve(),
        },
    }
    for year, year_paths in paths.items():
        for label, path in year_paths.items():
            if not path.is_file():
                raise FileNotFoundError(
                    f"ZIP oficial {label} de {year} não foi encontrado: {path}."
                )

    tse_to_ibge, municipality_names = load_municipality_mapping(
        args.electorate_file.resolve()
    )
    candidate_catalog: dict[int, dict[str, dict[str, Any]]] = {}
    finalized_contests: list[dict[str, Any]] = []
    source_rows = 0
    selected_rows = 0
    pleitos_descartados: list[tuple[str, str]] = []

    for year in YEARS:
        year_paths = paths[year]
        candidate_catalog[year] = load_candidates(year_paths["candidates"], year)
        governor_contests, governor_source_rows, governor_selected_rows = aggregate_sections(
            year_paths["governor"],
            year,
            candidate_catalog[year],
            tse_to_ibge,
            {3},
            candidates_path=year_paths["candidates"],
        )
        president_contests, president_source_rows, president_selected_rows = aggregate_sections(
            year_paths["president"],
            year,
            candidate_catalog[year],
            tse_to_ibge,
            {1},
            skip_unmapped_municipalities=True,
            candidates_path=year_paths["candidates"],
        )
        contests = governor_contests | president_contests
        source_rows += governor_source_rows + president_source_rows
        selected_rows += governor_selected_rows + president_selected_rows
        # Um pleito por vez, e um que falhe NÃO leva os outros junto. Antes,
        # qualquer problema num único pleito (por exemplo o de Governador)
        # abortava tudo e o arquivo não era gravado — a aba Eleições ficava
        # vazia inclusive de Presidente, que não tem relação nenhuma com ele.
        for contest in contests.values():
            try:
                finalized_contests.append(
                    finalize_contest(
                        contest, candidate_catalog[year], municipality_names
                    )
                )
            except RuntimeError as erro:
                pleitos_descartados.append((contest["id"], str(erro)))
                print(f"  !! pleito {contest['id']} descartado: {erro}")

    finalized_contests.sort(
        key=lambda contest: (
            -int(contest["electionYear"]),
            int(contest["officeCode"]),
            int(contest["round"]),
        )
    )
    # 2º turno NÃO é obrigatório — ele só existe quando houve.
    #
    # Aqui havia a exigência fixa de OITO pleitos (2 anos x 2 cargos x 2
    # turnos), herdada do projeto do Rio Grande do Sul, onde a eleição de
    # governador foi para o 2º turno em 2018 e em 2022. Em Goiás, Ronaldo
    # Caiado venceu no 1º turno das duas vezes, então os pleitos de governador
    # de 2º turno NÃO EXISTEM — e exigi-los derrubava o processamento com uma
    # lista que, lida com atenção, estava correta.
    #
    # O que continua sendo obrigatório é o 1º turno de cada cargo em cada ano:
    # esse sempre acontece, e a ausência dele é sinal de dado faltando.
    encontrados = {contest["id"] for contest in finalized_contests}
    obrigatorios = {
        f"{year}-{office_code}-1" for year in YEARS for office_code in OFFICES
    }
    # Falha só quando NADA foi gerado. Com qualquer pleito de pé, o arquivo é
    # gravado e o que faltou fica declarado: meia aba de Eleições funcionando
    # é melhor que uma aba vazia, e o que está lá continua sendo dado real.
    if not finalized_contests:
        raise RuntimeError(
            "Nenhum pleito pôde ser gerado. Nada foi gravado. "
            f"Descartados: {[c for c, _ in pleitos_descartados] or 'nenhum'}."
        )

    faltando = sorted(obrigatorios - encontrados)
    if faltando:
        print(
            f"  AVISO: faltam pleitos de 1º turno: {', '.join(faltando)}. "
            "O arquivo foi gravado com o que existe; a aba Eleições mostra "
            "esses pleitos e omite os ausentes."
        )

    segundos = sorted(c for c in encontrados if c.endswith("-2"))
    primeiros = sorted(c for c in encontrados if c.endswith("-1"))
    print(
        f"  Pleitos: {len(encontrados)} "
        f"({len(primeiros)} de 1º turno + {len(segundos)} de 2º turno"
        + (f": {', '.join(segundos)}" if segundos else " — nenhum")
        + ")"
    )

    payload = {
        "metadata": {
            "state": STATE,
            "years": list(YEARS),
            "offices": list(OFFICES.values()),
            "rounds": [1, 2],
            "source": "Tribunal Superior Eleitoral (TSE) — Dados Abertos",
            "dataset": "Votação por seção e Consulta de candidaturas",
            "sourceUrl": SOURCE_URL,
            "processedAtUtc": datetime.now(UTC).replace(microsecond=0).isoformat(),
            "municipalityCount": EXPECTED_MUNICIPALITIES,
            "contestCount": len(finalized_contests),
            "municipalResultCount": sum(
                len(contest["municipalities"]) for contest in finalized_contests
            ),
            "sourceRows": source_rows,
            "selectedRows": selected_rows,
            # O que NÃO entrou fica escrito no próprio arquivo. Um snapshot
            # parcial que não declara a lacuna é pior que nenhum: quem lê
            # supõe cobertura completa e conclui errado.
            "missingContests": sorted(obrigatorios - encontrados),
            "discardedContests": [
                {"id": contest_id, "reason": motivo}
                for contest_id, motivo in pleitos_descartados
            ],
            "privacyLevel": "Resultados públicos agregados por município; sem dados de eleitores.",
            "inputFiles": {
                f"governorSections{year}": {
                    "name": paths[year]["governor"].name,
                    "sha256": sha256(paths[year]["governor"]),
                }
                for year in YEARS
            }
            | {
                f"presidentSections{year}": {
                    "name": paths[year]["president"].name,
                    "sha256": sha256(paths[year]["president"]),
                }
                for year in YEARS
            }
            | {
                f"candidates{year}": {
                    "name": paths[year]["candidates"].name,
                    "sha256": sha256(paths[year]["candidates"]),
                }
                for year in YEARS
            },
        },
        "contests": finalized_contests,
    }
    write_json_atomic(payload, args.output.resolve())
    print(
        f"Histórico TSE gerado: {args.output.resolve()} · "
        f"{len(finalized_contests)} pleitos · "
        f"{payload['metadata']['municipalResultCount']} resultados municipais."
    )


if __name__ == "__main__":
    main()
