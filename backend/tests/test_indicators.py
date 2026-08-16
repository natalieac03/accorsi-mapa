from __future__ import annotations

from conftest import login_admin
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import (
    IndicatorDefinition,
    Municipality,
    MunicipalityIndicatorValue,
    User,
)


def seed_indicator_sample() -> None:
    with SessionLocal() as db:
        db.add_all(
            [
                Municipality(
                    ibge_code="4314902",
                    tse_code="88013",
                    name="Porto Alegre",
                    uf="GO",
                    electorate_2026=1_061_485,
                    state_rank=1,
                ),
                Municipality(
                    ibge_code="4304606",
                    tse_code="85873",
                    name="Canoas",
                    uf="GO",
                    electorate_2026=252_875,
                    state_rank=3,
                ),
            ]
        )
        db.add(
            IndicatorDefinition(
                code="populationEstimate",
                ibge_indicator_id=29171,
                label="População estimada",
                short_label="População estimada",
                description="Estimativa oficial.",
                unit="pessoas",
                value_format="integer",
                source_name="IBGE — Cidades e Estados",
                source_url="https://servicodados.ibge.gov.br/api/docs/pesquisas",
            )
        )
        db.flush()
        db.add_all(
            [
                MunicipalityIndicatorValue(
                    municipality_ibge_code="4314902",
                    indicator_code="populationEstimate",
                    reference_year=2025,
                    value=1_388_794,
                ),
                MunicipalityIndicatorValue(
                    municipality_ibge_code="4304606",
                    indicator_code="populationEstimate",
                    reference_year=2025,
                    value=359_840,
                ),
            ]
        )
        db.commit()


def test_indicator_catalog_bulk_series_and_municipality_detail(
    client: TestClient, admin_user: User
):
    seed_indicator_sample()
    login_admin(client)

    catalog = client.get("/api/v1/indicators")
    assert catalog.status_code == 200
    assert catalog.json()[0]["available_years"] == [2025]
    assert catalog.json()[0]["coverage_by_year"] == {"2025": 2}

    series = client.get("/api/v1/indicators/populationEstimate/municipalities")
    assert series.status_code == 200
    assert series.json()["reference_year"] == 2025
    assert series.json()["coverage_count"] == 2
    assert series.json()["missing_count"] == 0
    assert {item["municipality_name"] for item in series.json()["items"]} == {
        "Canoas",
        "Porto Alegre",
    }

    detail = client.get("/api/v1/municipalities/4314902/indicators")
    assert detail.status_code == 200
    assert detail.json()["municipality_name"] == "Porto Alegre"
    assert detail.json()["items"][0]["value"] == 1_388_794

    assert client.get("/api/v1/indicators/inexistente/municipalities").status_code == 404
