import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../types/analysis";
import type {
  PollingDataStatus,
  PollingPlace,
  PollingPlacesMetadata,
  PollingState,
  PollingViewMode,
} from "../types/pollingPlaces";
import type { SpectrumSourceContest } from "../types/spectrum";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import { loadPollingPlaces, loadPollingVotes } from "../utils/pollingData";
import {
  resetPollingLoadKey,
  runPollingLoad,
} from "../utils/pollingLoad";
import {
  getDefaultPollingState,
  getPollingContestId,
  sanitizePollingState,
  togglePollingBand,
} from "../utils/pollingPlaces";

const POLLING_STORAGE_KEY = "acqr:polling:v1";

function readPollingState() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(POLLING_STORAGE_KEY);
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function writePollingState(value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POLLING_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A camada continua funcional sem armazenamento local.
  }
}

/**
 * Estado da camada submunicipal + carregamento SOB DEMANDA dos dados.
 *
 * Nada é buscado enquanto `active` for falso: os locais só descem quando a
 * camada é aberta pela primeira vez, e os votos de um pleito só quando aquele
 * pleito é selecionado. `pollingData` mantém o cache em memória, então voltar
 * a um pleito já visto é instantâneo.
 */
export function usePollingPlaces(
  contests: SpectrumSourceContest[],
  active: boolean,
) {
  const [state, setState] = useState<PollingState>(() =>
    sanitizePollingState(readPollingState(), contests),
  );
  const [places, setPlaces] = useState<PollingPlace[]>([]);
  const [placesMetadata, setPlacesMetadata] =
    useState<PollingPlacesMetadata | null>(null);
  const [placesStatus, setPlacesStatus] = useState<PollingDataStatus>("idle");
  const [votes, setVotes] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const [votesStatus, setVotesStatus] = useState<PollingDataStatus>("idle");

  useEffect(() => writePollingState(state), [state]);

  const contest = useMemo(
    () =>
      contests.find((item) => item.id === state.contestId) ?? contests[0] ?? null,
    [contests, state.contestId],
  );
  const pollingContestId = contest ? getPollingContestId(contest) : "";

  // O status vive numa referência: se entrasse nas dependências, ligar o
  // "loading" recriaria o efeito, o cleanup cancelaria a promessa em voo e o
  // spinner nunca sairia da tela. Ver utils/pollingLoad.ts.
  const placesStatusRef = useRef<PollingDataStatus>("idle");

  useEffect(() => {
    if (!active) return;
    return runPollingLoad(placesStatusRef, () => loadPollingPlaces("rs"), {
      publish: setPlacesStatus,
      receive: (dataset) => {
        setPlacesMetadata(dataset?.metadata ?? null);
        setPlaces(dataset?.places ?? []);
        return dataset !== null && dataset.places.length > 0;
      },
      reject: () => setPlaces([]),
    });
  }, [active]);

  const votesStatusRef = useRef<PollingDataStatus>("idle");
  const votesContestRef = useRef("");

  useEffect(() => {
    if (!active || placesStatus !== "ready" || !pollingContestId) return;
    // Trocar de pleito é um pedido novo: o status volta para "idle" antes de
    // iniciar, senão o resultado do pleito anterior bloquearia o download.
    // Os votos antigos continuam na tela até os novos chegarem, como antes.
    resetPollingLoadKey(votesStatusRef, votesContestRef, pollingContestId);
    return runPollingLoad(
      votesStatusRef,
      () => loadPollingVotes(pollingContestId),
      {
        publish: setVotesStatus,
        receive: (dataset) => {
          setVotes(dataset?.votes ?? null);
          return dataset !== null;
        },
        reject: () => setVotes(null),
      },
    );
  }, [active, placesStatus, pollingContestId]);

  const setContestId = useCallback((contestId: string) => {
    setState((current) => ({ ...current, contestId }));
  }, []);

  const setViewMode = useCallback((viewMode: PollingViewMode) => {
    setState((current) => ({ ...current, viewMode }));
  }, []);

  // A sigla escolhida é a MEDIDA da camada: sigla vazia significa "volte para
  // o índice ideológico", e por isso é normalizada para null — assim o estado
  // guardado tem uma forma só para a mesma coisa. A escolha sobrevive à troca
  // de pleito; quem decide se ela ainda vale é o modelo, que só aceita sigla
  // com voto apurado no pleito atual.
  const setPartyCode = useCallback((partyCode: string | null) => {
    const next = partyCode ? partyCode : null;
    setState((current) =>
      current.partyCode === next ? current : { ...current, partyCode: next },
    );
  }, []);

  const setMunicipalityId = useCallback((municipalityId: string | null) => {
    setState((current) =>
      current.municipalityId === municipalityId
        ? current
        : { ...current, municipalityId },
    );
  }, []);

  const setSortDirection = useCallback((sortDirection: AnalysisSortDirection) => {
    setState((current) => ({ ...current, sortDirection }));
  }, []);

  const toggleBand = useCallback((band: AnalysisBand) => {
    setState((current) => ({
      ...current,
      activeBands: togglePollingBand(current.activeBands, band),
    }));
  }, []);

  const showAllBands = useCallback(() => {
    setState((current) => ({ ...current, activeBands: [...ALL_ANALYSIS_BANDS] }));
  }, []);

  const reset = useCallback(
    () => setState(getDefaultPollingState(contests)),
    [contests],
  );

  return {
    state,
    contest,
    places,
    placesMetadata,
    placesStatus,
    votes,
    votesStatus,
    setContestId,
    setViewMode,
    setPartyCode,
    setMunicipalityId,
    setSortDirection,
    toggleBand,
    showAllBands,
    reset,
  };
}
