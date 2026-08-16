import type {
  MunicipalityHistoryEntry,
  MunicipalitySelectionEvent,
  SelectionSource,
} from "../types/workspace";

export const MAX_HISTORY_ITEMS = 12;
export const MAX_COMPARISON_ITEMS = 3;

const selectionSources = new Set<SelectionSource>([
  "map",
  "municipality",
  "cep",
  "place",
  "analysis",
  "election",
  "registration",
  "spectrum",
  "selection",
  "workspace",
]);

export function sanitizeMunicipalityIds(
  value: unknown,
  validIds: ReadonlySet<string>,
  maximum = Number.POSITIVE_INFINITY,
) {
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      validIds.has(item) &&
      !result.includes(item)
    ) {
      result.push(item);
    }

    if (result.length >= maximum) break;
  }

  return result;
}

export function sanitizeHistoryEntries(
  value: unknown,
  validIds: ReadonlySet<string>,
  maximum = MAX_HISTORY_ITEMS,
) {
  if (!Array.isArray(value)) return [];

  const result: MunicipalityHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      !validIds.has(candidate.id) ||
      typeof candidate.visitedAt !== "number" ||
      !Number.isFinite(candidate.visitedAt) ||
      typeof candidate.source !== "string" ||
      !selectionSources.has(candidate.source as SelectionSource) ||
      result.some((entry) => entry.id === candidate.id)
    ) {
      continue;
    }

    result.push({
      id: candidate.id,
      visitedAt: candidate.visitedAt,
      source: candidate.source as SelectionSource,
    });

    if (result.length >= maximum) break;
  }

  return result;
}

export function addHistoryEntry(
  history: MunicipalityHistoryEntry[],
  event: MunicipalitySelectionEvent,
  maximum = MAX_HISTORY_ITEMS,
) {
  return [
    {
      id: event.id,
      source: event.source,
      visitedAt: event.visitedAt,
    },
    ...history.filter((entry) => entry.id !== event.id),
  ].slice(0, maximum);
}

export function toggleMunicipalityId(ids: string[], id: string) {
  return ids.includes(id)
    ? ids.filter((candidate) => candidate !== id)
    : [id, ...ids];
}

export function addComparisonId(
  ids: string[],
  id: string,
  maximum = MAX_COMPARISON_ITEMS,
) {
  if (ids.includes(id) || ids.length >= maximum) return ids;
  return [...ids, id];
}

export function removeMunicipalityId(ids: string[], id: string) {
  return ids.filter((candidate) => candidate !== id);
}

export function getSelectionSourceLabel(source: SelectionSource) {
  const labels: Record<SelectionSource, string> = {
    map: "Clique no mapa",
    municipality: "Busca municipal",
    cep: "Busca por CEP",
    place: "Busca por endereço",
    analysis: "Análise territorial",
    election: "Histórico eleitoral",
    registration: "Cadastros da campanha",
    spectrum: "Espectro ideológico",
    polling: "Locais de votação",
    selection: "Recorte territorial",
    workspace: "Painel lateral",
  };

  return labels[source];
}

export function getTopElectoratePercent(rank: number, municipalityCount: number) {
  if (municipalityCount <= 0) return 100;
  return Math.max(1, Math.ceil((rank / municipalityCount) * 100));
}
