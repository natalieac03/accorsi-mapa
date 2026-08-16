import { useCallback, useEffect, useState } from "react";
import {
  addTerritorialSelectionIds,
  MAX_TERRITORIAL_SELECTION,
  sanitizeTerritorialSelectionIds,
  toggleTerritorialSelectionId,
} from "../utils/selection";

const SELECTION_STORAGE_KEY = "acqr:territorial-selection:v1";

function readSelectionState() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function writeSelectionState(value: unknown) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // O mapa continua funcional quando o armazenamento está indisponível.
  }
}

export function useTerritorialSelection(
  validIds: ReadonlySet<string>,
  sharedIds: string[] | null = null,
) {
  const [ids, setIds] = useState(() =>
    sanitizeTerritorialSelectionIds(
      sharedIds === null ? readSelectionState() : sharedIds,
      validIds,
    ),
  );
  const [mapMode, setMapMode] = useState(false);

  useEffect(() => writeSelectionState(ids), [ids]);

  const toggleId = useCallback((id: string) => {
    setIds((current) => toggleTerritorialSelectionId(current, id));
  }, []);

  const addIds = useCallback(
    (candidates: string[]) => {
      setIds((current) =>
        addTerritorialSelectionIds(current, candidates, validIds),
      );
    },
    [validIds],
  );

  const removeId = useCallback((id: string) => {
    setIds((current) => current.filter((candidate) => candidate !== id));
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    setMapMode(false);
  }, []);

  return {
    ids,
    mapMode,
    isFull: ids.length >= MAX_TERRITORIAL_SELECTION,
    toggleId,
    addIds,
    removeId,
    clear,
    setMapMode,
  };
}
