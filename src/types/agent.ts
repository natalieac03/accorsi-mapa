import type { ElectionDataset } from "./elections";
import type { MunicipalityProfile } from "./electorate";
import type { PollingPlacesDataset, PollingVotesDataset } from "./pollingPlaces";
import type { CampaignRegistration } from "./registrations";
import type { PartySpectrumRegistry, SpectrumSourceContest } from "./spectrum";
import type { PartySpectrumIndex } from "../utils/spectrum";

/**
 * CONTRATO DE RETORNO DO MOTOR DE CONSULTAS DO AGENTE.
 *
 * Toda ferramenta devolve a MESMA forma, porque quem lê é um modelo de
 * linguagem: um envelope com os dados, o total disponível, a fonte com o
 * recorte temporal e uma lista de avisos. O modelo nunca calcula nada — ele
 * escolhe a consulta e cita o que vier aqui.
 *
 * Disciplina de dado ausente: valor sem dado é `null`, JAMAIS 0, e a
 * quantidade de linhas sem dado sempre aparece em `avisos`. Truncamento
 * também é sempre declarado em `avisos` — nunca silencioso.
 */

export type OrdemFerramenta = "maiores" | "menores";

/** Procedência e recorte temporal do número devolvido. */
export type FonteFerramenta = {
  descricao: string;
  /** Ano de referência do indicador (Censo 2022, eleitorado 2026, ...). */
  ano?: number;
  /** Rótulo do pleito ("2022 · Governador · 2º turno"). */
  pleito?: string;
  /** Onda do survey de especialistas usada para as notas dos partidos. */
  ondaSurvey?: number;
  url?: string;
};

export type RespostaFerramentaOk<T> = {
  ok: true;
  /** Identificador do formato das linhas ("ranking_indicador", ...). */
  tipo: string;
  dados: T[];
  /** Linhas disponíveis ANTES do truncamento; `dados.length` pode ser menor. */
  total: number;
  fonte: FonteFerramenta;
  avisos: string[];
  /** Agregado do recorte (índice estadual, contagens, supressões). */
  resumo?: Record<string, unknown>;
};

export type RespostaFerramentaErro = {
  ok: false;
  motivo: string;
};

export type RespostaFerramenta<T = Record<string, unknown>> =
  | RespostaFerramentaOk<T>
  | RespostaFerramentaErro;

export type ArgumentosFerramenta = Record<string, unknown>;

/** Subconjunto de JSON Schema draft-07 que o validador próprio entende. */
export type EsquemaJson = {
  type?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, EsquemaJson>;
  required?: string[];
  additionalProperties?: boolean;
  items?: EsquemaJson;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

export type DefinicaoFerramenta = {
  name: string;
  description: string;
  parameters: EsquemaJson;
};

export type ContratoFerramentas = {
  schemaVersion: number;
  description?: string;
  tools: DefinicaoFerramenta[];
};

/**
 * Tudo que as ferramentas precisam para calcular, já nos mesmos formatos que
 * alimentam o mapa. Os carregadores da camada submunicipal são injetados
 * porque o download é assíncrono e sob demanda: fora do navegador (testes) o
 * contexto simplesmente não os traz e a ferramenta avisa a pendência.
 */
export type ContextoAgente = {
  municipios: MunicipalityProfile[];
  eleitoradoEstadual: number;
  anoEleitorado: number;
  fonteEleitorado: string;
  eleicoes: ElectionDataset;
  registroPartidos: PartySpectrumRegistry;
  indicePartidos: PartySpectrumIndex;
  /** Pleitos do espectro, do mais recente para o mais antigo. */
  pleitos: SpectrumSourceContest[];
  cadastros: CampaignRegistration[];
  cadastrosMetadados: {
    modo: string;
    dataReferencia: string;
    limiarPrivacidade: number;
    aviso?: string;
  } | null;
  carregarLocais?: (uf?: string) => Promise<PollingPlacesDataset | null>;
  carregarVotosPorLocal?: (
    idPleito: string,
  ) => Promise<PollingVotesDataset | null>;
};

/* --------------------------------------------------------------------------
 * Conversa: tipos da camada de chat (hook useDataAgent + interface).
 * Separados dos tipos de ferramenta acima porque descrevem o TRANSPORTE até o
 * modelo, não o resultado das consultas.
 * ------------------------------------------------------------------------ */

export type ChamadaFerramentaModelo = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** Formato de mensagem trocado com o relé /agent/chat (estilo OpenAI). */
export type MensagemAgente = {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ChamadaFerramentaModelo[] | null;
  tool_call_id?: string | null;
};

/** O que a interface exibe — sem o vaivém de ferramentas. */
export type MensagemChat = {
  autor: "usuario" | "agente";
  texto: string;
  /** Ferramentas consultadas para produzir a resposta, mostradas como procedência. */
  ferramentas: string[];
};

export type StatusAgente = {
  carregando: boolean;
  disponivel?: boolean;
  modelo?: string | null;
  motivo?: string;
};
