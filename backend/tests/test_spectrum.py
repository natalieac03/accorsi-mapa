from __future__ import annotations

import json
from argparse import Namespace
from pathlib import Path

import pytest
from conftest import login_admin
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.cli import import_party_spectrum
from app.database import SessionLocal
from app.models import (
    ElectionCandidate,
    ElectionContest,
    ImportRun,
    Municipality,
    MunicipalityElectionResult,
    PartyAlias,
    PartySpectrumScore,
    User,
)

SPECTRUM_SOURCE = Path(__file__).parents[2] / "src/data/party-spectrum.json"


def import_spectrum_registry() -> None:
    import_party_spectrum(Namespace(file=str(SPECTRUM_SOURCE)))


def write_spectrum_variant(tmp_path: Path, mutate) -> Path:
    payload = json.loads(SPECTRUM_SOURCE.read_text(encoding="utf-8"))
    mutate(payload)
    target = tmp_path / "party-spectrum.json"
    target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return target


def seed_spectrum_election_sample() -> None:
    """Pleito montado à mão: PT e PL têm nota em 2022, PSL e ACCORSI não têm."""
    with SessionLocal() as db:
        db.add_all(
            [
                Municipality(
                    ibge_code="4314902",
                    tse_code="88013",
                    name="Porto Alegre",
                    uf="GO",
                ),
                Municipality(
                    ibge_code="4304606",
                    tse_code="85873",
                    name="Canoas",
                    uf="GO",
                ),
            ]
        )
        contest = ElectionContest(
            id="2022-1-1",
            election_year=2022,
            office_code=1,
            office_name="Presidente",
            round_number=1,
            election_date="02/10/2022",
            generated_at_source="05/10/2022",
            state_valid_votes=400,
            municipality_count=2,
            source_name="TSE — Dados Abertos",
            source_url="https://dadosabertos.tse.jus.br/dataset/resultados-2022",
        )
        db.add(contest)
        candidates = [
            ElectionCandidate(
                id="2022-1-1:1",
                contest_id=contest.id,
                tse_candidate_id="1",
                number="13",
                ballot_name="Candidata A",
                full_name="Candidata A",
                party="PT",
                party_name="Partido dos Trabalhadores",
                registration_status="APTO",
                result_status="ELEITO",
                state_votes=160,
                state_share_pct=40,
                state_rank=1,
                municipalities_won=1,
            ),
            ElectionCandidate(
                id="2022-1-1:2",
                contest_id=contest.id,
                tse_candidate_id="2",
                number="22",
                ballot_name="Candidato B",
                full_name="Candidato B",
                party="PR",
                party_name="Partido Liberal",
                registration_status="APTO",
                result_status="NÃO ELEITO",
                state_votes=120,
                state_share_pct=30,
                state_rank=2,
                municipalities_won=1,
            ),
            ElectionCandidate(
                id="2022-1-1:3",
                contest_id=contest.id,
                tse_candidate_id="3",
                number="17",
                ballot_name="Candidato C",
                full_name="Candidato C",
                party="PSL",
                party_name="Partido Social Liberal",
                registration_status="APTO",
                result_status="NÃO ELEITO",
                state_votes=80,
                state_share_pct=20,
                state_rank=3,
                municipalities_won=0,
            ),
            ElectionCandidate(
                id="2022-1-1:4",
                contest_id=contest.id,
                tse_candidate_id="4",
                number="99",
                ballot_name="Candidata D",
                full_name="Candidata D",
                party="ACCORSI",
                party_name="Partido Fictício",
                registration_status="APTO",
                result_status="NÃO ELEITO",
                state_votes=40,
                state_share_pct=10,
                state_rank=4,
                municipalities_won=0,
            ),
        ]
        db.add_all(candidates)
        db.flush()
        votes_by_municipality = {
            "4314902": {"1": 100, "2": 60, "3": 30, "4": 10},
            "4304606": {"1": 60, "2": 60, "3": 50, "4": 30},
        }
        for ibge_code, votes_by_candidate in votes_by_municipality.items():
            valid_votes = sum(votes_by_candidate.values())
            for candidate in candidates:
                votes = votes_by_candidate[candidate.tse_candidate_id]
                db.add(
                    MunicipalityElectionResult(
                        contest_id=contest.id,
                        candidate_id=candidate.id,
                        municipality_ibge_code=ibge_code,
                        votes=votes,
                        valid_votes=valid_votes,
                        share_pct=votes / valid_votes * 100,
                        won_municipality=votes == max(votes_by_candidate.values()),
                    )
                )
        db.commit()


