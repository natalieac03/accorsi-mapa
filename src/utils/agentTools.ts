import contratoJson from "../../shared/agent-tools.json" with { type: "json" };
import type { AgeStructureDataset } from "../types/ageStructure";
import type {
  AnalysisMetricId,
  AnalysisSortDirection,
} from "../types/analysis";
import type {
  ArgumentosFerramenta,
  ContextoAgente,
  ContratoFerramentas,
  DefinicaoFerramenta,
  EsquemaJson,
  FonteFerramenta,
  OrdemFerramenta,
  RespostaFerramenta,
} from "../types/agent";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateRankingMetricId,
  ElectorateSource,
} from "../types/candidate";
import type { ElectionDataset } from "../types/elections";
import type {
  ElectorateDataset,
  MunicipalityProfile,
} from "../types/electorate";
import type { LiteracyDataset } from "../types/literacy";
import type {
  PollingPlacesDataset,
  PollingVotesDataset,
} from "../types/pollingPlaces";
import type { CampaignRegistrationDataset } from "../types/registrations";
import type { SocioeconomicDataset } from "../types/socioeconomic";
import type {
  PartySpectrumRegistry,
  SpectrumBlock,
  SpectrumModel,
  SpectrumSourceContest,
} from "../types/spectrum";
import {
  ALL_ANALYSIS_BANDS,
  ANALYSIS_METRICS,
  formatAnalysisMetricValue,
  getAnalysisMetric,
  getAnalysisMetricValue,
  buildAnalysisModel,
} from "./analysis.ts";
import {
  buildElectorateIndex,
  buildMunicipioRanking,
  buildTrajectory,
  formatResultado,
  getBairros,
  getCandidateRankingMetric,
  getContestLabel,
  isCandidatePendente,
  listContestsComBairros,
} from "./candidate.ts";
import { getMunicipioDestaques, isMunicipalContest } from "./candidateStats.ts";
import { buildElectionModel, isElectionDatasetPendente } from "./elections.ts";
import {
  buildPollingModel,
  getPollingContestId,
  isPollingPlacesDatasetPending,
} from "./pollingPlaces.ts";
import {
  buildRegistrationModel,
  getDefaultRegistrationState,
  normalizeNeighborhoodKey,
} from "./registrations.ts";
import { normalizeSearchText, searchMunicipalities } from "./search.ts";
import { buildTerritorialDataset } from "./socioeconomic.ts";
import {
  buildPartySpectrumIndex,
  buildSpectrumContests,
  classifySpectrumBlock,
  getSpectrumContestLabel,
  SPECTRUM_BLOCK_LABELS,
  buildSpectrumModel,
  type PartyVotesDataset,
} from "./spectrum.ts";

/**
 * MOTOR DE CONSULTAS DO AGENTE DE PERGUNTAS.
 *
 * Regra de ouro: o modelo de linguagem NUNCA calcula estatística. Ele escolhe
 * a ferramenta e os argumentos; o cálculo acontece aqui REAPROVEITANDO os
 * motores que desenham o mapa (`buildAnalysisModel`, `buildSpectrumModel`,
 * `buildPollingModel`, `buildElectionModel`, `buildRegistrationModel`). Se o
 * número do chat divergir do número do mapa, é defeito — por isso nada é
 * recalculado por conta própria aqui, nem sequer a ordenação dos rankings.
 *
 * O contrato dos argumentos vem de `shared/agent-tools.json`, o MESMO arquivo
 * lido pelo backend: importá-lo (em vez de redeclarar os esquemas) é o que
 * impede a divergência entre as duas pontas.
 */

const contrato = contratoJson as unknown as ContratoFerramentas;

export const FERRAMENTAS_AGENTE: DefinicaoFerramenta[] = contrato.tools;
export const VERSAO_CONTRATO_FERRAMENTAS = contrato.schemaVersion;

/**
 * Teto defensivo de linhas por consulta. O retorno é lido por um modelo com
 * janela de contexto finita: acima disso a resposta come o contexto da
 * conversa. Truncar é permitido; truncar em silêncio, nunca.
 */
export const LIMITE_MAXIMO_LINHAS = 50;
const LIMITE_PADRAO_LINHAS = 10;

/**
 * Piso de k-anonimato dos cadastros de apoiadores. Mesmo que a base declare
 * um limiar menor, o agente nunca devolve grupo com menos de 5 pessoas.
 */
export const K_ANONIMATO_MINIMO = 5;

// ---------------------------------------------------------------------------
// Validação de argumentos (subconjunto de JSON Schema draft-07, sem dependência)
// ---------------------------------------------------------------------------

function tipoDoValor(valor: unknown) {
  if (valor === null) return "null";
  if (Array.isArray(valor)) return "array";
  return typeof valor;
}

function validarValor(
  valor: unknown,
  esquema: EsquemaJson,
  caminho: string,
  erros: string[],
) {
  const tipo = esquema.type;
  const encontrado = tipoDoValor(valor);

  if (tipo === "object") {
    if (encontrado !== "object") {
      erros.push(`${caminho} deveria ser um objeto, veio ${encontrado}`);
      return;
    }
    const registro = valor as Record<string, unknown>;
    for (const obrigatorio of esquema.required ?? []) {
      if (registro[obrigatorio] === undefined) {
        erros.push(`${caminho}${caminho ? "." : ""}${obrigatorio} é obrigatório`);
      }
    }
    if (esquema.additionalProperties === false) {
      for (const chave of Object.keys(registro)) {
        if (!esquema.properties || !(chave in esquema.properties)) {
          erros.push(
            `${caminho}${caminho ? "." : ""}${chave} não é um argumento aceito`,
          );
        }
      }
    }
    for (const [chave, subEsquema] of Object.entries(esquema.properties ?? {})) {
      if (registro[chave] === undefined) continue;
      validarValor(
        registro[chave],
        subEsquema,
        `${caminho}${caminho ? "." : ""}${chave}`,
        erros,
      );
    }
    return;
  }

  if (tipo === "array") {
    if (encontrado !== "array") {
      erros.push(`${caminho} deveria ser uma lista, veio ${encontrado}`);
      return;
    }
    const lista = valor as unknown[];
    if (esquema.minItems !== undefined && lista.length < esquema.minItems) {
      erros.push(`${caminho} precisa de pelo menos ${esquema.minItems} item(ns)`);
    }
    if (esquema.maxItems !== undefined && lista.length > esquema.maxItems) {
      erros.push(`${caminho} aceita no máximo ${esquema.maxItems} item(ns)`);
    }
    if (esquema.items) {
      lista.forEach((item, indice) =>
        validarValor(item, esquema.items as EsquemaJson, `${caminho}[${indice}]`, erros),
      );
    }
    return;
  }

  if (tipo === "integer" || tipo === "number") {
    if (naoEhNumeroFinito(valor)) {
      erros.push(`${caminho} deveria ser um número, veio ${encontrado}`);
      return;
    }
    const numero = valor as number;
    if (tipo === "integer" && !Number.isInteger(numero)) {
      erros.push(`${caminho} deveria ser um número inteiro`);
    }
    if (esquema.minimum !== undefined && numero < esquema.minimum) {
      erros.push(`${caminho} deveria ser no mínimo ${esquema.minimum}`);
    }
    if (esquema.maximum !== undefined && numero > esquema.maximum) {
      erros.push(`${caminho} deveria ser no máximo ${esquema.maximum}`);
    }
    return;
  }

  if (tipo === "string") {
    if (encontrado !== "string") {
      erros.push(`${caminho} deveria ser texto, veio ${encontrado}`);
      return;
    }
  }

  if (tipo === "boolean" && encontrado !== "boolean") {
    erros.push(`${caminho} deveria ser booleano, veio ${encontrado}`);
    return;
  }

  if (esquema.enum && !esquema.enum.includes(valor)) {
    erros.push(
      `${caminho} aceita apenas: ${esquema.enum.map(String).join(", ")}`,
    );
  }
}

function naoEhNumeroFinito(valor: unknown) {
  return typeof valor !== "number" || !Number.isFinite(valor);
}

/** Lista os erros do argumento; lista vazia = argumento válido. */
export function validarArgumentos(
  esquema: EsquemaJson,
  argumentos: unknown,
): string[] {
  const erros: string[] = [];
  validarValor(argumentos ?? {}, esquema, "", erros);
  return erros;
}

// ---------------------------------------------------------------------------
// Contexto: os mesmos dados que alimentam o mapa
// ---------------------------------------------------------------------------

export type EntradaContextoAgente = {
  eleitorado: ElectorateDataset;
  socioeconomico: SocioeconomicDataset;
  estruturaEtaria: AgeStructureDataset;
  alfabetizacao: LiteracyDataset;
  eleicoes: ElectionDataset;
  registroPartidos: PartySpectrumRegistry;
  /** Votos por partido das eleições municipais; ausente enquanto o ETL não roda. */
  votosPorPartido?: PartyVotesDataset | null;
  /**
   * Trajetória da candidatura em foco (src/data/candidato/<slug>.json). É o
   * mesmo arquivo da aba "Accorsi": sem ele o agente não sabe responder nada
   * sobre a votação dela — e era exatamente essa falta que fazia o modelo
   * explicar a própria limitação com uma ausência de dado inventada.
   */
  trajetoriaCandidata?: CandidateDataset | null;
  cadastros?: CampaignRegistrationDataset | null;
  carregarLocais?: (uf?: string) => Promise<PollingPlacesDataset | null>;
  carregarVotosPorLocal?: (
    idPleito: string,
  ) => Promise<PollingVotesDataset | null>;
};

/**
 * Monta o contexto do agente a partir dos MESMOS conjuntos que a interface
 * carrega, com as mesmas funções de junção — inclusive a validação de recorte
 * territorial de `buildTerritorialDataset`.
 */
