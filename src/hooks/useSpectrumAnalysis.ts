import { useCallback, useEffect, useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../types/analysis";
import type {
  SpectrumBandMode,
  SpectrumMetricId,
  SpectrumSourceContest,
  SpectrumState,
} from "../types/spectrum";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import {
  getDefaultSpectrumState,
  sanitizeSpectrumState,
  toggleSpectrumBand,
} from "../utils/spectrum";

const SPECTRUM_STORAGE_KEY = "acqr:spectrum:v1";

function readSpectrumState() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(SPECTRUM_STORAGE_KEY);
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function writeSpectrumState(value: unknown) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SPECTRUM_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // O mapa continua funcional quando o armazenamento está indisponível.
  }
}

export function useSpectrumAnalysis(contests: SpectrumSourceContest[]) {
  const [state, setState] = useState<SpectrumState>(() =>
    sanitizeSpectrumState(readSpectrumState(), contests),
  );

  useEffect(() => writeSpectrumState(state), [state]);

  const setContestId = useCallback((contestId: string) => {
    setState((current) => ({
      ...current,
      contestId,
      // O pleito analisado nunca pode ser também o de comparação.
      comparisonContestId:
        current.comparisonContestId === contestId
          ? null
          : current.comparisonContestId,
    }));
  }, []);

  const setComparisonContestId = useCallback(
    (comparisonContestId: string | null) => {
      setState((current) => ({
        ...current,
        comparisonContestId:
          comparisonContestId === current.contestId ? null : comparisonContestId,
      }));
    },
    [],
  );

  const setMetricId = useCallback((metricId: SpectrumMetricId) => {
    setState((current) => ({ ...current, metricId }));
  }, []);

  const setBandMode = useCallback((bandMode: SpectrumBandMode) => {
    setState((current) => ({ ...current, bandMode }));
  }, []);

  const setSortDirection = useCallback((sortDirection: AnalysisSortDirection) => {
    setState((current) => ({ ...current, sortDirection }));
  }, []);

  const toggleBand = useCallback((band: AnalysisBand) => {
    setState((current) => ({
      ...current,
      activeBands: toggleSpectrumBand(current.activeBands, band),
    }));
  }, []);

  const showAllBands = useCallback(() => {
    setState((current) => ({ ...current, activeBands: [...ALL_ANALYSIS_BANDS] }));
  }, []);

  const reset = useCallback(
    () => setState(getDefaultSpectrumState(contests)),
    [contests],
  );

  return {
    state,
    setContestId,
    setComparisonContestId,
    setMetricId,
    setBandMode,
    setSortDirection,
    toggleBand,
    showAllBands,
    reset,
  };
}
