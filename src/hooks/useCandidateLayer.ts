import { useCallback, useEffect, useState } from "react";
import type { AnalysisBand } from "../types/analysis";
import type {
  CandidateDataset,
  CandidateLayerState,
  CandidateRankingMetricId,
  ElectorateIndex,
} from "../types/candidate";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import {
  getDefaultCandidateLayerState,
  sanitizeCandidateLayerState,
  toggleCandidateLayerBand,
} from "../utils/candidateLayer";

/**
 * Estado compartilhado entre a aba "Accorsi" e a camada do mapa.
 *
 * Vive AQUI, e não dentro do painel, por dois motivos: o mapa precisa do
 * mesmo pleito e da mesma métrica que o painel mostra (um par de controles
 * só), e a aba é desmontada quando a pessoa troca de aba — com o estado local
 * antigo, sair e voltar perdia a escolha.
 */

const CANDIDATE_LAYER_STORAGE_KEY = "acqr:candidato:v1";

function readCandidateLayerState() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(CANDIDATE_LAYER_STORAGE_KEY);
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function writeCandidateLayerState(value: unknown) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      CANDIDATE_LAYER_STORAGE_KEY,
      JSON.stringify(value),
    );
  } catch {
    // O mapa continua funcional quando o armazenamento está indisponível.
  }
}

export function useCandidateLayer(
  dataset: CandidateDataset,
  electorateIndex: ElectorateIndex,
) {
  const [state, setState] = useState<CandidateLayerState>(() =>
    sanitizeCandidateLayerState(
      readCandidateLayerState(),
      dataset,
      electorateIndex,
    ),
  );

  useEffect(() => writeCandidateLayerState(state), [state]);

  const setContestId = useCallback((contestId: string) => {
    setState((current) => ({ ...current, contestId }));
  }, []);

  const setMetricId = useCallback((metricId: CandidateRankingMetricId) => {
    setState((current) => ({ ...current, metricId }));
  }, []);

  const toggleBand = useCallback((band: AnalysisBand) => {
    setState((current) => ({
      ...current,
      activeBands: toggleCandidateLayerBand(current.activeBands, band),
    }));
  }, []);

  const showAllBands = useCallback(() => {
    setState((current) => ({ ...current, activeBands: [...ALL_ANALYSIS_BANDS] }));
  }, []);

  const reset = useCallback(
    () => setState(getDefaultCandidateLayerState(dataset, electorateIndex)),
    [dataset, electorateIndex],
  );

  return { state, setContestId, setMetricId, toggleBand, showAllBands, reset };
}