export function criarContextoAgente(
  entrada: EntradaContextoAgente,
): ContextoAgente {
  const territorial = buildTerritorialDataset(
    entrada.eleitorado,
    entrada.socioeconomico,
    entrada.estruturaEtaria,
    entrada.alfabetizacao,
  );
  const indicePartidos = buildPartySpectrumIndex(entrada.registroPartidos);
  return {
    municipios: Object.values(territorial.municipalities),
    eleitoradoEstadual: territorial.metadata.stateElectorate,
    anoEleitorado: territorial.metadata.year,
    fonteEleitorado: territorial.metadata.source,
    eleicoes: entrada.eleicoes,
    registroPartidos: entrada.registroPartidos,
    indicePartidos,
    pleitos: buildSpectrumContests(
      entrada.eleicoes,
      entrada.votosPorPartido ?? null,
      entrada.registroPartidos,
    ),
    trajetoriaCandidata: entrada.trajetoriaCandidata ?? null,
    // Mesmo índice que a aba "Accorsi" usa no ranking municipal: null enquanto
    // o eleitorado for placeholder, para a métrica por 1.000 eleitores sumir
    // inteira em vez de sair com denominador inventado. A conversão em duas
    // etapas é a mesma que CandidatePanel e StatsWindow fazem: o campo
    // `metadata.status` só existe no placeholder e não está no tipo gerado.
    indiceEleitorado: buildElectorateIndex(
      entrada.eleitorado as unknown as ElectorateSource,
    ),
    cadastros: entrada.cadastros?.records ?? [],
    cadastrosMetadados: entrada.cadastros
      ? {
          modo: entrada.cadastros.metadata.mode,
          dataReferencia: entrada.cadastros.metadata.referenceDate,
          limiarPrivacidade: entrada.cadastros.metadata.privacyThreshold,
          aviso: entrada.cadastros.metadata.warning,
        }
      : null,
    carregarLocais: entrada.carregarLocais,
    carregarVotosPorLocal: entrada.carregarVotosPorLocal,
  };
}

// ---------------------------------------------------------------------------
// Utilidades comuns às ferramentas
// ---------------------------------------------------------------------------

function resolverOrdem(valor: unknown): OrdemFerramenta {
  return valor === "menores" ? "menores" : "maiores";
}

function direcaoDaOrdem(ordem: OrdemFerramenta): AnalysisSortDirection {
  return ordem === "menores" ? "asc" : "desc";
}

function resolverLimite(valor: unknown) {
  const numero =
    typeof valor === "number" && Number.isFinite(valor)
      ? Math.floor(valor)
      : LIMITE_PADRAO_LINHAS;
  return Math.max(1, Math.min(LIMITE_MAXIMO_LINHAS, numero));
}

/** Concordância de número, para os avisos não saírem com "1 bairros". */
function plural(quantidade: number, singular: string, plurais: string) {
  return quantidade === 1 ? singular : plurais;
}

/** Corta o retorno no limite e SEMPRE declara quantas linhas ficaram fora. */
function truncar<T>(
  linhas: T[],
  limite: number,
  avisos: string[],
  plurais: string,
) {
  const teto = Math.min(limite, LIMITE_MAXIMO_LINHAS);
  if (linhas.length <= teto) return linhas;
  const fora = linhas.length - teto;
  avisos.push(
    `Retorno truncado: mostrando ${teto} de ${linhas.length} ${plurais}; ${fora} ${plural(fora, "ficou", "ficaram")} de fora. Peça um limite maior (máximo ${LIMITE_MAXIMO_LINHAS}) ou refine o recorte.`,
  );
  return linhas.slice(0, teto);
}

export type MunicipioResolvido = {
  municipio: MunicipalityProfile;
  /** true quando o casamento foi por aproximação de nome, não exato. */
  aproximado: boolean;
};

/**
 * Resolve um município por código IBGE, código TSE ou nome (aceitando texto
 * sem acento e parcial, com a mesma busca da barra de pesquisa do mapa).
 */
export function resolverMunicipio(
  contexto: ContextoAgente,
  termo: string,
): MunicipioResolvido | null {
  const bruto = termo.trim();
  if (!bruto) return null;

  if (/^\d+$/.test(bruto)) {
    const porIbge = contexto.municipios.find(
      (municipio) => municipio.ibgeCode === bruto,
    );
    if (porIbge) return { municipio: porIbge, aproximado: false };
    const porTse = contexto.municipios.find(
      (municipio) => municipio.tseCode === bruto,
    );
    return porTse ? { municipio: porTse, aproximado: false } : null;
  }

  const alvo = normalizeSearchText(bruto);
  const exato = contexto.municipios.find(
    (municipio) => normalizeSearchText(municipio.name) === alvo,
  );
  if (exato) return { municipio: exato, aproximado: false };

  const [melhor] = searchMunicipalities(
    bruto,
    contexto.municipios.map((municipio) => ({
      id: municipio.ibgeCode,
      name: municipio.name,
      electorate: municipio.electorate,
    })),
    1,
  );
  if (!melhor) return null;
  const encontrado = contexto.municipios.find(
    (municipio) => municipio.ibgeCode === melhor.id,
  );
  return encontrado ? { municipio: encontrado, aproximado: true } : null;
}

/** Resolve uma lista de municípios, avisando o que não foi reconhecido. */
function resolverListaMunicipios(
  contexto: ContextoAgente,
  termos: string[],
  avisos: string[],
) {
  const encontrados: MunicipalityProfile[] = [];
  const naoEncontrados: string[] = [];
  for (const termo of termos) {
    const resolvido = resolverMunicipio(contexto, termo);
    if (!resolvido) {
      naoEncontrados.push(termo);
      continue;
    }
    if (resolvido.aproximado) {
      avisos.push(`Interpretei "${termo}" como ${resolvido.municipio.name}.`);
    }
    if (
      !encontrados.some(
        (municipio) => municipio.ibgeCode === resolvido.municipio.ibgeCode,
      )
    ) {
      encontrados.push(resolvido.municipio);
    }
  }
  if (naoEncontrados.length > 0) {
    avisos.push(
      `Município não encontrado em Goiás: ${naoEncontrados.join(", ")}.`,
    );
  }
  return {
    municipios: encontrados,
    codigos: new Set(encontrados.map((municipio) => municipio.ibgeCode)),
    naoEncontrados,
  };
}

/**
 * Resolve o pleito por identificador ("elections:2022-3-2", "2022-3-2") ou por
 * texto livre ("2022 governador 2º turno"). Sem termo, devolve o mais recente.
 */
export function resolverPleito(
  pleitos: SpectrumSourceContest[],
  termo?: unknown,
): SpectrumSourceContest | null {
  if (pleitos.length === 0) return null;
  if (typeof termo !== "string" || !termo.trim()) return pleitos[0];
  const bruto = termo.trim();
  const porId = pleitos.find(
    (pleito) => pleito.id === bruto || getPollingContestId(pleito) === bruto,
  );
  if (porId) return porId;
  const termos = normalizeSearchText(bruto).split(" ").filter(Boolean);
  if (termos.length === 0) return pleitos[0];
  return (
    pleitos.find((pleito) => {
      const rotulo = normalizeSearchText(
        `${pleito.electionYear} ${pleito.officeName} ${pleito.round} turno ${getPollingContestId(pleito)}`,
      );
      return termos.every((parte) => rotulo.includes(parte));
    }) ?? null
  );
}

function rotuloBloco(bloco: SpectrumBlock | null) {
  return bloco === null ? null : SPECTRUM_BLOCK_LABELS[bloco];
}

