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

/**
 * Camadas que o mapa pode pintar. "candidato" é a da aba "Accorsi": o
 * desempenho nominal DELA por município, no pleito e na métrica escolhidos
 * naquele painel. Está nesta união para que a troca de camada passe por um
 * lugar só, inclusive o rebaixamento para a camada padrão quando o dado da
 * camada pedida ainda não foi gerado.
 */
export type MapLayerId =
  | "analysis"
  | "election"
  | "registration"
  | "spectrum"
  | "polling"
  | "candidato";

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
  // Reservados para módulos ainda sem dado: mídia paga (exportação do
  // gerenciador de anúncios) e redes sociais (engajamento por lugar). Ficam no
  // tipo para a barra de abas, o uiBus e o roteamento tratá-los como abas.
  | "ads"
  | "social"
  | "spectrum"
  | "polling"
  | "selection"
  | "compare"
  | "history";
