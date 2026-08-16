import { useCallback, useEffect, useState } from "react";
import type {
  AnalysisBand,
  AnalysisMetricId,
  AnalysisSortDirection,
} from "../types/analysis";
import {
  ALL_ANALYSIS_BANDS,
  getDefaultAnalysisState,
  sanitizeAnalysisState,
  toggleAnalysisBand,
} from "../utils/analysis";

const ANALYSIS_STORAGE_KEY = "acqr:territorial-analysis:v1";

function readAnalysisState() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ANALYSIS_STORAGE_KEY);
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function writeAnalysisState(value: unknown) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // O mapa continua funcional quando o armazenamento está indisponível.
  }
}

export function useTerritorialAnalysis(initialState?: unknown) {
  const [state, setState] = useState(() =>
    sanitizeAnalysisState(
      initialState === undefined ? readAnalysisState() : initialState,
    ),
  );

  useEffect(() => writeAnalysisState(state), [state]);

  const setMetricId = useCallback((metricId: AnalysisMetricId) => {
    setState((current) => ({ ...current, metricId }));
  }, []);

  const setSortDirection = useCallback(
    (sortDirection: AnalysisSortDirection) => {
      setState((current) => ({ ...current, sortDirection }));
    },
    [],
  );

  const toggleBand = useCallback((band: AnalysisBand) => {
    setState((current) => ({
      ...current,
      activeBands: toggleAnalysisBand(current.activeBands, band),
    }));
  }, []);

  const showAllBands = useCallback(() => {
    setState((current) => ({
      ...current,
      activeBands: [...ALL_ANALYSIS_BANDS],
    }));
  }, []);

  const resetAnalysis = useCallback(() => setState(getDefaultAnalysisState()), []);

  return {
    state,
    setMetricId,
    setSortDirection,
    toggleBand,
    showAllBands,
    resetAnalysis,
  };
}