function arredondar(valor: number | null, casas = 2) {
  if (valor === null || !Number.isFinite(valor)) return null;
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

type PosicaoIndicador = { valor: number; posicao: number; faixa: number };

/**
 * Posição e faixa de CADA município num indicador, vindas do motor da aba
 * Análise. Fica em cache por conjunto de municípios porque `perfil_municipio`
 * e `comparar_municipios` pedem os 20 indicadores de uma vez.
 */
const cachePosicoes = new WeakMap<
  object,
  Map<AnalysisMetricId, Map<string, PosicaoIndicador>>
>();

function obterPosicoes(contexto: ContextoAgente, indicador: AnalysisMetricId) {
  let porIndicador = cachePosicoes.get(contexto.municipios);
  if (!porIndicador) {
    porIndicador = new Map();
    cachePosicoes.set(contexto.municipios, porIndicador);
  }
  const existente = porIndicador.get(indicador);
  if (existente) return existente;
  const modelo = buildAnalysisModel(
    contexto.municipios,
    {
      metricId: indicador,
      activeBands: [...ALL_ANALYSIS_BANDS],
      sortDirection: "desc",
    },
    contexto.eleitoradoEstadual,
  );
  const mapa = new Map(
    modelo.allItems.map((item) => [
      item.municipality.ibgeCode,
      { valor: item.value, posicao: item.rank, faixa: item.band + 1 },
    ]),
  );
  porIndicador.set(indicador, mapa);
  return mapa;
}

/** Um indicador da aba Análise já formatado, com posição no ranking de Goiás. */
function descreverIndicadores(
  contexto: ContextoAgente,
  municipio: MunicipalityProfile,
) {
  return ANALYSIS_METRICS.map((metrica) => {
    const posicoes = obterPosicoes(contexto, metrica.id);
    const posicao = posicoes.get(municipio.ibgeCode) ?? null;
    // Valor sem dado permanece null: nunca vira zero, nunca entra no ranking.
    const valor = getAnalysisMetricValue(municipio, metrica.id);
    return {
      id: metrica.id,
      rotulo: metrica.label,
      unidade: metrica.unit,
      valor: arredondar(valor),
      valorFormatado: formatAnalysisMetricValue(metrica.id, valor),
      posicaoRs: posicao?.posicao ?? null,
      municipiosComDado: posicoes.size,
      fonte: metrica.sourceLabel,
      anoReferencia: metrica.referenceYear,
    };
  });
}

const cacheEspectro = new WeakMap<object, Map<string, SpectrumModel>>();

/** Modelo do espectro municipal do pleito, com cache por conjunto de municípios. */
function obterModeloEspectro(
  contexto: ContextoAgente,
  pleito: SpectrumSourceContest,
  ordem: OrdemFerramenta = "maiores",
) {
  const chave = `${pleito.id}|${ordem}`;
  let porPleito = cacheEspectro.get(contexto.municipios);
  if (!porPleito) {
    porPleito = new Map();
    cacheEspectro.set(contexto.municipios, porPleito);
  }
  const existente = porPleito.get(chave);
  if (existente) return existente;
  const modelo = buildSpectrumModel(
    contexto.pleitos,
    contexto.municipios,
    contexto.indicePartidos,
    {
      contestId: pleito.id,
      metricId: "index",
      comparisonContestId: null,
      bandMode: "absolute",
      activeBands: [...ALL_ANALYSIS_BANDS],
      sortDirection: direcaoDaOrdem(ordem),
    },
  );
  porPleito.set(chave, modelo);
  return modelo;
}

function fonteEspectro(
  pleito: SpectrumSourceContest,
  ondaSurvey: number,
): FonteFerramenta {
  return {
    descricao:
      "Índice ideológico do Acquário Mapa: notas de especialistas por partido ponderadas pelos votos apurados pelo TSE",
    ano: pleito.electionYear,
    pleito: getSpectrumContestLabel(pleito),
    ondaSurvey,
  };
}

// ---------------------------------------------------------------------------
// 1. ranking_indicador
// ---------------------------------------------------------------------------

async function executarRankingIndicador(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const indicador = argumentos.indicador as AnalysisMetricId;
  const metrica = getAnalysisMetric(indicador);
  const ordem = resolverOrdem(argumentos.ordem);
  const limite = resolverLimite(argumentos.limite);
  const avisos: string[] = [];

  // O ranking é o MESMO da aba Análise: mesmo motor, mesmo estado, mesma
  // ordenação. Nada é recalculado aqui — é isso que garante que o número do
  // chat bate com o número do mapa.
  const modelo = buildAnalysisModel(
    contexto.municipios,
    {
      metricId: indicador,
      activeBands: [...ALL_ANALYSIS_BANDS],
      sortDirection: direcaoDaOrdem(ordem),
    },
    contexto.eleitoradoEstadual,
  );

  let itens = modelo.filteredItems;
  if (Array.isArray(argumentos.municipios)) {
    const filtro = resolverListaMunicipios(
      contexto,
      argumentos.municipios as string[],
      avisos,
    );
    if (filtro.municipios.length === 0) {
      return {
        ok: false,
        motivo: `Nenhum município do Goiás foi reconhecido em: ${(argumentos.municipios as string[]).join(", ")}.`,
      };
    }
    // O recorte filtra as LINHAS, nunca o ranking: a posição continua sendo a
    // do estado inteiro, igual à do mapa.
    itens = itens.filter((item) => filtro.codigos.has(item.municipality.ibgeCode));
    const semDado = filtro.municipios.filter(
      (municipio) =>
        !modelo.allItems.some(
          (item) => item.municipality.ibgeCode === municipio.ibgeCode,
        ),
    );
    if (semDado.length > 0) {
      avisos.push(
        `Sem dado de "${metrica.label}" (valor null, fora do ranking): ${semDado.map((municipio) => municipio.name).join(", ")}.`,
      );
    }
  }

  if (modelo.missingMunicipalityCount > 0) {
    avisos.push(
      `${modelo.missingMunicipalityCount} de ${contexto.municipios.length} municípios não têm dado de "${metrica.label}" e ficaram fora do ranking — valor null, nunca zero.`,
    );
  }

  const total = itens.length;
  const recorte = truncar(itens, limite, avisos, "municípios");

  return {
    ok: true,
    tipo: "ranking_indicador",
    total,
    dados: recorte.map((item) => ({
      posicaoRs: item.rank,
      codigoIbge: item.municipality.ibgeCode,
      codigoTse: item.municipality.tseCode,
      municipio: item.municipality.name,
      valor: arredondar(item.value),
      valorFormatado: formatAnalysisMetricValue(indicador, item.value),
      faixa: item.band + 1,
      eleitorado: item.municipality.electorate,
    })),
    fonte: {
      descricao: `${metrica.sourceLabel} — ${metrica.label} (${metrica.unit})`,
      ano: metrica.referenceYear,
      url: metrica.sourceUrl,
    },
    avisos,
    resumo: {
      indicador,
      rotulo: metrica.label,
      unidade: metrica.unit,
      ordem,
      municipiosComDado: modelo.allItems.length,
      municipiosSemDado: modelo.missingMunicipalityCount,
      // Sem nenhum município com dado a mediana não existe: null, nunca 0.
      medianaRs: modelo.allItems.length > 0 ? arredondar(modelo.median) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. perfil_municipio
// ---------------------------------------------------------------------------

async function executarPerfilMunicipio(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const avisos: string[] = [];
  const resolvido = resolverMunicipio(contexto, argumentos.municipio as string);
  if (!resolvido) {
    return {
      ok: false,
      motivo: `Município não encontrado em Goiás: "${String(argumentos.municipio)}".`,
    };
  }
  if (resolvido.aproximado) {
    avisos.push(
      `Interpretei "${String(argumentos.municipio)}" como ${resolvido.municipio.name}.`,
    );
  }
  const municipio = resolvido.municipio;
  const indicadores = descreverIndicadores(contexto, municipio);
  const semDado = indicadores.filter((item) => item.valor === null);
  if (semDado.length > 0) {
    avisos.push(
      `Sem dado publicado (valor null, nunca zero): ${semDado.map((item) => item.rotulo).join(", ")}.`,
    );
  }

  const pleito = resolverPleito(contexto.pleitos);
  let espectro: Record<string, unknown> | null = null;
  if (pleito) {
    const modelo = obterModeloEspectro(contexto, pleito);
    const item = modelo.allItems.find(
      (candidato) => candidato.municipality.ibgeCode === municipio.ibgeCode,
    );
    if (item) {
      espectro = {
        pleito: getSpectrumContestLabel(pleito),
        ondaSurvey: modelo.wave.year,
        indice: arredondar(item.index),
        bloco: rotuloBloco(
          item.index === null
            ? null
            : classifySpectrumBlock(item.index, contexto.registroPartidos),
        ),
        posicaoRs: item.rank > 0 ? item.rank : null,
        esquerdaPct: item.index === null ? null : arredondar(item.blockSharePct.left),
        centroPct: item.index === null ? null : arredondar(item.blockSharePct.center),
        direitaPct: item.index === null ? null : arredondar(item.blockSharePct.right),
        coberturaPct: arredondar(item.coveragePct),
        votosTotais: item.totalVotes,
        votosComNota: item.scoredVotes,
        partidoMaisVotado: item.leadingPartyCode || null,
      };
      if (item.index === null) {
        avisos.push(
          `Nenhum voto de ${municipio.name} em ${getSpectrumContestLabel(pleito)} caiu em partido com nota na onda ${modelo.wave.year}: o índice ideológico fica null.`,
        );
      }
    }
  } else {
    avisos.push("Nenhum pleito disponível para calcular o índice ideológico.");
  }

  const locais = await resumirLocaisDoMunicipio(contexto, municipio, avisos);

  return {
    ok: true,
    tipo: "perfil_municipio",
    total: 1,
    dados: [
      {
        codigoIbge: municipio.ibgeCode,
        codigoTse: municipio.tseCode,
        municipio: municipio.name,
        eleitorado: {
          total: municipio.electorate,
          participacaoRsPct: arredondar(municipio.stateSharePct),
          posicaoRs: municipio.stateRank,
          zonasEleitorais: municipio.zoneCount,
          biometriaPct: arredondar(municipio.biometricsPct),
          faixaEtariaMaisNumerosa: {
            rotulo: municipio.topAgeGroup.label,
            eleitores: municipio.topAgeGroup.electorate,
            percentual: arredondar(municipio.topAgeGroup.percentage),
          },
          mulheres: municipio.gender.female,
          homens: municipio.gender.male,
          nomeSocial: municipio.socialName,
          deficienciaCadastrada: municipio.registeredDisability,
        },
        indicadores,
        espectro,
        locaisVotacao: locais,
      },
    ],
    fonte: {
      descricao: `${contexto.fonteEleitorado}; indicadores socioeconômicos e etários do IBGE (ano de referência por indicador)`,
      ano: contexto.anoEleitorado,
    },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// 3. espectro_municipios
// ---------------------------------------------------------------------------

async function executarEspectroMunicipios(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const avisos: string[] = [];
  const pleito = resolverPleito(contexto.pleitos, argumentos.pleito);
  if (!pleito) {
    return {
      ok: false,
      motivo:
        typeof argumentos.pleito === "string" && argumentos.pleito.trim()
          ? `Pleito não encontrado: "${argumentos.pleito}". Disponíveis: ${contexto.pleitos.map(getSpectrumContestLabel).join("; ")}.`
          : "Nenhum pleito disponível para o índice ideológico.",
    };
  }
  const ordem = resolverOrdem(argumentos.ordem);
  const limite = resolverLimite(argumentos.limite);
  const modelo = obterModeloEspectro(contexto, pleito, ordem);

  let itens = modelo.filteredItems;
  if (Array.isArray(argumentos.municipios)) {
    const filtro = resolverListaMunicipios(
      contexto,
      argumentos.municipios as string[],
      avisos,
    );
    if (filtro.municipios.length === 0) {
      return {
        ok: false,
        motivo: `Nenhum município do Goiás foi reconhecido em: ${(argumentos.municipios as string[]).join(", ")}.`,
      };
    }
    itens = itens.filter((item) => filtro.codigos.has(item.municipality.ibgeCode));
  }

  if (modelo.missingMunicipalityCount > 0) {
    avisos.push(
      `${modelo.missingMunicipalityCount} ${plural(modelo.missingMunicipalityCount, "município ficou", "municípios ficaram")} sem índice (nenhum voto em partido com nota na onda ${modelo.wave.year}): valor null, fora do ranking.`,
    );
  }
  if (modelo.stateCoveragePct < 90) {
    avisos.push(
      `Cobertura estadual de ${arredondar(modelo.stateCoveragePct)}% dos votos: o índice ignora os votos em siglas sem nota no survey.`,
    );
  }

  const total = itens.length;
  const recorte = truncar(itens, limite, avisos, "municípios");

  return {
    ok: true,
    tipo: "espectro_municipios",
    total,
    dados: recorte.map((item) => ({
      posicaoRs: item.rank,
      codigoIbge: item.municipality.ibgeCode,
      municipio: item.municipality.name,
      indice: arredondar(item.index),
      bloco: rotuloBloco(
        item.index === null
          ? null
          : classifySpectrumBlock(item.index, contexto.registroPartidos),
      ),
      esquerdaPct: arredondar(item.blockSharePct.left),
      centroPct: arredondar(item.blockSharePct.center),
      direitaPct: arredondar(item.blockSharePct.right),
      coberturaPct: arredondar(item.coveragePct),
      votosTotais: item.totalVotes,
      votosComNota: item.scoredVotes,
      partidoMaisVotado: item.leadingPartyCode || null,
      eleitorado: item.municipality.electorate,
    })),
    fonte: fonteEspectro(pleito, modelo.wave.year),
    avisos,
    resumo: {
      pleito: getSpectrumContestLabel(pleito),
      ondaSurvey: modelo.wave.year,
      escala: "0 = extrema esquerda, 10 = extrema direita",
      indiceRs: arredondar(modelo.stateIndex),
      blocoRs: rotuloBloco(
        modelo.stateIndex === null
          ? null
          : classifySpectrumBlock(modelo.stateIndex, contexto.registroPartidos),
      ),
      esquerdaRsPct: arredondar(modelo.stateBlockSharePct.left),
      centroRsPct: arredondar(modelo.stateBlockSharePct.center),
      direitaRsPct: arredondar(modelo.stateBlockSharePct.right),
      coberturaRsPct: arredondar(modelo.stateCoveragePct),
      municipiosSemIndice: modelo.missingMunicipalityCount,
      ordem,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. espectro_submunicipal (bairro ou local de votação)
// ---------------------------------------------------------------------------

const AVISO_LOCAIS_PENDENTES =
  "A camada submunicipal ainda não foi gerada: rode scripts/process_tse_sections.py com os arquivos do TSE para preencher src/data/polling/. Sem ela não existe recorte por bairro nem por local de votação.";

/**
 * Carregamento SOB DEMANDA dos locais de votação. O contexto pode injetar o
 * carregador (é o que a interface faz); sem ele, tentamos o carregador
 * preguiçoso do bundler. Fora do navegador — e enquanto o ETL não rodou — o
 * resultado é `null` e a ferramenta responde com AVISO, nunca com erro.
 */
async function obterLocais(contexto: ContextoAgente) {
  try {
    if (contexto.carregarLocais) return await contexto.carregarLocais("rs");
    const modulo = await import("./pollingData.ts");
    return await modulo.loadPollingPlaces("rs");
  } catch {
    return null;
  }
}

async function obterVotosPorLocal(contexto: ContextoAgente, idPleito: string) {
  try {
    if (contexto.carregarVotosPorLocal) {
      return await contexto.carregarVotosPorLocal(idPleito);
    }
    const modulo = await import("./pollingData.ts");
    return await modulo.loadPollingVotes(idPleito);
  } catch {
    return null;
  }
}

/** Contagem de locais de votação do município, para o perfil. */
async function resumirLocaisDoMunicipio(
  contexto: ContextoAgente,
  municipio: MunicipalityProfile,
  avisos: string[],
) {
  const dados = await obterLocais(contexto);
  if (!dados || isPollingPlacesDatasetPending(dados)) {
    avisos.push(
      `Número de locais de votação indisponível. ${AVISO_LOCAIS_PENDENTES}`,
    );
    return null;
  }
  const locais = dados.places.filter(
    (local) => local.ibgeCode === municipio.ibgeCode,
  );
  const bairros = new Set(
    locais.map((local) => local.neighborhoodKey || normalizeNeighborhoodKey(local.neighborhood)),
  );
  return {
    total: locais.length,
    comCoordenada: locais.filter(
      (local) => local.latitude !== null && local.longitude !== null,
    ).length,
    secoes: locais.reduce((soma, local) => soma + local.sectionCount, 0),
    eleitoradoNosLocais: locais.reduce((soma, local) => soma + local.electorate, 0),
    bairros: bairros.size,
  };
}

async function executarEspectroSubmunicipal(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const avisos: string[] = [];
  const resolvido = resolverMunicipio(contexto, argumentos.municipio as string);
  if (!resolvido) {
    return {
      ok: false,
      motivo: `Município não encontrado em Goiás: "${String(argumentos.municipio)}".`,
    };
  }
  if (resolvido.aproximado) {
    avisos.push(
      `Interpretei "${String(argumentos.municipio)}" como ${resolvido.municipio.name}.`,
    );
  }
  const municipio = resolvido.municipio;
  const pleito = resolverPleito(contexto.pleitos, argumentos.pleito);
  if (!pleito) {
    return {
      ok: false,
      motivo:
        typeof argumentos.pleito === "string" && argumentos.pleito.trim()
          ? `Pleito não encontrado: "${argumentos.pleito}". Disponíveis: ${contexto.pleitos.map(getSpectrumContestLabel).join("; ")}.`
          : "Nenhum pleito disponível para o índice ideológico.",
    };
  }
  const unidade = argumentos.unidade === "local" ? "local" : "bairro";
  const ordem = resolverOrdem(argumentos.ordem);
  const limite = resolverLimite(argumentos.limite);
  const idPleito = getPollingContestId(pleito);
  const fonte = fonteEspectro(pleito, pleito.waveYear);
  const semDados = (motivo: string): RespostaFerramenta => ({
    ok: true,
    tipo: "espectro_submunicipal",
    total: 0,
    dados: [],
    fonte,
    avisos: [...avisos, motivo],
    resumo: {
      municipio: municipio.name,
      codigoIbge: municipio.ibgeCode,
      pleito: getSpectrumContestLabel(pleito),
      unidade,
      dadosDisponiveis: false,
    },
  });

  const locais = await obterLocais(contexto);
  if (!locais || isPollingPlacesDatasetPending(locais)) {
    return semDados(AVISO_LOCAIS_PENDENTES);
  }
  if (!locais.places.some((local) => local.ibgeCode === municipio.ibgeCode)) {
    return semDados(
      `Nenhum local de votação cadastrado para ${municipio.name} no conjunto de locais.`,
    );
  }
  const votos = await obterVotosPorLocal(contexto, idPleito);
  if (!votos || Object.keys(votos.votes).length === 0) {
    return semDados(
      `Os votos por local de votação de ${getSpectrumContestLabel(pleito)} ainda não foram gerados (src/data/polling/votes-${idPleito}.json). Os locais existem, mas não há votação apurada por local para calcular o índice.`,
    );
  }

  // Mesmo motor da camada submunicipal do mapa: soma os VOTOS antes de
  // calcular o índice (média ponderada de verdade, jamais média de médias).
  const modelo = buildPollingModel({
    places: locais.places,
    votes: votos.votes,
    index: contexto.indicePartidos,
    registry: contexto.registroPartidos,
    contest: pleito,
    state: {
      contestId: pleito.id,
      viewMode: unidade === "bairro" ? "neighborhoods" : "places",
      municipalityId: municipio.ibgeCode,
      // A ferramenta reporta o índice ideológico, nunca o percentual de uma
      // sigla: sem sigla escolhida o modelo mede o índice em QUALQUER cargo,
      // inclusive Presidente e Governador.
      partyCode: null,
      activeBands: [...ALL_ANALYSIS_BANDS],
      sortDirection: direcaoDaOrdem(ordem),
    },
  });

  if (modelo.missingIndexCount > 0) {
    avisos.push(
      `${modelo.missingIndexCount} ${unidade === "bairro" ? plural(modelo.missingIndexCount, "bairro", "bairros") : plural(modelo.missingIndexCount, "local", "locais")} ${plural(modelo.missingIndexCount, "ficou", "ficaram")} sem índice (nenhum voto em partido com nota na onda ${modelo.waveYear}): valor null, fora do ranking.`,
    );
  }
  if (modelo.placesWithoutCoordinateCount > 0) {
    avisos.push(
      `${modelo.placesWithoutCoordinateCount} ${plural(modelo.placesWithoutCoordinateCount, "local", "locais")} de ${municipio.name} sem coordenada: ${plural(modelo.placesWithoutCoordinateCount, "entra", "entram")} no índice, mas não ${plural(modelo.placesWithoutCoordinateCount, "aparece", "aparecem")} no mapa.`,
    );
  }
  avisos.push(
    "A medida é do LOCAL onde se vota, não do endereço de quem vota; o bairro é a soma dos locais daquele bairro, não um polígono.",
  );

  const total = modelo.filteredUnits.length;
  const recorte = truncar(
    modelo.filteredUnits,
    limite,
    avisos,
    unidade === "bairro" ? "bairros" : "locais de votação",
  );

  return {
    ok: true,
    tipo: "espectro_submunicipal",
    total,
    dados: recorte.map((item) => ({
      posicaoNoMunicipio: item.rank,
      unidade,
      nome: item.name,
      bairro: item.neighborhood,
      endereco: unidade === "local" ? item.address : null,
      zonaEleitoral: unidade === "local" ? item.zone : null,
      locaisAgregados: item.placeCount,
      indice: arredondar(item.index),
      bloco: rotuloBloco(
        item.index === null
          ? null
          : classifySpectrumBlock(item.index, contexto.registroPartidos),
      ),
      eleitores: item.electorate,
      secoes: item.sectionCount,
      votosTotais: item.totalVotes,
      votosComNota: item.scoredVotes,
      coberturaPct: arredondar(item.coveragePct),
      esquerdaPct: arredondar(item.blockSharePct.left),
      centroPct: arredondar(item.blockSharePct.center),
      direitaPct: arredondar(item.blockSharePct.right),
      partidoMaisVotado: item.leadingPartyCode || null,
    })),
    fonte,
    avisos,
    resumo: {
      municipio: municipio.name,
      codigoIbge: municipio.ibgeCode,
      pleito: modelo.contestLabel,
      ondaSurvey: modelo.waveYear,
      unidade,
      dadosDisponiveis: true,
      indiceDoMunicipio: arredondar(modelo.summary.index),
      blocoDoMunicipio: rotuloBloco(modelo.summary.block),
      esquerdaPct: arredondar(modelo.summary.blockSharePct.left),
      centroPct: arredondar(modelo.summary.blockSharePct.center),
      direitaPct: arredondar(modelo.summary.blockSharePct.right),
      coberturaPct: arredondar(modelo.summary.coveragePct),
      locais: modelo.summary.placeCount,
      bairros: modelo.summary.neighborhoodCount,
      eleitorado: modelo.summary.electorate,
      ordem,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. resultado_eleicao
// ---------------------------------------------------------------------------

const INDICADORES_COMPARACAO: AnalysisMetricId[] = [
  "electorate",
  "biometrics",
  "female",
  "populationEstimate",
  "censusPopulation",
  "populationDensity",
  "gdpPerCapita",
  "population16Plus",
  "electoralPenetration",
  "share16to24",
  "share60Plus",
  "literacyRate15Plus",
];

function pleitosOrdenados(eleicoes: ElectionDataset) {
  // Do mais recente para o mais antigo: ano, depois turno (2º turno é o
  // resultado final), depois cargo — a mesma leitura do painel de eleições.
  return eleicoes.contests.slice().sort(
    (a, b) =>
      b.electionYear - a.electionYear ||
      b.round - a.round ||
      a.officeCode - b.officeCode,
  );
}

function candidatoCombina(
  candidato: { number: string; ballotName: string; fullName: string },
  alvo: string,
) {
  if (candidato.number === alvo) return true;
  const urna = normalizeSearchText(candidato.ballotName);
  const completo = normalizeSearchText(candidato.fullName);
  return (
    urna === alvo ||
    completo === alvo ||
    urna.startsWith(alvo) ||
    completo.startsWith(alvo) ||
    urna.includes(alvo) ||
    completo.includes(alvo)
  );
}

async function executarResultadoEleicao(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const avisos: string[] = [];
  const eleicoes = contexto.eleicoes;
  // Histórico do TSE ainda não gerado: a ferramenta declara a indisponibilidade
  // em vez de responder com números que não existem.
  if (isElectionDatasetPendente(eleicoes)) {
    return {
      ok: false,
      motivo:
        "Histórico eleitoral indisponível: o snapshot do TSE (Presidente e " +
        "Governador de Goiás) ainda não foi gerado. Rode `bash gerar_dados.sh` " +
        "na raiz do projeto para baixar e processar os arquivos.",
    };
  }
  const termo = String(argumentos.candidato).trim();
  const alvo = normalizeSearchText(termo) || termo;
  const ordenados = pleitosOrdenados(eleicoes);

  let pleitos = ordenados;
  if (typeof argumentos.pleito === "string" && argumentos.pleito.trim()) {
    const bruto = argumentos.pleito.trim();
    const termosPleito = normalizeSearchText(bruto).split(" ").filter(Boolean);
    pleitos = ordenados.filter((pleito) => {
      if (pleito.id === bruto) return true;
      const rotulo = normalizeSearchText(
        `${pleito.electionYear} ${pleito.officeName} ${pleito.round} turno ${pleito.id}`,
      );
      return termosPleito.every((parte) => rotulo.includes(parte));
    });
    if (pleitos.length === 0) {
      return {
        ok: false,
        motivo: `Pleito não encontrado: "${bruto}". Disponíveis: ${ordenados.map((pleito) => `${pleito.electionYear} ${pleito.officeName} ${pleito.round}º turno`).join("; ")}.`,
      };
    }
  }

  const pleito =
    pleitos.find((candidato) =>
      candidato.candidates.some((item) => candidatoCombina(item, alvo)),
    ) ?? null;
  if (!pleito) {
    const disponiveis = pleitos[0].candidates
      .slice(0, 12)
      .map((item) => `${item.ballotName} (${item.party})`)
      .join(", ");
    return {
      ok: false,
      motivo: `Candidato "${termo}" não encontrado nos pleitos consultados. Em ${pleitos[0].electionYear} · ${pleitos[0].officeName} · ${pleitos[0].round}º turno existem, por exemplo: ${disponiveis}.`,
    };
  }
  const candidato = pleito.candidates.find((item) =>
    candidatoCombina(item, alvo),
  )!;
  if (normalizeSearchText(candidato.ballotName) !== alvo && candidato.number !== termo) {
    avisos.push(
      `Interpretei "${termo}" como ${candidato.ballotName} (${candidato.party}).`,
    );
  }

  const ordem = resolverOrdem(argumentos.ordem);
  const limite = resolverLimite(argumentos.limite);
  // Motor do painel de eleições: participação = votos do candidato sobre os
  // votos VÁLIDOS do município, exatamente como o mapa pinta.
  const modelo = buildElectionModel(eleicoes, contexto.municipios, {
    contestId: pleito.id,
    candidateId: candidato.id,
    metricId: "share",
    comparisonContestId: pleito.id,
    comparisonCandidateId: null,
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: direcaoDaOrdem(ordem),
  });
  // Só acontece com snapshot placeholder; sem modelo não há resposta possível.
  if (modelo === null) {
    return {
      ok: false,
      motivo:
        "Histórico eleitoral indisponível: o snapshot do TSE ainda não foi " +
        "gerado. Rode `bash gerar_dados.sh` na raiz do projeto.",
    };
  }

  let itens = modelo.filteredItems;
  if (Array.isArray(argumentos.municipios)) {
    const filtro = resolverListaMunicipios(
      contexto,
      argumentos.municipios as string[],
      avisos,
    );
    if (filtro.municipios.length === 0) {
      return {
        ok: false,
        motivo: `Nenhum município do Goiás foi reconhecido em: ${(argumentos.municipios as string[]).join(", ")}.`,
      };
    }
    itens = itens.filter((item) => filtro.codigos.has(item.municipality.ibgeCode));
  }

  const semApuracao = modelo.allItems.filter((item) => item.validVotes === 0);
  if (semApuracao.length > 0) {
    avisos.push(
      `${semApuracao.length} ${plural(semApuracao.length, "município não tem", "municípios não têm")} resultado apurado neste pleito e ${plural(semApuracao.length, "aparece", "aparecem")} com 0 votos e 0% — mesmo comportamento do mapa.`,
    );
  }

  const total = itens.length;
  const recorte = truncar(itens, limite, avisos, "municípios");

  return {
    ok: true,
    tipo: "resultado_eleicao",
    total,
    dados: recorte.map((item) => ({
      posicaoRs: item.rank,
      codigoIbge: item.municipality.ibgeCode,
      municipio: item.municipality.name,
      votos: item.votes,
      votosValidosMunicipio: item.validVotes,
      participacaoPct: arredondar(item.sharePct),
      liderouMunicipio: item.winner,
      eleitorado2026: item.municipality.electorate,
    })),
    fonte: {
      descricao: `${eleicoes.metadata.source} — ${eleicoes.metadata.dataset}`,
      ano: pleito.electionYear,
      pleito: `${pleito.electionYear} · ${pleito.officeName} · ${pleito.round}º turno`,
      url: eleicoes.metadata.sourceUrl,
    },
    avisos,
    resumo: {
      candidato: candidato.ballotName,
      nomeCompleto: candidato.fullName,
      numero: candidato.number,
      partido: candidato.party,
      pleito: `${pleito.electionYear} · ${pleito.officeName} · ${pleito.round}º turno`,
      votosNoEstado: candidato.stateVotes,
      participacaoEstadoPct: arredondar(candidato.stateSharePct),
      posicaoEstadual: candidato.stateRank,
      municipiosVencidos: candidato.municipalitiesWon,
      votosValidosEstado: pleito.stateValidVotes,
      melhorMunicipio: modelo.bestMunicipality
        ? {
            municipio: modelo.bestMunicipality.municipality.name,
            participacaoPct: arredondar(modelo.bestMunicipality.sharePct),
          }
        : null,
      ordem,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. comparar_municipios
// ---------------------------------------------------------------------------

async function executarCompararMunicipios(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const avisos: string[] = [];
  const termos = argumentos.municipios as string[];
  const filtro = resolverListaMunicipios(contexto, termos, avisos);
  if (filtro.municipios.length < 2) {
    return {
      ok: false,
      motivo: `A comparação precisa de pelo menos 2 municípios reconhecidos; recebi: ${termos.join(", ")}.`,
    };
  }

  const pleito = resolverPleito(contexto.pleitos);
  const modelo = pleito ? obterModeloEspectro(contexto, pleito) : null;
  const selecionados = filtro.municipios.slice(0, 3);
  if (filtro.municipios.length > 3) {
    avisos.push("A comparação usa no máximo 3 municípios; os demais ficaram de fora.");
  }

  const dados = selecionados.map((municipio) => {
    const indicadores = descreverIndicadores(contexto, municipio).filter(
      (item) => INDICADORES_COMPARACAO.includes(item.id),
    );
    const item = modelo?.allItems.find(
      (candidato) => candidato.municipality.ibgeCode === municipio.ibgeCode,
    );
    const semDado = indicadores.filter((indicador) => indicador.valor === null);
    if (semDado.length > 0) {
      avisos.push(
        `${municipio.name} não tem dado de: ${semDado.map((indicador) => indicador.rotulo).join(", ")} (valor null, nunca zero).`,
      );
    }
    return {
      codigoIbge: municipio.ibgeCode,
      municipio: municipio.name,
      eleitorado: municipio.electorate,
      posicaoEleitoradoRs: municipio.stateRank,
      indicadores,
      espectro:
        item && pleito && modelo
          ? {
              pleito: getSpectrumContestLabel(pleito),
              ondaSurvey: modelo.wave.year,
              indice: arredondar(item.index),
              bloco: rotuloBloco(
                item.index === null
                  ? null
                  : classifySpectrumBlock(item.index, contexto.registroPartidos),
              ),
              coberturaPct: arredondar(item.coveragePct),
            }
          : null,
    };
  });

  return {
    ok: true,
    tipo: "comparar_municipios",
    total: dados.length,
    dados,
    fonte: {
      descricao: `${contexto.fonteEleitorado}; indicadores do IBGE (ano de referência por indicador)${pleito ? `; índice ideológico em ${getSpectrumContestLabel(pleito)}` : ""}`,
      ano: contexto.anoEleitorado,
      pleito: pleito ? getSpectrumContestLabel(pleito) : undefined,
      ondaSurvey: modelo?.wave.year,
    },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// 7. votacao_da_candidata (trajetória da candidatura em foco)
// ---------------------------------------------------------------------------

/**
 * Os dois motivos de indisponibilidade da trajetória — e por que eles são
 * textos diferentes.
 *
 * Quando não existe ferramenta (ou dado) para responder, a única saída honesta
 * é dizer QUAL é a falta. Foi a confusão entre "não tenho como consultar" e
 * "o dado não existe" que produziu o pior desfecho já visto nesta base: o
 * modelo afirmou que a votação por bairro não estava gerada enquanto ela
 * estava na tela. Cada motivo abaixo nomeia o arquivo e o comando, para a
 * resposta ao usuário poder ser específica em vez de inventada.
 */
const MOTIVO_TRAJETORIA_PENDENTE =
  "A trajetória da candidata ainda não foi gerada nesta instalação: " +
  "src/data/candidato/<slug>.json continua sendo o placeholder do repositório " +
  "(metadata.status \"pendente\", nenhum pleito). Rode `bash gerar_dados.sh` na " +
  "raiz do projeto para processar a votação nominal dela a partir do TSE. O " +
  "dado existe no TSE — o que falta é o processamento local.";

const MOTIVO_TRAJETORIA_AUSENTE =
  "A trajetória da candidata não foi entregue a esta sessão do agente: o " +
  "contexto veio sem o snapshot src/data/candidato/<slug>.json. Isso é falha de " +
  "carregamento do painel, não ausência do dado no TSE.";

/** Ordem de leitura da trajetória: do pleito mais recente para o mais antigo. */
function pleitosDaCandidataOrdenados(contests: CandidateContest[]) {
  return [...contests].sort(
    (a, b) =>
      b.electionYear - a.electionYear ||
      b.round - a.round ||
      a.officeCode - b.officeCode,
  );
}

/**
 * Casamento de um termo da busca com o rótulo do pleito.
 *
 * O TSE grava o cargo no masculino ("Deputado Federal", "Prefeito") e quem
 * pergunta escreve no feminino ("deputada federal", "prefeita", "senadora").
 * Sem esta tolerância a pergunta natural em pt-BR não encontraria o pleito.
 * Só vale para palavras: em número ("2024") cortar a última letra casaria
 * 2024 com 2020.
 */
function combinaTermoDePleito(rotulo: string, termo: string) {
  if (rotulo.includes(termo)) return true;
  if (termo.length < 4 || /^\d+$/.test(termo)) return false;
  const raiz = termo.slice(0, -1);
  return rotulo.includes(`${raiz}o`) || rotulo.includes(raiz);
}

/**
 * Resolve o pleito dentro da trajetória por identificador ("2024-11-1") ou por
 * texto livre ("2024 prefeita"). Sem termo, devolve o mais recente.
 */
export function resolverPleitoDaCandidata(
  contests: CandidateContest[],
  termo?: unknown,
): CandidateContest | null {
  const ordenados = pleitosDaCandidataOrdenados(contests);
  if (ordenados.length === 0) return null;
  if (typeof termo !== "string" || !termo.trim()) return ordenados[0];
  const bruto = termo.trim();
  const porId = ordenados.find((contest) => contest.id === bruto);
  if (porId) return porId;
  const termos = normalizeSearchText(bruto).split(" ").filter(Boolean);
  if (termos.length === 0) return ordenados[0];
  return (
    ordenados.find((contest) => {
      const rotulo = normalizeSearchText(
        `${contest.electionYear} ${contest.officeName} ${contest.round} turno ${contest.id}`,
      );
      return termos.every((parte) => combinaTermoDePleito(rotulo, parte));
    }) ?? null
  );
}

/** Nome de urna da candidatura, para as mensagens saírem com gente e não com slug. */
function nomeDaCandidata(dataset: CandidateDataset) {
  return (
    dataset.contests[0]?.candidatura.nomeUrna ||
    dataset.metadata.nomeConsultado ||
    dataset.metadata.slug
  );
}

function fonteDaCandidata(
  dataset: CandidateDataset,
  contest: CandidateContest | null,
  ano?: number,
): FonteFerramenta {
  // Toda resposta declara recorte temporal, inclusive a de ausência: sem
  // pleito escolhido, o recorte é a trajetória até o pleito mais recente.
  const maisRecente = pleitosDaCandidataOrdenados(dataset.contests)[0];
  return {
    descricao: `${dataset.metadata.source ?? "TSE — votação nominal por seção"} — votação de ${nomeDaCandidata(dataset)}`,
    ano: contest?.electionYear ?? ano ?? maisRecente?.electionYear,
    pleito: contest ? getContestLabel(contest) : undefined,
    url: dataset.metadata.sourceUrl,
  };
}

/** Envelope de ausência: 0 linhas, motivo dito por extenso, nunca zero fingido. */
function semVotacao(
  fonte: FonteFerramenta,
  avisos: string[],
  motivo: string,
  resumo: Record<string, unknown>,
): RespostaFerramenta {
  return {
    ok: true,
    tipo: "votacao_da_candidata",
    total: 0,
    dados: [],
    fonte,
    avisos: [...avisos, motivo],
    resumo: { ...resumo, temVotoApurado: false },
  };
}

async function executarVotacaoDaCandidata(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const dataset = contexto.trajetoriaCandidata;
  if (!dataset) return { ok: false, motivo: MOTIVO_TRAJETORIA_AUSENTE };
  if (isCandidatePendente(dataset)) {
    return { ok: false, motivo: MOTIVO_TRAJETORIA_PENDENTE };
  }

  const avisos: string[] = [];
  const recorte =
    argumentos.recorte === "bairros"
      ? "bairros"
      : argumentos.recorte === "trajetoria"
        ? "trajetoria"
        : "municipios";
  const ordem = resolverOrdem(argumentos.ordem);
  const limite = resolverLimite(argumentos.limite);
  const candidata = nomeDaCandidata(dataset);
  const porId = new Map(dataset.contests.map((contest) => [contest.id, contest]));

  // ---- trajetória: uma linha por eleição, em ordem cronológica ------------
  if (recorte === "trajetoria") {
    // buildTrajectory é o MESMO motor do gráfico da aba "Accorsi": nenhuma
    // soma acontece aqui, nem poderia — voto de eleições diferentes não se
    // soma, cada pleito tem eleitorado, cargo e regras próprios.
    const pontos = buildTrajectory(dataset);
    avisos.push(
      "Votos de eleições diferentes não se somam nem se comparam direto: cada pleito tem cargo, regras e eleitorado próprios. O que se lê entre pleitos é variação.",
    );
    const linhas = truncar(pontos, limite, avisos, "pleitos");
    return {
      ok: true,
      tipo: "votacao_da_candidata",
      total: pontos.length,
      dados: linhas.map((ponto) => {
        const contest = porId.get(ponto.id);
        return {
          pleitoId: ponto.id,
          pleito: contest ? getContestLabel(contest) : ponto.id,
          ano: ponto.electionYear,
          cargo: ponto.officeName,
          turno: ponto.round,
          partido: ponto.partido,
          votos: ponto.votos,
          // Resultado completo e cru do TSE, traduzido: quem consulta o dado
          // precisa saber se ela foi eleita. Os rótulos de vitrine (que
          // omitem derrota) são regra de TELA da aba, não do dado.
          resultado: formatResultado(ponto.resultado),
          municipiosComVoto: contest?.municipiosComVoto ?? null,
          posicaoNoPleito: contest?.posicaoNoEstado ?? null,
          candidaturasNoPleito: contest?.candidaturasNoPleito ?? null,
          universo: contest && isMunicipalContest(contest) ? "municipal" : "estadual/federal",
          temRecorteDeBairros: contest?.temRecorteSubmunicipal ?? false,
        };
      }),
      fonte: fonteDaCandidata(
        dataset,
        null,
        pontos.length > 0 ? pontos[pontos.length - 1].electionYear : undefined,
      ),
      avisos,
      resumo: {
        candidata,
        recorte,
        pleitos: pontos.length,
        leitura: "ordem cronológica, do pleito mais antigo para o mais recente",
      },
    };
  }

  // ---- município: opcional em "municipios", obrigatório em "bairros" ------
  let municipio: MunicipalityProfile | null = null;
  if (typeof argumentos.municipio === "string" && argumentos.municipio.trim()) {
    const resolvido = resolverMunicipio(contexto, argumentos.municipio);
    if (!resolvido) {
      return {
        ok: false,
        motivo: `Município não encontrado em Goiás: "${argumentos.municipio}".`,
      };
    }
    if (resolvido.aproximado) {
      avisos.push(
        `Interpretei "${argumentos.municipio}" como ${resolvido.municipio.name}.`,
      );
    }
    municipio = resolvido.municipio;
  }

  // ---- bairros de um município ------------------------------------------
  if (recorte === "bairros") {
    if (!municipio) {
      return {
        ok: false,
        motivo:
          "O recorte por bairros precisa do argumento \"municipio\" — o recorte submunicipal sempre olha uma cidade por vez (ex.: Goiânia).",
      };
    }
    const comBairros = listContestsComBairros(dataset, municipio.ibgeCode);
    const rotulosComBairros = comBairros.map(getContestLabel).join("; ");
    if (comBairros.length === 0) {
      return semVotacao(
        fonteDaCandidata(dataset, null),
        avisos,
        `Nenhum pleito da trajetória de ${candidata} tem recorte por bairros em ${municipio.name}. O recorte submunicipal só existe onde a votação por seção casa com o cadastro de locais do TSE — em Goiás, isso acontece em Goiânia.`,
        { candidata, recorte, municipio: municipio.name, codigoIbge: municipio.ibgeCode },
      );
    }

    let contest: CandidateContest | null;
    if (typeof argumentos.pleito === "string" && argumentos.pleito.trim()) {
      contest = resolverPleitoDaCandidata(dataset.contests, argumentos.pleito);
      if (!contest) {
        return {
          ok: false,
          motivo: `Pleito não encontrado na trajetória de ${candidata}: "${argumentos.pleito}". Disponíveis: ${pleitosDaCandidataOrdenados(dataset.contests).map(getContestLabel).join("; ")}.`,
        };
      }
      if (!comBairros.some((item) => item.id === contest!.id)) {
        return semVotacao(
          fonteDaCandidata(dataset, contest),
          avisos,
          `${getContestLabel(contest)} não tem recorte por bairros em ${municipio.name}. Pleitos com bairros ali: ${rotulosComBairros}.`,
          {
            candidata,
            recorte,
            municipio: municipio.name,
            codigoIbge: municipio.ibgeCode,
            pleito: getContestLabel(contest),
          },
        );
      }
    } else {
      // Sem pleito pedido, o mais recente COM bairros — não o mais recente da
      // trajetória, que pode ser uma eleição sem recorte submunicipal.
      contest = comBairros[comBairros.length - 1];
    }

    const ordenados = getBairros(contest, municipio.ibgeCode) ?? [];
    // A posição é sempre a do ranking decrescente; "menores" só inverte a
    // leitura da lista, para o 1º continuar sendo o bairro mais votado.
    const comPosicao = ordenados.map((linha, indice) => ({
      posicaoNoMunicipio: indice + 1,
      bairro: linha.bairro,
      votos: linha.votos,
    }));
    const linhas = ordem === "menores" ? [...comPosicao].reverse() : comPosicao;

    avisos.push(
      "O bairro é o do LOCAL DE VOTAÇÃO onde o voto foi apurado, não o endereço de quem votou; e é a soma dos locais daquele bairro, não um polígono.",
    );
    if (contest.votosSemLocalDeVotacao > 0) {
      avisos.push(
        `${contest.votosSemLocalDeVotacao} ${plural(contest.votosSemLocalDeVotacao, "voto dela não tem", "votos dela não têm")} local de votação identificado neste pleito e ${plural(contest.votosSemLocalDeVotacao, "não entra", "não entram")} em bairro nenhum.`,
      );
    }
    const recortadas = truncar(linhas, limite, avisos, "bairros");

    return {
      ok: true,
      tipo: "votacao_da_candidata",
      total: linhas.length,
      dados: recortadas,
      fonte: fonteDaCandidata(dataset, contest),
      avisos,
      resumo: {
        candidata,
        recorte,
        municipio: municipio.name,
        codigoIbge: municipio.ibgeCode,
        pleito: getContestLabel(contest),
        ano: contest.electionYear,
        cargo: contest.officeName,
        bairrosComVoto: linhas.length,
        votosNoMunicipio: contest.municipios[municipio.ibgeCode]?.votos ?? null,
        pleitosComBairros: rotulosComBairros,
        temVotoApurado: linhas.length > 0,
        ordem,
      },
    };
  }

  // ---- município citado sem pleito: os destaques do cartão do mapa --------
  if (municipio && !(typeof argumentos.pleito === "string" && argumentos.pleito.trim())) {
    // Mesmo motor do cartão "Dra. Adriana neste município": a eleição mais
    // recente de CADA universo. Prefeitura e cadeira são disputas diferentes —
    // saem lado a lado e nunca somadas.
    const destaques = getMunicipioDestaques(dataset, municipio.ibgeCode);
    if (destaques.length === 0) {
      return semVotacao(
        fonteDaCandidata(dataset, null),
        avisos,
        `Não há votação de ${candidata} apurada em ${municipio.name} em nenhum pleito da trajetória. "Sem voto apurado" não é "zero voto": o município simplesmente não aparece na apuração dela.`,
        { candidata, recorte, municipio: municipio.name, codigoIbge: municipio.ibgeCode },
      );
    }
    if (destaques.length > 1) {
      avisos.push(
        `Os ${destaques.length} números abaixo são de disputas diferentes (uma municipal, uma estadual/federal): não se somam nem se comparam entre si.`,
      );
    }
    return {
      ok: true,
      tipo: "votacao_da_candidata",
      total: destaques.length,
      dados: destaques.map((destaque) => ({
        codigoIbge: municipio.ibgeCode,
        municipio: municipio.name,
        pleitoId: destaque.contestId,
        pleito:
          porId.has(destaque.contestId)
            ? getContestLabel(porId.get(destaque.contestId) as CandidateContest)
            : destaque.contestId,
        ano: destaque.electionYear,
        cargo: destaque.officeName,
        turno: destaque.round,
        universo: destaque.municipal ? "municipal" : "estadual/federal",
        votos: destaque.votos,
        percentualValidos: destaque.percentualValidos,
        posicaoNoMunicipio: destaque.posicaoNoMunicipio,
        candidaturasComVoto: destaque.candidaturasComVoto,
      })),
      fonte: fonteDaCandidata(dataset, porId.get(destaques[0].contestId) ?? null),
      avisos,
      resumo: {
        candidata,
        recorte,
        municipio: municipio.name,
        codigoIbge: municipio.ibgeCode,
        leitura: "eleição mais recente de cada universo de disputa",
        temVotoApurado: true,
      },
    };
  }

  // ---- ranking municipal de um pleito ------------------------------------
  const contest = resolverPleitoDaCandidata(dataset.contests, argumentos.pleito);
  if (!contest) {
    return {
      ok: false,
      motivo: `Pleito não encontrado na trajetória de ${candidata}: "${String(argumentos.pleito)}". Disponíveis: ${pleitosDaCandidataOrdenados(dataset.contests).map(getContestLabel).join("; ")}.`,
    };
  }
  const metricaId = (
    typeof argumentos.metrica === "string" ? argumentos.metrica : "votos"
  ) as CandidateRankingMetricId;
  const metrica = getCandidateRankingMetric(metricaId);
  if (metrica.requiresElectorate && !contexto.indiceEleitorado) {
    return {
      ok: false,
      motivo: `A métrica "${metrica.label}" precisa do eleitorado apto por município, e o snapshot do eleitorado ainda é placeholder nesta instalação. Rode \`bash gerar_dados.sh\` ou peça a métrica "votos".`,
    };
  }
  const fonte = fonteDaCandidata(dataset, contest);
  const resumoBase = {
    candidata,
    recorte,
    pleito: getContestLabel(contest),
    ano: contest.electionYear,
    cargo: contest.officeName,
    turno: contest.round,
    metrica: metricaId,
    rotuloMetrica: metrica.label,
    votosNoPleito: contest.votosNoEstado,
    municipiosComVoto: contest.municipiosComVoto,
    ordem,
  };

  if (isMunicipalContest(contest)) {
    avisos.push(
      `${getContestLabel(contest)} é uma eleição municipal: a disputa acontece dentro de uma cidade, e o número não se compara com o de outras cidades.`,
    );
  }

  // Mesmo ranking da aba "Accorsi", incluindo a regra de que município sem
  // valor da métrica (denominador ausente) fica FORA — nunca com 0.
  const completo = buildMunicipioRanking(
    contest,
    metricaId,
    contexto.indiceEleitorado,
    Number.MAX_SAFE_INTEGER,
  );
  const municipiosNoPleito = Object.keys(contest.municipios).length;
  if (completo.length < municipiosNoPleito) {
    const fora = municipiosNoPleito - completo.length;
    avisos.push(
      `${fora} ${plural(fora, "município ficou", "municípios ficaram")} fora do ranking por não ter valor de "${metrica.label}" (valor null, nunca zero).`,
    );
  }

  if (municipio) {
    const bruto = contest.municipios[municipio.ibgeCode];
    if (!bruto) {
      return semVotacao(
        fonte,
        avisos,
        `${candidata} não tem votação apurada em ${municipio.name} em ${getContestLabel(contest)}. "Sem voto apurado" não é "zero voto".`,
        { ...resumoBase, municipio: municipio.name, codigoIbge: municipio.ibgeCode },
      );
    }
    const linha = completo.find((item) => item.ibgeCode === municipio.ibgeCode);
    if (!linha) {
      return semVotacao(
        fonte,
        avisos,
        `${municipio.name} tem ${bruto.votos} votos apurados de ${candidata} em ${getContestLabel(contest)}, mas a métrica "${metrica.label}" é null ali (falta o denominador) e por isso a linha fica fora do ranking.`,
        {
          ...resumoBase,
          municipio: municipio.name,
          codigoIbge: municipio.ibgeCode,
          votos: bruto.votos,
        },
      );
    }
    return {
      ok: true,
      tipo: "votacao_da_candidata",
      total: 1,
      dados: [
        {
          posicaoNoRanking: completo.indexOf(linha) + 1,
          codigoIbge: linha.ibgeCode,
          municipio: linha.nome,
          votos: linha.votos,
          valor: arredondar(linha.value),
          percentualValidos: arredondar(contest.municipios[linha.ibgeCode].percentualValidos),
          percentualDoPartido: arredondar(
            contest.municipios[linha.ibgeCode].percentualDoPartido,
          ),
          posicaoNoMunicipio: linha.posicaoNoMunicipio,
          candidaturasComVoto: contest.municipios[linha.ibgeCode].candidaturasComVoto,
          eleitorado: linha.eleitorado,
        },
      ],
      fonte,
      avisos,
      resumo: {
        ...resumoBase,
        municipio: linha.nome,
        codigoIbge: linha.ibgeCode,
        municipiosNoRanking: completo.length,
        temVotoApurado: true,
      },
    };
  }

  // "menores" inverte a leitura da mesma lista ordenada pelo motor — a posição
  // devolvida continua sendo a do ranking decrescente.
  const ordenadas = ordem === "menores" ? [...completo].reverse() : completo;
  const recortadas = truncar(ordenadas, limite, avisos, "municípios");

  return {
    ok: true,
    tipo: "votacao_da_candidata",
    total: ordenadas.length,
    dados: recortadas.map((linha) => ({
      posicaoNoRanking: completo.indexOf(linha) + 1,
      codigoIbge: linha.ibgeCode,
      municipio: linha.nome,
      votos: linha.votos,
      valor: arredondar(linha.value),
      percentualValidos: arredondar(contest.municipios[linha.ibgeCode].percentualValidos),
      percentualDoPartido: arredondar(contest.municipios[linha.ibgeCode].percentualDoPartido),
      posicaoNoMunicipio: linha.posicaoNoMunicipio,
      eleitorado: linha.eleitorado,
    })),
    fonte,
    avisos,
    resumo: {
      ...resumoBase,
      municipiosNoRanking: completo.length,
      concentracaoTop5Pct: contest.concentracaoPercentual.top5,
      concentracaoTop10Pct: contest.concentracaoPercentual.top10,
      temVotoApurado: ordenadas.length > 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 8. cadastros_agregados (com k-anonimato)
// ---------------------------------------------------------------------------

function limiarPrivacidade(contexto: ContextoAgente) {
  // O piso é inegociável: mesmo que a base declare um limiar menor, nenhum
  // grupo com menos de 5 cadastros sai daqui.
  return Math.max(
    K_ANONIMATO_MINIMO,
    contexto.cadastrosMetadados?.limiarPrivacidade ?? K_ANONIMATO_MINIMO,
  );
}

async function executarCadastrosAgregados(
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  const avisos: string[] = [];
  const agrupamento = argumentos.agrupamento === "bairro" ? "bairro" : "municipio";
  const ordem = resolverOrdem(argumentos.ordem);
  const limite = resolverLimite(argumentos.limite);
  const k = limiarPrivacidade(contexto);
  const metadados = contexto.cadastrosMetadados;

  if (contexto.cadastros.length === 0 || !metadados) {
    return {
      ok: true,
      tipo: "cadastros_agregados",
      total: 0,
      dados: [],
      fonte: { descricao: "Cadastros de apoiadores da campanha" },
      avisos: [
        ...avisos,
        "Nenhuma base de cadastros de apoiadores está carregada nesta sessão.",
      ],
      resumo: { agrupamento, limiarPrivacidade: k },
    };
  }

  let municipioFiltrado: MunicipalityProfile | null = null;
  if (typeof argumentos.municipio === "string" && argumentos.municipio.trim()) {
    const resolvido = resolverMunicipio(contexto, argumentos.municipio);
    if (!resolvido) {
      return {
        ok: false,
        motivo: `Município não encontrado em Goiás: "${argumentos.municipio}".`,
      };
    }
    if (resolvido.aproximado) {
      avisos.push(
        `Interpretei "${argumentos.municipio}" como ${resolvido.municipio.name}.`,
      );
    }
    municipioFiltrado = resolvido.municipio;
  }

  const estado = {
    ...getDefaultRegistrationState(),
    municipalityId: municipioFiltrado?.ibgeCode ?? null,
  };
  // Motor da camada de cadastros: mesma janela, mesmas fontes e mesmos status
  // (consentimento revogado fica fora) que o mapa usa por padrão.
  const modelo = buildRegistrationModel(
    contexto.cadastros,
    contexto.municipios,
    estado,
    metadados.dataReferencia,
    k,
  );

  const fonte: FonteFerramenta = {
    descricao:
      metadados.modo === "synthetic-demo"
        ? "Cadastros de apoiadores — base sintética de demonstração (não representa pessoas reais)"
        : "Cadastros de apoiadores da campanha",
    ano: Number(metadados.dataReferencia.slice(0, 4)) || undefined,
  };
  if (metadados.modo === "synthetic-demo") {
    avisos.push(
      metadados.aviso ??
        "Dados totalmente sintéticos para demonstração; não representam pessoas reais.",
    );
  }
  avisos.push(
    `k-anonimato aplicado: grupos com menos de ${k} cadastros são suprimidos por privacidade e não aparecem nas linhas. A ferramenta nunca devolve registro individual nem dado pessoal.`,
  );

  let linhas: Array<Record<string, unknown>>;
  let gruposSuprimidos = 0;
  let cadastrosExibidos = 0;

  if (agrupamento === "municipio") {
    const comCadastro = modelo.allItems.filter((item) => item.total > 0);
    gruposSuprimidos = comCadastro.filter((item) => item.total < k).length;
    const visiveis = comCadastro
      .filter((item) => item.total >= k)
      .sort(
        (a, b) =>
          (ordem === "menores" ? a.total - b.total : b.total - a.total) ||
          a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
      );
    cadastrosExibidos = visiveis.reduce((soma, item) => soma + item.total, 0);
    linhas = visiveis.map((item) => ({
      codigoIbge: item.municipality.ibgeCode,
      municipio: item.municipality.name,
      cadastros: item.total,
      cadastrosUltimos30Dias: item.recent,
      acompanhamentosPendentes: item.pending,
      porDezMilEleitores: arredondar(item.rate),
      eleitorado: item.municipality.electorate,
      posicaoRs: item.rank,
    }));
  } else {
    // Bairro: agrupa os MESMOS registros do recorte do modelo (status padrão,
    // sem consentimento revogado) pela chave normalizada do bairro.
    const statusValidos = new Set(estado.statuses);
    const grupos = new Map<
      string,
      { municipio: string; codigoIbge: string; bairro: string; contagem: number }
    >();
    for (const registro of contexto.cadastros) {
      if (!statusValidos.has(registro.followUpStatus)) continue;
      if (
        municipioFiltrado &&
        registro.municipalityId !== municipioFiltrado.ibgeCode
      ) {
        continue;
      }
      const chave = `${registro.municipalityId}|${normalizeNeighborhoodKey(registro.neighborhood)}`;
      const grupo = grupos.get(chave) ?? {
        municipio: registro.municipalityName,
        codigoIbge: registro.municipalityId,
        bairro: registro.neighborhood,
        contagem: 0,
      };
      grupo.contagem += 1;
      grupos.set(chave, grupo);
    }
    const todos = [...grupos.values()];
    gruposSuprimidos = todos.filter((grupo) => grupo.contagem < k).length;
    const visiveis = todos
      .filter((grupo) => grupo.contagem >= k)
      .sort(
        (a, b) =>
          (ordem === "menores"
            ? a.contagem - b.contagem
            : b.contagem - a.contagem) || a.bairro.localeCompare(b.bairro, "pt-BR"),
      );
    cadastrosExibidos = visiveis.reduce((soma, grupo) => soma + grupo.contagem, 0);
    linhas = visiveis.map((grupo) => ({
      codigoIbge: grupo.codigoIbge,
      municipio: grupo.municipio,
      bairro: grupo.bairro,
      cadastros: grupo.contagem,
    }));
  }

  if (gruposSuprimidos > 0) {
    avisos.push(
      `${gruposSuprimidos} ${agrupamento === "bairro" ? plural(gruposSuprimidos, "bairro", "bairros") : plural(gruposSuprimidos, "município", "municípios")} ${plural(gruposSuprimidos, "tinha", "tinham")} menos de ${k} cadastros e ${plural(gruposSuprimidos, "foi suprimido", "foram suprimidos")} por privacidade.`,
    );
  }

  const total = linhas.length;
  const recorte = truncar(
    linhas,
    limite,
    avisos,
    agrupamento === "bairro" ? "bairros" : "municípios",
  );

  return {
    ok: true,
    tipo: "cadastros_agregados",
    total,
    dados: recorte,
    fonte,
    avisos,
    resumo: {
      agrupamento,
      municipio: municipioFiltrado?.name ?? null,
      dataReferencia: metadados.dataReferencia,
      limiarPrivacidade: k,
      gruposSuprimidos,
      cadastrosExibidos,
      municipiosCobertos: modelo.coveredMunicipalityCount,
      modo: metadados.modo,
      ordem,
    },
  };
}

// ---------------------------------------------------------------------------
// Despachante
// ---------------------------------------------------------------------------

type ExecutorFerramenta = (
  argumentos: ArgumentosFerramenta,
  contexto: ContextoAgente,
) => Promise<RespostaFerramenta>;

/**
 * Implementações, indexadas pelo nome declarado em `shared/agent-tools.json`.
 * O teste `agentTools.test.ts` compara as duas listas nos dois sentidos: uma
 * tool declarada sem implementação (ou o contrário) reprova a suíte, que é o
 * que impede a divergência com o backend.
 */
const EXECUTORES: Record<string, ExecutorFerramenta> = {
  ranking_indicador: executarRankingIndicador,
  perfil_municipio: executarPerfilMunicipio,
  espectro_municipios: executarEspectroMunicipios,
  espectro_submunicipal: executarEspectroSubmunicipal,
  resultado_eleicao: executarResultadoEleicao,
  comparar_municipios: executarCompararMunicipios,
  votacao_da_candidata: executarVotacaoDaCandidata,
  cadastros_agregados: executarCadastrosAgregados,
};

export const NOMES_FERRAMENTAS_IMPLEMENTADAS = Object.keys(EXECUTORES);

export function obterDefinicaoFerramenta(nome: string) {
  return FERRAMENTAS_AGENTE.find((ferramenta) => ferramenta.name === nome) ?? null;
}

/**
 * Ponto de entrada do tool calling: valida os argumentos contra o esquema do
 * contrato compartilhado e executa. NUNCA lança — argumento inválido, tool
 * desconhecida ou falha inesperada viram `{ ok: false, motivo }`, porque um
 * throw no meio da conversa derrubaria a resposta do modelo.
 */
export async function executarFerramenta(
  nome: string,
  argumentos: unknown,
  contexto: ContextoAgente,
): Promise<RespostaFerramenta> {
  try {
    const definicao = obterDefinicaoFerramenta(nome);
    if (!definicao) {
      return {
        ok: false,
        motivo: `Ferramenta desconhecida: "${nome}". Disponíveis: ${FERRAMENTAS_AGENTE.map((ferramenta) => ferramenta.name).join(", ")}.`,
      };
    }
    const executor = EXECUTORES[nome];
    if (!executor) {
      return {
        ok: false,
        motivo: `A ferramenta "${nome}" está declarada no contrato mas não tem implementação nesta versão.`,
      };
    }
    if (
      argumentos !== undefined &&
      argumentos !== null &&
      (typeof argumentos !== "object" || Array.isArray(argumentos))
    ) {
      return {
        ok: false,
        motivo: `Argumentos de "${nome}" deveriam ser um objeto JSON.`,
      };
    }
    const valores = (argumentos ?? {}) as ArgumentosFerramenta;
    const erros = validarArgumentos(definicao.parameters, valores);
    if (erros.length > 0) {
      return {
        ok: false,
        motivo: `Argumentos inválidos para "${nome}": ${erros.join("; ")}.`,
      };
    }
    return await executor(valores, contexto);
  } catch (erro) {
    return {
      ok: false,
      motivo: `Falha ao executar "${nome}": ${erro instanceof Error ? erro.message : String(erro)}.`,
    };
  }
}
