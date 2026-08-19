import type {
  PollingPlacesDataset,
  PollingVotesDataset,
} from "../types/pollingPlaces";
import {
  parsePollingPlacesDataset,
  parsePollingVotesDataset,
} from "./pollingPlaces.ts";
import { STATE_UF } from "./state.ts";

/**
 * CARREGAMENTO SOB DEMANDA dos arquivos da camada submunicipal.
 *
 * Os arquivos de locais e de votos somam vários MB e não podem entrar no
 * bundle principal: `import.meta.glob` sem `eager` gera um chunk por JSON,
 * buscado só quando a camada é ativada (locais) ou o pleito é escolhido
 * (votos), com cache de módulo.
 *
 * Sem ETL rodado, o glob não casa com nenhum arquivo (ou casa com o
 * placeholder vazio) e os carregadores devolvem `null`.
 */
type JsonLoader = () => Promise<unknown>;

const placesModules = import.meta.glob("../data/polling/places-*.json", {
  import: "default",
}) as Record<string, JsonLoader>;

const votesModules = import.meta.glob("../data/polling/votes-*.json", {
  import: "default",
}) as Record<string, JsonLoader>;

/**
 * GANCHO DE MALHA DE BAIRROS (hoje sempre falso). Não existe polígono de
 * bairro no projeto. Se um `src/data/neighborhoods-{ibge}.geojson` for
 * adicionado, este glob passa a encontrá-lo e a camada pode pintar o polígono
 * em vez da bolha agregada.
 */
const neighborhoodMeshModules = import.meta.glob(
  "../data/neighborhoods-*.geojson",
  { query: "?raw", import: "default" },
) as Record<string, JsonLoader>;

export function hasNeighborhoodMesh(ibgeCode: string) {
  return `../data/neighborhoods-${ibgeCode}.geojson` in neighborhoodMeshModules;
}

const placesCache = new Map<string, PollingPlacesDataset | null>();
const votesCache = new Map<string, PollingVotesDataset | null>();
const placesRequests = new Map<string, Promise<PollingPlacesDataset | null>>();
const votesRequests = new Map<string, Promise<PollingVotesDataset | null>>();

export function getCachedPollingPlaces(state = STATE_UF) {
  return placesCache.get(state) ?? null;
}

export function getCachedPollingVotes(contestId: string) {
  return votesCache.get(contestId) ?? null;
}

export async function loadPollingPlaces(
  state = STATE_UF,
): Promise<PollingPlacesDataset | null> {
  if (placesCache.has(state)) return placesCache.get(state) ?? null;
  const pending = placesRequests.get(state);
  if (pending) return pending;
  const loader = placesModules[`../data/polling/places-${state}.json`];
  const request = (loader ? loader() : Promise.resolve(null))
    .then((value) => {
      const dataset = parsePollingPlacesDataset(value);
      placesCache.set(state, dataset);
      return dataset;
    })
    .catch(() => {
      placesCache.set(state, null);
      return null;
    })
    .finally(() => {
      placesRequests.delete(state);
    });
  placesRequests.set(state, request);
  return request;
}

export async function loadPollingVotes(
  contestId: string,
): Promise<PollingVotesDataset | null> {
  if (!contestId) return null;
  if (votesCache.has(contestId)) return votesCache.get(contestId) ?? null;
  const pending = votesRequests.get(contestId);
  if (pending) return pending;
  const loader = votesModules[`../data/polling/votes-${contestId}.json`];
  const request = (loader ? loader() : Promise.resolve(null))
    .then((value) => {
      const dataset = parsePollingVotesDataset(value);
      votesCache.set(contestId, dataset);
      return dataset;
    })
    .catch(() => {
      votesCache.set(contestId, null);
      return null;
    })
    .finally(() => {
      votesRequests.delete(contestId);
    });
  votesRequests.set(contestId, request);
  return request;
}
