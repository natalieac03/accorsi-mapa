from __future__ import annotations

from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ...database import get_db
from ...dependencies import AuthContext, get_auth_context
from ...models import (
    ElectionCandidate,
    ElectionContest,
    Municipality,
    MunicipalityElectionResult,
)
from ...schemas import (
    ElectionCandidateMunicipalitySeries,
    ElectionCandidateOut,
    ElectionContestOut,
    ElectionMunicipalityValue,
    MunicipalityElectionCandidateResult,
    MunicipalityElectionContestResult,
    MunicipalityElectionHistory,
)

router = APIRouter(tags=["elections"])


@router.get("/elections", response_model=list[ElectionContestOut])
def list_election_contests(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ElectionContest]:
    return list(
        db.scalars(
            select(ElectionContest)
            .options(selectinload(ElectionContest.candidates))
            .order_by(
                ElectionContest.election_year.desc(),
                ElectionContest.office_code,
                ElectionContest.round_number,
            )
        )
    )


@router.get(
    "/elections/{contest_id}/candidates/{tse_candidate_id}/municipalities",
    response_model=ElectionCandidateMunicipalitySeries,
)
def list_candidate_municipality_series(
    contest_id: str,
    tse_candidate_id: str,
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> ElectionCandidateMunicipalitySeries:
    contest = db.scalar(
        select(ElectionContest)
        .options(selectinload(ElectionContest.candidates))
        .where(ElectionContest.id == contest_id)
    )
    if not contest:
        raise HTTPException(status_code=404, detail="Pleito não encontrado.")
    candidate = db.scalar(
        select(ElectionCandidate).where(
            ElectionCandidate.contest_id == contest_id,
            ElectionCandidate.tse_candidate_id == tse_candidate_id,
        )
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidatura não encontrada no pleito.")

    rows = db.execute(
        select(MunicipalityElectionResult, Municipality.name)
        .join(
            Municipality,
            Municipality.ibge_code
            == MunicipalityElectionResult.municipality_ibge_code,
        )
        .where(MunicipalityElectionResult.candidate_id == candidate.id)
        .order_by(Municipality.name)
    )
    items = [
        ElectionMunicipalityValue(
            ibge_code=result.municipality_ibge_code,
            municipality_name=name,
            votes=result.votes,
            valid_votes=result.valid_votes,
            share_pct=result.share_pct,
            won_municipality=result.won_municipality,
        )
        for result, name in rows
    ]
    return ElectionCandidateMunicipalitySeries(
        contest=ElectionContestOut.model_validate(contest),
        candidate=ElectionCandidateOut.model_validate(candidate),
        coverage_count=len(items),
        items=items,
    )


@router.get(
    "/municipalities/{ibge_code}/elections",
    response_model=MunicipalityElectionHistory,
)
def get_municipality_election_history(
    ibge_code: str,
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> MunicipalityElectionHistory:
    municipality = db.get(Municipality, ibge_code)
    if not municipality:
        raise HTTPException(status_code=404, detail="Município não encontrado.")

    rows = db.execute(
        select(ElectionContest, ElectionCandidate, MunicipalityElectionResult)
        .join(ElectionCandidate, ElectionCandidate.contest_id == ElectionContest.id)
        .join(
            MunicipalityElectionResult,
            MunicipalityElectionResult.candidate_id == ElectionCandidate.id,
        )
        .where(MunicipalityElectionResult.municipality_ibge_code == ibge_code)
        .order_by(
            ElectionContest.election_year.desc(),
            ElectionContest.office_code,
            ElectionContest.round_number,
            ElectionCandidate.state_rank,
        )
    )
    grouped: dict[str, list[MunicipalityElectionCandidateResult]] = defaultdict(list)
    contests: dict[str, ElectionContest] = {}
    for contest, candidate, result in rows:
        contests[contest.id] = contest
        grouped[contest.id].append(
            MunicipalityElectionCandidateResult(
                candidate=ElectionCandidateOut.model_validate(candidate),
                votes=result.votes,
                valid_votes=result.valid_votes,
                share_pct=result.share_pct,
                won_municipality=result.won_municipality,
            )
        )

    return MunicipalityElectionHistory(
        ibge_code=municipality.ibge_code,
        municipality_name=municipality.name,
        contests=[
            MunicipalityElectionContestResult(
                contest_id=contest.id,
                election_year=contest.election_year,
                office_name=contest.office_name,
                round_number=contest.round_number,
                election_date=contest.election_date,
                results=grouped[contest.id],
            )
            for contest in contests.values()
        ],
    )
