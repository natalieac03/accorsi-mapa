import { useEffect, useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../types/analysis";
import type {
  ElectionDataset,
  ElectionMetricId,
  ElectionState,
} from "../types/elections";
import {
  changeElectionCandidate,
  changeElectionComparisonContest,
  changeElectionContest,
  getDefaultElectionState,
  sanitizeElectionState,
  toggleElectionBand,
} from "../utils/elections";

const STORAGE_KEY = "acqr:election-history:v1";

function readStoredState(dataset: ElectionDataset) {
  if (typeof window === "undefined") return getDefaultElectionState(dataset);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitizeElectionState(raw ? JSON.parse(raw) : null, dataset);
  } catch {
    return getDefaultElectionState(dataset);
  }
}

export function useElectionHistory(dataset: ElectionDataset) {
  const [state, setState] = useState<ElectionState>(() => readStoredState(dataset));

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A preferência continua válida durante a sessão.
    }
  }, [state]);

  return {
    state,
    setContestId: (contestId: string) =>
      setState((current) => changeElectionContest(current, contestId, dataset)),
    setCandidateId: (candidateId: string) =>
      setState((current) => changeElectionCandidate(current, candidateId, dataset)),
    setMetricId: (metricId: ElectionMetricId) =>
      setState((current) => ({ ...current, metricId })),
    setComparisonContestId: (contestId: string) =>
      setState((current) =>
        changeElectionComparisonContest(current, contestId, dataset),
      ),
    setComparisonCandidateId: (candidateId: string) =>
      setState((current) => {
        const contest =
          dataset.contests.find(
            (item) => item.id === current.comparisonContestId,
          ) ?? dataset.contests[0];
        const candidate = contest.candidates.find(
          (item) => item.id === candidateId,
        );
        return candidate
          ? { ...current, comparisonCandidateId: candidate.id }
          : current;
      }),
    toggleBand: (band: AnalysisBand) =>
      setState((current) => ({
        ...current,
        activeBands: toggleElectionBand(current.activeBands, band),
      })),
    showAllBands: () =>
      setState((current) => ({ ...current, activeBands: [0, 1, 2, 3, 4] })),
    setSortDirection: (sortDirection: AnalysisSortDirection) =>
      setState((current) => ({ ...current, sortDirection })),
    reset: () => setState(getDefaultElectionState(dataset)),
  };
}
