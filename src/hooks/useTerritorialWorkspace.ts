import { useCallback, useEffect, useState } from "react";
import type { MunicipalitySelectionEvent } from "../types/workspace";
import {
  addComparisonId,
  addHistoryEntry,
  MAX_COMPARISON_ITEMS,
  removeMunicipalityId,
  sanitizeHistoryEntries,
  sanitizeMunicipalityIds,
  toggleMunicipalityId,
} from "../utils/workspace";

const HISTORY_STORAGE_KEY = "acqr:municipality-history:v1";
const FAVORITES_STORAGE_KEY = "acqr:municipality-favorites:v1";
const COMPARISON_STORAGE_KEY = "acqr:municipality-comparison:v1";

function readStorage(key: string) {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A interface continua funcional quando o armazenamento está indisponível.
  }
}

export function useTerritorialWorkspace(validIds: ReadonlySet<string>) {
  const [history, setHistory] = useState(() =>
    sanitizeHistoryEntries(readStorage(HISTORY_STORAGE_KEY), validIds),
  );
  const [favorites, setFavorites] = useState(() =>
    sanitizeMunicipalityIds(readStorage(FAVORITES_STORAGE_KEY), validIds),
  );
  const [comparison, setComparison] = useState(() =>
    sanitizeMunicipalityIds(
      readStorage(COMPARISON_STORAGE_KEY),
      validIds,
      MAX_COMPARISON_ITEMS,
    ),
  );

  useEffect(() => writeStorage(HISTORY_STORAGE_KEY, history), [history]);
  useEffect(() => writeStorage(FAVORITES_STORAGE_KEY, favorites), [favorites]);
  useEffect(
    () => writeStorage(COMPARISON_STORAGE_KEY, comparison),
    [comparison],
  );

  const recordVisit = useCallback((event: MunicipalitySelectionEvent) => {
    setHistory((current) => addHistoryEntry(current, event));
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((current) => toggleMunicipalityId(current, id));
  }, []);

  const addToComparison = useCallback((id: string) => {
    setComparison((current) => addComparisonId(current, id));
  }, []);

  const removeFromComparison = useCallback((id: string) => {
    setComparison((current) => removeMunicipalityId(current, id));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);
  const clearComparison = useCallback(() => setComparison([]), []);

  return {
    history,
    favorites,
    comparison,
    recordVisit,
    toggleFavorite,
    addToComparison,
    removeFromComparison,
    clearHistory,
    clearComparison,
  };
}
