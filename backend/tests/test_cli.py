from __future__ import annotations

import json
import json as _json
from argparse import Namespace
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.cli import (
    create_user,
    import_campaign_registration_demo,
    import_ibge_indicators,
    import_tse_history,
    seed_municipalities,
    set_password,
)
from app.database import SessionLocal
from app.models import (
    AuditLog,
    CampaignRegistration,
    ElectionCandidate,
    ElectionContest,
    ImportRun,
    IndicatorDefinition,
    Municipality,
    MunicipalityElectionResult,
    MunicipalityIndicatorValue,
    User,
)
from app.security import verify_password


# Esta instalação nasce sem dados: `src/data` só tem placeholders até alguém
# rodar `gerar_dados.sh`. Testes que dependem do snapshot real se declaram
# pulados com a instrução — e voltam a valer sozinhos quando o dado existir.
def _pendente(nome: str) -> bool:
    caminho = Path(__file__).parents[2] / "src" / "data" / nome
    if not caminho.is_file():
        return True
    metadados = _json.loads(caminho.read_text(encoding="utf-8")).get("metadata", {})
    return metadados.get("status") == "pendente" or metadados.get("municipalityCount") == 0


DADOS_PENDENTES = _pendente("electorate-go.json")
MOTIVO_PENDENTE = "dados de Goiás ainda não gerados — rode `bash gerar_dados.sh`"




@pytest.mark.skipif(DADOS_PENDENTES, reason=MOTIVO_PENDENTE)
def test_seed_municipalities_validates_totals_and_records_import():
    source = Path(__file__).parents[2] / "src/data/electorate-go.json"
    seed_municipalities(Namespace(file=str(source)))

    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Municipality)) == 246
        assert db.scalar(select(func.sum(Municipality.electorate_2026))) == 8_526_233
        import_run = db.scalar(select(ImportRun))
        assert import_run is not None
        assert import_run.status == "succeeded"
        assert import_run.row_count == 246
        assert len(import_run.checksum_sha256 or "") == 64


@pytest.mark.skipif(DADOS_PENDENTES, reason=MOTIVO_PENDENTE)
def test_cli_bootstrap_and_password_reset_are_audited(monkeypatch):
    monkeypatch.setenv("ACCORSI_TEST_PASSWORD", "Primeira-Senha-2026!")
    create_user(
        Namespace(
            email="bootstrap@acqr.test",
            name="  Admin   Inicial  ",
            role="admin",
            password_env="ACCORSI_TEST_PASSWORD",
        )
    )

    monkeypatch.setenv("ACCORSI_TEST_PASSWORD", "Segunda-Senha-2026!")
    set_password(
        Namespace(
            email="bootstrap@acqr.test",
            password_env="ACCORSI_TEST_PASSWORD",
        )
    )

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "bootstrap@acqr.test"))
        assert user is not None
        assert user.full_name == "Admin Inicial"
        assert verify_password("Segunda-Senha-2026!", user.password_hash)
        actions = set(db.scalars(select(AuditLog.action)))
        assert {"system.user_created", "system.password_reset"}.issubset(actions)


@pytest.mark.skipif(DADOS_PENDENTES, reason=MOTIVO_PENDENTE)
def test_import_ibge_indicators_preserves_years_and_official_gaps():
    project_root = Path(__file__).parents[2]
    seed_municipalities(Namespace(file=str(project_root / "src/data/electorate-go.json")))
    import_ibge_indicators(
        Namespace(file=str(project_root / "src/data/socioeconomic-go.json"))
    )

    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(IndicatorDefinition)) == 9
        assert (
            db.scalar(select(func.count()).select_from(MunicipalityIndicatorValue))
            == 4_468
        )
        population_years = set(
            db.scalars(
                select(MunicipalityIndicatorValue.reference_year).where(
                    MunicipalityIndicatorValue.indicator_code == "populationEstimate"
                )
            )
        )
        assert population_years == {2025}
        sanitation_count = db.scalar(
            select(func.count()).select_from(MunicipalityIndicatorValue).where(
                MunicipalityIndicatorValue.indicator_code == "adequateSanitation"
            )
        )
        assert sanitation_count == 493
        import_run = db.scalar(
            select(ImportRun).where(ImportRun.source == "ibge_socioeconomic")
        )
        assert import_run is not None
        assert import_run.status == "succeeded"
        assert import_run.row_count == 4_468


@pytest.mark.skipif(DADOS_PENDENTES, reason=MOTIVO_PENDENTE)
def test_import_tse_history_preserves_all_contests_and_municipal_series():
    project_root = Path(__file__).parents[2]
    seed_municipalities(Namespace(file=str(project_root / "src/data/electorate-go.json")))
    source = project_root / "src/data/election-history-go.json"
    import_tse_history(Namespace(file=str(source)))

    payload = json.loads(source.read_text(encoding="utf-8"))
    expected_values = sum(
        len(contest["candidates"]) * 246 for contest in payload["contests"]
    )
    with SessionLocal() as db:
        # Contagem derivada do snapshot: o conjunto de anos é configurável.
        assert db.scalar(select(func.count()).select_from(ElectionContest)) == len(
            payload["contests"]
        )
        assert db.scalar(select(func.count()).select_from(ElectionCandidate)) == sum(
            len(contest["candidates"]) for contest in payload["contests"]
        )
        assert (
            db.scalar(select(func.count()).select_from(MunicipalityElectionResult))
            == expected_values
        )
        import_run = db.scalar(
            select(ImportRun).where(ImportRun.source == "tse_election_history")
        )
        assert import_run is not None
        assert import_run.status == "succeeded"
        assert import_run.row_count == expected_values


@pytest.mark.skipif(DADOS_PENDENTES, reason=MOTIVO_PENDENTE)
def test_import_campaign_registration_demo_is_minimized_and_reproducible():
    project_root = Path(__file__).parents[2]
    seed_municipalities(Namespace(file=str(project_root / "src/data/electorate-go.json")))
    source = project_root / "src/data/campaign-registrations-demo.json"
    import_campaign_registration_demo(Namespace(file=str(source)))

    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(CampaignRegistration)) == 306
        assert set(db.scalars(select(CampaignRegistration.data_origin))) == {
            "synthetic-demo"
        }
        assert all(
            len(prefix) == 5 and prefix.isdigit()
            for prefix in db.scalars(select(CampaignRegistration.cep_prefix))
        )
        import_run = db.scalar(
            select(ImportRun).where(ImportRun.source == "campaign_registration_demo")
        )
        assert import_run is not None
        assert import_run.status == "succeeded"
        assert import_run.row_count == 306
