import { useCallback, useEffect, useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../types/analysis";
import type {
  RegistrationFollowUpStatus,
  RegistrationMetricId,
  RegistrationSource,
  RegistrationWindow,
} from "../types/registrations";
import {
  getDefaultRegistrationState,
  sanitizeRegistrationState,
  toggleRegistrationBand,
} from "../utils/registrations";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";

const STORAGE_KEY = "acqr:registration-analysis:v1";

function readState() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
  } catch {
    return null;
  }
}

export function useRegistrationAnalysis() {
  const [state, setState] = useState(() => sanitizeRegistrationState(readState()));

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // O filtro continua válido durante a sessão.
    }
  }, [state]);

  const toggleSource = useCallback((source: RegistrationSource) => {
    setState((current) => {
      const sources = current.sources.includes(source)
        ? current.sources.filter((item) => item !== source)
        : [...current.sources, source];
      return sources.length > 0 ? { ...current, sources } : current;
    });
  }, []);

  const toggleStatus = useCallback((status: RegistrationFollowUpStatus) => {
    setState((current) => {
      const statuses = current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status];
      return statuses.length > 0 ? { ...current, statuses } : current;
    });
  }, []);

  return {
    state,
    setMetricId: (metricId: RegistrationMetricId) =>
      setState((current) => ({ ...current, metricId })),
    setWindow: (window: RegistrationWindow) =>
      setState((current) => ({ ...current, window })),
    setGeography: (
      municipalityId: string | null,
      neighborhood: string | null = null,
      cepPrefix: string | null = null,
    ) =>
      setState((current) => ({
        ...current,
        municipalityId,
        neighborhood: municipalityId ? neighborhood : null,
        cepPrefix: municipalityId ? cepPrefix : null,
      })),
    toggleSource,
    toggleStatus,
    toggleBand: (band: AnalysisBand) =>
      setState((current) => ({
        ...current,
        activeBands: toggleRegistrationBand(current.activeBands, band),
      })),
    showAllBands: () =>
      setState((current) => ({ ...current, activeBands: [...ALL_ANALYSIS_BANDS] })),
    setSortDirection: (sortDirection: AnalysisSortDirection) =>
      setState((current) => ({ ...current, sortDirection })),
    reset: () => setState(getDefaultRegistrationState()),
  };
}
