from __future__ import annotations

from conftest import login_admin
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import (
    ElectionCandidate,
    ElectionContest,
    Municipality,
    MunicipalityElectionResult,
    User,
)


def seed_election_sample() -> None:
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
            id="2022-1-2",
            election_year=2022,
            office_code=1,
            office_name="Presidente",
            round_number=2,
            election_date="30/10/2022",
            generated_at_source="01/11/2022",
            state_valid_votes=300,
            municipality_count=2,
            source_name="TSE — Dados Abertos",
            source_url="https://dadosabertos.tse.jus.br/dataset/resultados-2022",
        )
        db.add(contest)
        first = ElectionCandidate(
            id="2022-1-2:1",
            contest_id=contest.id,
            tse_candidate_id="1",
            number="13",
            ballot_name="Candidata A",
            full_name="Candidata A",
            party="PA",
            party_name="Partido A",
            registration_status="APTO",
            result_status="ELEITO",
            state_votes=180,
            state_share_pct=60,
            state_rank=1,
            municipalities_won=2,
        )
        second = ElectionCandidate(
            id="2022-1-2:2",
            contest_id=contest.id,
            tse_candidate_id="2",
            number="22",
            ballot_name="Candidato B",
            full_name="Candidato B",
            party="PB",
            party_name="Partido B",
            registration_status="APTO",
            result_status="NÃO ELEITO",
            state_votes=120,
            state_share_pct=40,
            state_rank=2,
            municipalities_won=0,
        )
        db.add_all([first, second])
        db.flush()
        db.add_all(
            [
                MunicipalityElectionResult(
                    contest_id=contest.id,
                    candidate_id=first.id,
                    municipality_ibge_code="4314902",
                    votes=100,
                    valid_votes=160,
                    share_pct=62.5,
                    won_municipality=True,
                ),
                MunicipalityElectionResult(
                    contest_id=contest.id,
                    candidate_id=second.id,
                    municipality_ibge_code="4314902",
                    votes=60,
                    valid_votes=160,
                    share_pct=37.5,
                    won_municipality=False,
                ),
                MunicipalityElectionResult(
                    contest_id=contest.id,
                    candidate_id=first.id,
                    municipality_ibge_code="4304606",
                    votes=80,
                    valid_votes=140,
                    share_pct=57.142857,
                    won_municipality=True,
                ),
                MunicipalityElectionResult(
                    contest_id=contest.id,
                    candidate_id=second.id,
                    municipality_ibge_code="4304606",
                    votes=60,
                    valid_votes=140,
                    share_pct=42.857143,
                    won_municipality=False,
                ),
            ]
        )
        db.commit()


def test_election_catalog_series_and_municipality_history(
    client: TestClient, admin_user: User
):
    seed_election_sample()
    login_admin(client)

    catalog = client.get("/api/v1/elections")
    assert catalog.status_code == 200
    assert catalog.json()[0]["election_year"] == 2022
    assert len(catalog.json()[0]["candidates"]) == 2

    series = client.get("/api/v1/elections/2022-1-2/candidates/1/municipalities")
    assert series.status_code == 200
    assert series.json()["coverage_count"] == 2
    assert series.json()["items"][0]["municipality_name"] == "Canoas"

    history = client.get("/api/v1/municipalities/4314902/elections")
    assert history.status_code == 200
    assert history.json()["municipality_name"] == "Porto Alegre"
    assert history.json()["contests"][0]["results"][0]["votes"] == 100

    missing = client.get("/api/v1/elections/inexistente/candidates/1/municipalities")
    assert missing.status_code == 404
