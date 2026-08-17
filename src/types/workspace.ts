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
  // Espaços reservados para módulos que ainda não recebem dado nenhum: mídia
  // paga (exportação do gerenciador de anúncios) e redes sociais (engajamento
  // por lugar). Ficam no tipo desde já para que a barra de abas, o uiBus e o
  // roteamento tratem os dois como abas de verdade, e não como caso especial.
  | "ads"
  | "social"
  | "spectrum"
  | "polling"
  | "selection"
  | "compare"
  | "history";