def test_import_party_spectrum_persists_waves_aliases_and_records_run():
    import_spectrum_registry()

    payload = json.loads(SPECTRUM_SOURCE.read_text(encoding="utf-8"))
    expected_scores = sum(
        1
        for party in payload["parties"]
        for score in party["scores"].values()
        if score is not None
    )
    expected_aliases = sum(len(party["aliases"]) for party in payload["parties"])
    with SessionLocal() as db:
        assert (
            db.scalar(select(func.count()).select_from(PartySpectrumScore))
            == expected_scores
        )
        assert db.scalar(select(func.count()).select_from(PartyAlias)) == expected_aliases
        assert db.scalar(
            select(PartyAlias.party_code).where(PartyAlias.alias == "PR")
        ) == "PL"
        assert db.scalar(
            select(PartyAlias.party_code).where(PartyAlias.alias == "PRB")
        ) == "REPUBLICANOS"
        assert (
            db.scalar(
                select(PartySpectrumScore.score).where(
                    PartySpectrumScore.party_code == "PT",
                    PartySpectrumScore.wave_year == 2022,
                )
            )
            == 2.68
        )
        assert not db.scalar(
            select(func.count())
            .select_from(PartySpectrumScore)
            .where(
                PartySpectrumScore.party_code == "PSL",
                PartySpectrumScore.wave_year == 2022,
            )
        )
        derived = db.scalar(
            select(PartySpectrumScore).where(
                PartySpectrumScore.party_code == "UNIAO",
                PartySpectrumScore.wave_year == 2018,
            )
        )
        assert derived is not None
        assert derived.is_derived is True
        assert derived.derived_from == ["DEM", "PSL"]
        assert derived.block == "right"
        import_run = db.scalar(select(ImportRun).where(ImportRun.source == "party_spectrum"))
        assert import_run is not None
        assert import_run.status == "succeeded"
        assert import_run.row_count == expected_scores
        assert len(import_run.checksum_sha256 or "") == 64


def test_import_party_spectrum_rejects_score_outside_scale(tmp_path: Path):
    def raise_score(payload: dict) -> None:
        payload["parties"][0]["scores"]["2022"] = 10.4

    source = write_spectrum_variant(tmp_path, raise_score)
    with pytest.raises(SystemExit, match="fora do intervalo"):
        import_party_spectrum(Namespace(file=str(source)))

    with SessionLocal() as db:
        assert not db.scalar(select(func.count()).select_from(PartySpectrumScore))


def test_import_party_spectrum_rejects_alias_shared_by_two_parties(tmp_path: Path):
    def duplicate_alias(payload: dict) -> None:
        payload["parties"][1]["aliases"].append("PSTU")

    source = write_spectrum_variant(tmp_path, duplicate_alias)
    with pytest.raises(SystemExit, match="aponta para dois partidos"):
        import_party_spectrum(Namespace(file=str(source)))


def test_import_party_spectrum_rejects_incoherent_block_thresholds(tmp_path: Path):
    def invert_thresholds(payload: dict) -> None:
        payload["metadata"]["blockThresholds"]["leftMaximum"] = 6.0

    source = write_spectrum_variant(tmp_path, invert_thresholds)
    with pytest.raises(SystemExit, match="Limiares incoerentes"):
        import_party_spectrum(Namespace(file=str(source)))


def test_import_party_spectrum_rejects_unknown_derived_party(tmp_path: Path):
    def unknown_origin(payload: dict) -> None:
        for party in payload["parties"]:
            if party["code"] == "UNIAO":
                party["derivedFrom"]["2018"] = ["DEM", "PFL"]

    source = write_spectrum_variant(tmp_path, unknown_origin)
    with pytest.raises(SystemExit, match="não existe no registro"):
        import_party_spectrum(Namespace(file=str(source)))


def test_import_party_spectrum_rejects_unsupported_schema_version(tmp_path: Path):
    def bump_schema(payload: dict) -> None:
        payload["metadata"]["schemaVersion"] = 99

    source = write_spectrum_variant(tmp_path, bump_schema)
    with pytest.raises(SystemExit, match="Versão de schema não suportada"):
        import_party_spectrum(Namespace(file=str(source)))


