export type SelectionSource =
  | "map"
  | "municipality"
  | "cep"
  | "place"
  | "analysis"
  | "election"
  | "registration"
  | "spectrum"
  | "polling"
  | "selection"
  | "workspace";

export type MunicipalitySelectionEvent = {
  id: string;
  source: SelectionSource;
  visitedAt: number;
  sequence: number;
};

export type MunicipalityHistoryEntry = {
  id: string;
  source: SelectionSource;
  visitedAt: number;
};

export type SidebarTab =
  | "overview"
  | "analysis"
  | "elections"
  | "candidate"
  | "registrations"
  | "spectrum"
  | "polling"
  | "selection"
  | "compare"
  | "history";