def test_spectrum_endpoints_require_authentication(client: TestClient):
    import_spectrum_registry()

    assert client.get("/api/v1/spectrum/parties").status_code == 401
    assert client.get("/api/v1/spectrum/contests").status_code == 401
    assert (
        client.get("/api/v1/spectrum/municipalities", params={"contest_id": "2022-1-1"})
    ).status_code == 401


def test_spectrum_registry_and_contests_expose_waves(client: TestClient, admin_user: User):
    import_spectrum_registry()
    seed_spectrum_election_sample()
    login_admin(client)

    registry = client.get("/api/v1/spectrum/parties")
    assert registry.status_code == 200
    body = registry.json()
    assert body["schema_version"] == 1
    assert body["block_thresholds"] == {
        "left_maximum": 4.5,
        "right_minimum": 5.5,
        "rationale": body["block_thresholds"]["rationale"],
    }
    assert body["wave_by_election_year"] == {"2018": 2018, "2020": 2018, "2022": 2022, "2024": 2022}
    assert [wave["year"] for wave in body["waves"]] == [2018, 2022]
    assert body["limitations"]
    parties = {party["code"]: party for party in body["parties"]}
    assert "PR" in parties["PL"]["aliases"]
    assert [score["wave_year"] for score in parties["PSL"]["scores"]] == [2018]
    assert parties["PT"]["scores"][-1]["block"] == "left"

    contests = client.get("/api/v1/spectrum/contests")
    assert contests.status_code == 200
    assert contests.json() == [
        {
            "contest_id": "2022-1-1",
            "election_year": 2022,
            "office_code": 1,
            "office_name": "Presidente",
            "round_number": 1,
            "election_date": "02/10/2022",
            "state_valid_votes": 400,
            "municipality_count": 2,
            "wave_year": 2022,
        }
    ]


def test_spectrum_municipal_index_ignores_parties_without_score(
    client: TestClient, admin_user: User
):
    import_spectrum_registry()
    seed_spectrum_election_sample()
    login_admin(client)

    response = client.get(
        "/api/v1/spectrum/municipalities", params={"contest_id": "2022-1-1"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["wave_year"] == 2022
    assert body["coverage_count"] == 2
    assert body["missing_count"] == 0
    items = {item["ibge_code"]: item for item in body["items"]}

    # Porto Alegre: PT 100 votos com nota 2,68 e PL 60 votos com nota 8,80.
    # (100 × 2,68 + 60 × 8,80) ÷ 160 = 796 ÷ 160 = 4,975.
    porto_alegre = items["4314902"]
    assert porto_alegre["spectrum_index"] == pytest.approx(4.975)
    assert porto_alegre["total_votes"] == 200
    assert porto_alegre["scored_votes"] == 160
    # PSL (sem nota em 2022) e ACCORSI (fora do registro) ficam fora do índice.
    assert porto_alegre["unscored_votes"] == 40
    assert porto_alegre["coverage_pct"] == pytest.approx(80.0)
    assert porto_alegre["blocks"]["left_votes"] == 100
    assert porto_alegre["blocks"]["center_votes"] == 0
    assert porto_alegre["blocks"]["right_votes"] == 60
    assert porto_alegre["blocks"]["left_pct"] == pytest.approx(62.5)
    assert porto_alegre["blocks"]["right_pct"] == pytest.approx(37.5)
    assert porto_alegre["unscored_parties"] == [
        {"party": "PSL", "votes": 30},
        {"party": "ACCORSI", "votes": 10},
    ]

    # Canoas: (60 × 2,68 + 60 × 8,80) ÷ 120 = 688,8 ÷ 120 = 5,74.
    canoas = items["4304606"]
    assert canoas["spectrum_index"] == pytest.approx(5.74)
    assert canoas["scored_votes"] == 120
    assert canoas["unscored_votes"] == 80
    assert canoas["coverage_pct"] == pytest.approx(60.0)
    assert canoas["unscored_parties"] == [
        {"party": "PSL", "votes": 50},
        {"party": "ACCORSI", "votes": 30},
    ]


def test_spectrum_municipalities_rejects_unknown_contest(client: TestClient, admin_user: User):
    import_spectrum_registry()
    login_admin(client)

    missing = client.get(
        "/api/v1/spectrum/municipalities", params={"contest_id": "inexistente"}
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Pleito não encontrado."


def test_spectrum_requires_imported_registry(client: TestClient, admin_user: User):
    seed_spectrum_election_sample()
    login_admin(client)

    response = client.get("/api/v1/spectrum/parties")
    assert response.status_code == 404
    assert response.json()["detail"] == "O espectro partidário ainda não foi importado."
