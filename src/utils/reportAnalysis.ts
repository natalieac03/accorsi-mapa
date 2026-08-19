import type { AnalysisMetricId } from "../types/analysis";
import { pearson, PEARSON_MIN_N } from "./candidateStats.ts";
import { getOfficeLabel } from "./candidate.ts";
import { formatDecimal, formatInteger, formatPercent } from "./electorate.ts";
import {
  getAvailableIndicators,
  getFeaturedIndicator,
  buildIndicatorOmissions,
  orderIndicators,
  type ReportDataset,
  type ReportMunicipio,
  type ReportViewFilter,
} from "./reportDataset.ts";
import {
  getTemporalCompatibility,
  type IndicatorMetadata,
  type TemporalCompatibility,
} from "./reportIndicators.ts";
import type { ReportOmission } from "./reportModel.ts";
import { STATE_LABEL } from "./state.ts";

/**
 * MOTOR DE ANÁLISE do relatório: a estatística e o texto que saem do dado.
 * Roda sobre o `reportDataset` COMPLETO (reportDataset.ts), nunca sobre o
 * recorte da tela: `activeViewFilter` só escolhe qual indicador vem primeiro e
 * qual recebe destaque. Três regras:
 *
 *   1. VOCABULÁRIO. Nada aqui diz causa, impacto, influência, preferência,
 *      determinou ou provocou. Entre indicador municipal e percentual de votos
 *      há ASSOCIAÇÃO, e entre CIDADES, não entre pessoas. Um teste varre todo
 *      texto gerado e falha se uma dessas palavras aparecer;
 *   2. AUSÊNCIA É AUSÊNCIA. Município sem denominador não entra valendo zero:
 *      fica fora, contado e declarado. Indicador sem dado suficiente vira
 *      omissão com motivo;
 *   3. CRITÉRIO DECLARADO. Todo corte está no código, no tipo e no relatório.
 *      Nenhum número mágico.
 */

/* -------------------------------------------------------------------------
 * Ressalvas obrigatórias
 * ------------------------------------------------------------------------- */

/** Acompanha TODA associação calculada. Sem exceção. */
export const RESSALVA_CAUSALIDADE =
  "Correlação não implica causalidade. Outros fatores territoriais podem " +
  "estar associados simultaneamente ao desempenho eleitoral.";

/** Falácia ecológica: o dado é do município, não da pessoa. */
export const RESSALVA_DADO_AGREGADO =
  "Os dados representam características agregadas dos municípios. Eles " +
  "permitem identificar associações territoriais, mas não revelam o perfil " +
  "individual de quem votou na candidatura.";

/** As duas ressalvas, na ordem em que o relatório as publica. */
export const RESSALVAS_OBRIGATORIAS = [
  RESSALVA_CAUSALIDADE,
  RESSALVA_DADO_AGREGADO,
] as const;

/* -------------------------------------------------------------------------
 * Aritmética de apoio
 * ------------------------------------------------------------------------- */

/** Mediana da amostra; null com amostra vazia. */
export function mediana(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordenado = [...values].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 === 0
    ? (ordenado[meio - 1] + ordenado[meio]) / 2
    : ordenado[meio];
}

function media(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((soma, valor) => soma + valor, 0) / values.length;
}

/** Desvio padrão AMOSTRAL (denominador n-1); null com menos de 2 pontos. */
function desvioPadrao(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const centro = media(values) as number;
  const soma = values.reduce(
    (total, valor) => total + (valor - centro) ** 2,
    0,
  );
  return Math.sqrt(soma / (values.length - 1));
}

/** Quantil por interpolação linear (tipo 7, o mesmo do R e do NumPy). */
function quantil(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const ordenado = [...values].sort((a, b) => a - b);
  if (ordenado.length === 1) return ordenado[0];
  const posicao = (ordenado.length - 1) * p;
  const base = Math.floor(posicao);
  const resto = posicao - base;
  const proximo = ordenado[Math.min(base + 1, ordenado.length - 1)];
  return ordenado[base] + resto * (proximo - ordenado[base]);
}

/** Amplitude interquartil (Q3 - Q1): dispersão robusta a valor extremo. */
function amplitudeInterquartil(values: readonly number[]): number | null {
  const q1 = quantil(values, 0.25);
  const q3 = quantil(values, 0.75);
  if (q1 === null || q3 === null) return null;
  return q3 - q1;
}

/**
 * Postos com tratamento de EMPATE por posto médio. Taxas arredondadas a uma
 * casa repetem valor em dezenas de municípios; sem posto médio, a ordem de
 * leitura do arquivo decidiria os postos e o coeficiente mudaria a cada
 * regravação do JSON.
 */
export function postosComEmpate(values: readonly number[]): number[] {
  const ordem = values
    .map((valor, indice) => ({ valor, indice }))
    .sort((a, b) => a.valor - b.valor);
  const postos = new Array<number>(values.length);
  let i = 0;
  while (i < ordem.length) {
    let j = i;
    while (j + 1 < ordem.length && ordem[j + 1].valor === ordem[i].valor) {
      j += 1;
    }
    // Postos são 1-based; empatados recebem a média das posições do bloco.
    const postoMedio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) postos[ordem[k].indice] = postoMedio;
    i = j + 1;
  }
  return postos;
}

/**
 * Coeficiente de Spearman: o Pearson calculado sobre os POSTOS. Com postos
 * médios nos empates, a fórmula abreviada 1 - 6Σd²/n(n²-1) não vale (ela exige
 * ausência de empate). null com menos de 2 pontos ou sem variação de postos.
 */
export function spearman(
  points: ReadonlyArray<{ x: number; y: number }>,
): number | null {
  if (points.length < 2) return null;
  const px = postosComEmpate(points.map((ponto) => ponto.x));
  const py = postosComEmpate(points.map((ponto) => ponto.y));
  return pearson(px.map((x, indice) => ({ x, y: py[indice] })));
}

/* -------------------------------------------------------------------------
 * Correlação e classificação
 * ------------------------------------------------------------------------- */

export type CorrelationInterval = {
  inferior: number;
  superior: number;
  /** Nível de confiança (0,95). */
  nivel: number;
  /** Como foi calculado, para o relatório declarar. */
  metodo: string;
};

export type CorrelationResult = {
  /** Municípios efetivamente cruzados (pares completos). */
  n: number;
  /** Municípios do universo analítico que ficaram fora do par. */
  semPar: number;
  pearson: number | null;
  pearsonIntervalo: CorrelationInterval | null;
  spearman: number | null;
  spearmanIntervalo: CorrelationInterval | null;
  /** true quando o eixo do indicador entrou em log10 (distribuição assimétrica). */
  logScale: boolean;
  /** true quando n < PEARSON_MIN_N: nenhum coeficiente é publicado. */
  amostraInsuficiente: boolean;
};

/** Nível de confiança dos intervalos publicados. */
const NIVEL_CONFIANCA = 0.95;
/** Quantil 0,975 da normal padrão: o 1,96 dos intervalos de 95%. */
const Z_975 = 1.959963985;

/**
 * Intervalo de confiança pela transformação z de Fisher. null com menos de 4
 * municípios (o denominador n-3 zera ou fica negativo) e com |coeficiente| = 1
 * (a transformação diverge): nesses casos o relatório publica o coeficiente sem
 * intervalo, nunca um intervalo falso.
 */
function intervaloFisher(
  coeficiente: number | null,
  n: number,
  erroPadrao: (rho: number) => number,
  metodo: string,
): CorrelationInterval | null {
  if (coeficiente === null || n < 4 || Math.abs(coeficiente) >= 1) return null;
  const z = Math.atanh(coeficiente);
  const erro = erroPadrao(coeficiente);
  if (!Number.isFinite(erro) || erro <= 0) return null;
  return {
    inferior: Math.tanh(z - Z_975 * erro),
    superior: Math.tanh(z + Z_975 * erro),
    nivel: NIVEL_CONFIANCA,
    metodo,
  };
}

export type AssociationDirection =
  | "positiva"
  | "negativa"
  | "sem associação clara";

export type AssociationStrength = "fraca" | "moderada" | "forte";

export type AssociationClassification = {
  direction: AssociationDirection;
  /** Intensidade pelo módulo do coeficiente; "fraca" quando não há direção. */
  strength: AssociationStrength;
  /** Texto pronto: "associação positiva moderada", "sem associação clara". */
  label: string;
  /** O coeficiente que classificou (Spearman); null sem amostra. */
  coeficiente: number | null;
  /** O critério de corte, por extenso, para o relatório publicar. */
  criterio: string;
};

/**
 * CRITÉRIO DE CORTE DA CLASSIFICAÇÃO, publicado no relatório.
 *
 * Classifica pelo SPEARMAN, não pelo Pearson: o catálogo tem contagens muito
 * assimétricas (eleitorado, população, PIB per capita) em que uma única capital
 * domina o coeficiente linear.
 *
 * Cortes sobre o módulo do coeficiente, convencionais em leitura exploratória
 * de ciências sociais:
 *
 *   |ρ| < 0,20  ->  sem associação clara
 *   0,20 a 0,40 ->  fraca
 *   0,40 a 0,60 ->  moderada
 *   >= 0,60     ->  forte
 */
const CORTE_SEM_ASSOCIACAO = 0.2;
const CORTE_MODERADA = 0.4;
const CORTE_FORTE = 0.6;

const CRITERIO_CLASSIFICACAO =
  "Classificação pelo coeficiente de Spearman (postos, com empates tratados " +
  "por posto médio): módulo abaixo de 0,20 é lido como sem associação clara; " +
  "de 0,20 a 0,40, fraca; de 0,40 a 0,60, moderada; 0,60 ou mais, forte.";

export function classifyAssociation(
  coeficiente: number | null,
): AssociationClassification {
  if (coeficiente === null || !Number.isFinite(coeficiente)) {
    return {
      direction: "sem associação clara",
      strength: "fraca",
      label: "sem associação calculada",
      coeficiente: null,
      criterio: CRITERIO_CLASSIFICACAO,
    };
  }
  const modulo = Math.abs(coeficiente);
  const strength: AssociationStrength =
    modulo >= CORTE_FORTE
      ? "forte"
      : modulo >= CORTE_MODERADA
        ? "moderada"
        : "fraca";
  if (modulo < CORTE_SEM_ASSOCIACAO) {
    return {
      direction: "sem associação clara",
      strength: "fraca",
      label: "sem associação clara",
      coeficiente,
      criterio: CRITERIO_CLASSIFICACAO,
    };
  }
  const direction: AssociationDirection = coeficiente > 0 ? "positiva" : "negativa";
  return {
    direction,
    strength,
    label: `associação ${direction} ${strength}`,
    coeficiente,
    criterio: CRITERIO_CLASSIFICACAO,
  };
}

/* -------------------------------------------------------------------------
 * Comparação de grupos
 * ------------------------------------------------------------------------- */

export type GroupId = "abaixo" | "igualOuAcima";

export type GroupStats = {
  id: GroupId;
  /** "Municípios com PIB per capita abaixo da mediana", já pronto. */
  label: string;
  municipios: number;
  /** Mediana do % dos válidos no grupo; null com grupo vazio. */
  medianaPctValidos: number | null;
  mediaPctValidos: number | null;
  /** Dispersão: desvio padrão amostral e amplitude interquartil. */
  desvioPadraoPctValidos: number | null;
  amplitudeInterquartilPctValidos: number | null;
  /** Eleitorado somado dos municípios do grupo; null sem snapshot. */
  eleitoradoCoberto: number | null;
  /** Votos somados do grupo. */
  votos: number;
};

export type GroupComparison = {
  /** O critério de corte, por extenso. */
  criterio: string;
  /** Valor do indicador que separa os grupos. */
  corte: number;
  grupos: GroupStats[];
  /** Mediana do grupo "igual ou acima" menos a do grupo "abaixo" (p.p.). */
  diferencaMediana: number | null;
  diferencaMedia: number | null;
};

/**
 * CRITÉRIO DO CORTE DE GRUPOS: a MEDIANA do indicador entre os municípios
 * analisados. Mediana e não média porque metade do catálogo é contagem
 * assimétrica (eleitorado, população, PIB per capita), em que "acima da média"
 * viria com meia dúzia de cidades. Município com valor EXATAMENTE igual à
 * mediana entra no grupo "igual ou acima": com taxas arredondadas a uma casa, o
 * empate na mediana é comum.
 */
const CRITERIO_GRUPOS =
  "Corte pela mediana do indicador entre os municípios analisados; " +
  "município com valor igual à mediana entra no grupo “igual ou acima”.";

function estatisticasDoGrupo(
  id: GroupId,
  label: string,
  municipios: readonly ReportMunicipio[],
): GroupStats {
  const percentuais = municipios.map(
    (municipio) => municipio.percentualValidos as number,
  );
  const comEleitorado = municipios.filter(
    (municipio) => municipio.eleitorado !== null,
  );
  return {
    id,
    label,
    municipios: municipios.length,
    medianaPctValidos: mediana(percentuais),
    mediaPctValidos: media(percentuais),
    desvioPadraoPctValidos: desvioPadrao(percentuais),
    amplitudeInterquartilPctValidos: amplitudeInterquartil(percentuais),
    eleitoradoCoberto:
      comEleitorado.length === 0
        ? null
        : comEleitorado.reduce(
            (total, municipio) => total + (municipio.eleitorado as number),
            0,
          ),
    votos: municipios.reduce((total, municipio) => total + municipio.votos, 0),
  };
}

/* -------------------------------------------------------------------------
 * Quadrantes
 * ------------------------------------------------------------------------- */

export type QuadrantId =
  | "indicadorAcimaVotacaoAcima"
  | "indicadorAcimaVotacaoAbaixo"
  | "indicadorAbaixoVotacaoAcima"
  | "indicadorAbaixoVotacaoAbaixo";

export type QuadrantMunicipality = {
  ibgeCode: string;
  nome: string;
  valorIndicador: number;
  percentualValidos: number;
  votos: number;
};

export type Quadrant = {
  id: QuadrantId;
  /**
   * Nome NEUTRO, descritivo do corte. Nenhum quadrante se chama oportunidade,
   * ameaça ou prioridade: isso é decisão de campanha, não leitura de dado.
   */
  label: string;
  municipios: number;
  /** No máximo `limiteExemplos`, os de maior votação absoluta. */
  exemplos: QuadrantMunicipality[];
  limiteExemplos: number;
};

export type QuadrantAnalysis = {
  criterio: string;
  medianaIndicador: number;
  medianaPercentualValidos: number;
  quadrantes: Quadrant[];
};

/** Limite de exemplos por quadrante: a lista é ilustrativa, não um ranking. */
const MAX_MUNICIPIOS_POR_QUADRANTE = 5;

const CRITERIO_QUADRANTES =
  "Quatro grupos formados pelo cruzamento das medianas dos dois eixos: a " +
  "mediana do indicador e a mediana do percentual dos válidos, ambas " +
  "calculadas sobre os municípios analisados. Valor igual à mediana entra no " +
  `lado “acima”. Cada grupo lista no máximo ${MAX_MUNICIPIOS_POR_QUADRANTE} ` +
  "municípios, os de maior votação absoluta.";

/* -------------------------------------------------------------------------
 * Municípios atípicos
 * ------------------------------------------------------------------------- */

export type OutlierMunicipality = {
  ibgeCode: string;
  nome: string;
  valorIndicador: number;
  percentualValidos: number;
  /** Percentual que a reta de tendência descreve para aquele valor de X. */
  esperado: number;
  /** Observado menos descrito pela reta, em pontos percentuais. */
  residuo: number;
  /** Resíduo dividido pelo desvio padrão dos resíduos. */
  residuoPadronizado: number;
  /** "acima da tendência" | "abaixo da tendência": descritivo, sem juízo. */
  sentido: "acima da tendência" | "abaixo da tendência";
  votos: number;
};

export type OutlierAnalysis = {
  criterio: string;
  /** Módulo do resíduo padronizado a partir do qual o município é listado. */
  limite: number;
  desvioResidual: number | null;
  municipios: OutlierMunicipality[];
};

/**
 * CRITÉRIO DE ATÍPICO: resíduo padronizado com módulo acima de 2. A reta é a de
 * mínimos quadrados do percentual dos válidos sobre o eixo do indicador (log10
 * quando o indicador pede escala log), e o resíduo é a distância vertical até
 * ela dividida pelo desvio padrão dos resíduos. Sob dispersão aproximadamente
 * normal, cerca de 5% dos municípios ficam além do corte. "Atípico" aqui é só
 * afastamento da tendência do conjunto: não é anomalia de apuração.
 */
const LIMITE_RESIDUO_PADRONIZADO = 2;
/** Teto da lista de atípicos. */
const MAX_ATIPICOS = 10;

const CRITERIO_ATIPICOS =
  "Município atípico é o que se afasta da reta de tendência (mínimos " +
  "quadrados do percentual dos válidos sobre o eixo do indicador) em mais de " +
  `${LIMITE_RESIDUO_PADRONIZADO} desvios padrão dos resíduos. A lista traz no ` +
  `máximo ${MAX_ATIPICOS} municípios, dos mais distantes aos menos.`;

/* -------------------------------------------------------------------------
 * Concentração (curva de Pareto)
 * ------------------------------------------------------------------------- */

export type ConcentrationPoint = {
  posicao: number;
  ibgeCode: string;
  nome: string;
  votos: number;
  /** Participação do município no total de votos do pleito, em %. */
  participacaoPct: number;
  /** Acumulado até esta posição, em %. */
  acumuladoPct: number;
};

export type ConcentrationAnalysis = {
  /** Um ponto por município com voto, do mais votado ao menos votado. */
  pontos: ConcentrationPoint[];
  municipios: number;
  totalVotos: number;
  /** % dos votos nos 5 / 10 / 20 municípios mais votados; null sem votos. */
  top5Pct: number | null;
  top10Pct: number | null;
  top20Pct: number | null;
  /** Quantos municípios reúnem metade dos votos; null sem votos. */
  municipiosParaMetade: number | null;
  /** Como foi calculado, para o relatório declarar. */
  criterio: string;
};

/**
 * Curva acumulada sobre TODOS os municípios com voto apurado, inclusive os que
 * ficaram fora da análise de associação por não terem denominador: o total de
 * votos da candidatura é dado apurado e não depende de denominador.
 */
export function buildConcentration(
  dataset: ReportDataset,
): ConcentrationAnalysis {
  const ordenados = [...dataset.municipios].sort(
    (a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, "pt-BR"),
  );
  const total = ordenados.reduce((soma, municipio) => soma + municipio.votos, 0);
  const pontos: ConcentrationPoint[] = [];
  let acumulado = 0;
  let municipiosParaMetade: number | null = null;
  for (const [indice, municipio] of ordenados.entries()) {
    acumulado += municipio.votos;
    const acumuladoPct = total > 0 ? (acumulado / total) * 100 : 0;
    if (municipiosParaMetade === null && total > 0 && acumuladoPct >= 50) {
      municipiosParaMetade = indice + 1;
    }
    pontos.push({
      posicao: indice + 1,
      ibgeCode: municipio.ibgeCode,
      nome: municipio.nome,
      votos: municipio.votos,
      participacaoPct: total > 0 ? (municipio.votos / total) * 100 : 0,
      acumuladoPct,
    });
  }
  const topPct = (quantos: number) => {
    if (total <= 0 || pontos.length === 0) return null;
    const corte = Math.min(quantos, pontos.length);
    return pontos[corte - 1].acumuladoPct;
  };
  return {
    pontos,
    municipios: pontos.length,
    totalVotos: total,
    top5Pct: topPct(5),
    top10Pct: topPct(10),
    top20Pct: topPct(20),
    municipiosParaMetade: total > 0 ? municipiosParaMetade : null,
    criterio:
      "Municípios ordenados do mais votado ao menos votado; o acumulado é " +
      "sobre a soma dos votos apurados no pleito. Quando o recorte tem menos " +
      "municípios do que o corte pedido, o valor é o acumulado de todos eles.",
  };
}

/* -------------------------------------------------------------------------
 * Análise de um indicador
 * ------------------------------------------------------------------------- */

export type IndicatorAnalysis = {
  indicator: IndicatorMetadata;
  /** true quando é o indicador em destaque (o selecionado na tela). */
  destaque: boolean;
  correlacao: CorrelationResult;
  classificacao: AssociationClassification;
  grupos: GroupComparison | null;
  quadrantes: QuadrantAnalysis | null;
  atipicos: OutlierAnalysis;
  /** Frase curta gerada só do dado apurado, no vocabulário permitido. */
  interpretacao: string;
  /** Compatibilidade entre o ano da eleição e o ano do indicador. */
  compatibilidade: TemporalCompatibility;
  /** As duas obrigatórias, a limitação do indicador e o aviso temporal. */
  ressalvas: string[];
};

/** "1 município" / "12 municípios": concordância do texto gerado. */
function contarMunicipios(quantidade: number): string {
  return `${formatInteger(quantidade)} ${quantidade === 1 ? "município" : "municípios"}`;
}

/**
 * Coeficiente em pt-BR com 2 casas. Exportada para quem renderiza o relatório
 * escrever o mesmo número do mesmo jeito que o texto de interpretação.
 */
export function formatAssociationCoefficient(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/** Um par (indicador, % dos válidos) pronto para a estatística. */
type Par = {
  municipio: ReportMunicipio;
  /** Valor bruto do indicador. */
  valor: number;
  /** Valor no eixo (log10 do bruto quando o indicador pede escala log). */
  eixo: number;
  /** % dos válidos do município. */
  y: number;
};

/**
 * Pares completos do universo analítico para um indicador. Com escala log,
 * município com valor menor ou igual a zero fica fora (log10 de zero não
 * existe): exclusão declarada, entra em `semPar`.
 */
function montarPares(
  dataset: ReportDataset,
  indicator: IndicatorMetadata,
): Par[] {
  const pares: Par[] = [];
  for (const municipio of dataset.analiticos) {
    const valor = municipio.indicadores[indicator.id];
    if (valor === null) continue;
    if (indicator.logScale && valor <= 0) continue;
    pares.push({
      municipio,
      valor,
      eixo: indicator.logScale ? Math.log10(valor) : valor,
      y: municipio.percentualValidos as number,
    });
  }
  // Ordem estável para qualquer saída derivada ser determinística.
  pares.sort((a, b) =>
    a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR"),
  );
  return pares;
}

function calcularCorrelacao(
  pares: readonly Par[],
  semPar: number,
  logScale: boolean,
): CorrelationResult {
  const n = pares.length;
  const amostraInsuficiente = n < PEARSON_MIN_N;
  const pontos = pares.map((par) => ({ x: par.eixo, y: par.y }));
  const coefPearson = amostraInsuficiente ? null : pearson(pontos);
  const coefSpearman = amostraInsuficiente ? null : spearman(pontos);
  return {
    n,
    semPar,
    pearson: coefPearson,
    // Erro padrão clássico de Fisher para o Pearson: 1/√(n-3).
    pearsonIntervalo: intervaloFisher(
      coefPearson,
      n,
      () => 1 / Math.sqrt(n - 3),
      "Transformação z de Fisher, erro padrão 1/√(n−3).",
    ),
    spearman: coefSpearman,
    // Para o Spearman, o erro padrão de Bonett–Wright: √((1+ρ²/2)/(n-3)).
    spearmanIntervalo: intervaloFisher(
      coefSpearman,
      n,
      (rho) => Math.sqrt((1 + rho ** 2 / 2) / (n - 3)),
      "Transformação z de Fisher com erro padrão de Bonett–Wright, √((1+ρ²/2)/(n−3)).",
    ),
    logScale,
    amostraInsuficiente,
  };
}

function compararGrupos(
  pares: readonly Par[],
  indicator: IndicatorMetadata,
): GroupComparison | null {
  const corte = mediana(pares.map((par) => par.valor));
  if (corte === null) return null;
  const nome = indicator.metric.label;
  const acima = pares
    .filter((par) => par.valor >= corte)
    .map((par) => par.municipio);
  const abaixo = pares
    .filter((par) => par.valor < corte)
    .map((par) => par.municipio);
  const grupos = [
    estatisticasDoGrupo(
      "igualOuAcima",
      `Municípios com ${nome} igual ou acima da mediana`,
      acima,
    ),
    estatisticasDoGrupo(
      "abaixo",
      `Municípios com ${nome} abaixo da mediana`,
      abaixo,
    ),
  ];
  const diferenca = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a - b;
  return {
    criterio: CRITERIO_GRUPOS,
    corte,
    grupos,
    diferencaMediana: diferenca(
      grupos[0].medianaPctValidos,
      grupos[1].medianaPctValidos,
    ),
    diferencaMedia: diferenca(
      grupos[0].mediaPctValidos,
      grupos[1].mediaPctValidos,
    ),
  };
}

const ROTULO_QUADRANTE: Record<QuadrantId, [boolean, boolean]> = {
  // [indicador acima da mediana, percentual dos válidos acima da mediana]
  indicadorAcimaVotacaoAcima: [true, true],
  indicadorAcimaVotacaoAbaixo: [true, false],
  indicadorAbaixoVotacaoAcima: [false, true],
  indicadorAbaixoVotacaoAbaixo: [false, false],
};

function montarQuadrantes(
  pares: readonly Par[],
  indicator: IndicatorMetadata,
): QuadrantAnalysis | null {
  const medianaIndicador = mediana(pares.map((par) => par.valor));
  const medianaVotacao = mediana(pares.map((par) => par.y));
  if (medianaIndicador === null || medianaVotacao === null) return null;
  const nome = indicator.metric.label;

  const quadrantes = (
    Object.keys(ROTULO_QUADRANTE) as QuadrantId[]
  ).map((id): Quadrant => {
    const [indicadorAcima, votacaoAcima] = ROTULO_QUADRANTE[id];
    const dentro = pares.filter(
      (par) =>
        (par.valor >= medianaIndicador) === indicadorAcima &&
        (par.y >= medianaVotacao) === votacaoAcima,
    );
    const exemplos = [...dentro]
      .sort(
        (a, b) =>
          b.municipio.votos - a.municipio.votos ||
          a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR"),
      )
      .slice(0, MAX_MUNICIPIOS_POR_QUADRANTE)
      .map((par) => ({
        ibgeCode: par.municipio.ibgeCode,
        nome: par.municipio.nome,
        valorIndicador: par.valor,
        percentualValidos: par.y,
        votos: par.municipio.votos,
      }));
    return {
      id,
      label:
        `${nome} ${indicadorAcima ? "igual ou acima" : "abaixo"} da mediana · ` +
        `percentual dos válidos ${votacaoAcima ? "igual ou acima" : "abaixo"} da mediana`,
      municipios: dentro.length,
      exemplos,
      limiteExemplos: MAX_MUNICIPIOS_POR_QUADRANTE,
    };
  });

  return {
    criterio: CRITERIO_QUADRANTES,
    medianaIndicador,
    medianaPercentualValidos: medianaVotacao,
    quadrantes,
  };
}

function encontrarAtipicos(pares: readonly Par[]): OutlierAnalysis {
  const vazio: OutlierAnalysis = {
    criterio: CRITERIO_ATIPICOS,
    limite: LIMITE_RESIDUO_PADRONIZADO,
    desvioResidual: null,
    municipios: [],
  };
  // Sem amostra mínima não há tendência para ninguém se afastar.
  if (pares.length < PEARSON_MIN_N) return vazio;

  const n = pares.length;
  const mediaX = media(pares.map((par) => par.eixo)) as number;
  const mediaY = media(pares.map((par) => par.y)) as number;
  let sxy = 0;
  let sxx = 0;
  for (const par of pares) {
    sxy += (par.eixo - mediaX) * (par.y - mediaY);
    sxx += (par.eixo - mediaX) ** 2;
  }
  // Eixo sem variação: a reta não existe (divisão por zero).
  if (sxx === 0) return vazio;

  const inclinacao = sxy / sxx;
  const intercepto = mediaY - inclinacao * mediaX;
  const residuos = pares.map((par) => par.y - (intercepto + inclinacao * par.eixo));
  // Denominador n-2: dois parâmetros da reta foram estimados dos dados.
  const soma = residuos.reduce((total, residuo) => total + residuo ** 2, 0);
  const desvio = n > 2 ? Math.sqrt(soma / (n - 2)) : null;
  if (desvio === null || desvio === 0) {
    return { ...vazio, desvioResidual: desvio };
  }

  const municipios = pares
    .map((par, indice) => {
      const residuo = residuos[indice];
      return {
        ibgeCode: par.municipio.ibgeCode,
        nome: par.municipio.nome,
        valorIndicador: par.valor,
        percentualValidos: par.y,
        esperado: intercepto + inclinacao * par.eixo,
        residuo,
        residuoPadronizado: residuo / desvio,
        sentido:
          residuo >= 0
            ? ("acima da tendência" as const)
            : ("abaixo da tendência" as const),
        votos: par.municipio.votos,
      };
    })
    .filter(
      (item) =>
        Math.abs(item.residuoPadronizado) > LIMITE_RESIDUO_PADRONIZADO,
    )
    .sort(
      (a, b) =>
        Math.abs(b.residuoPadronizado) - Math.abs(a.residuoPadronizado) ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    )
    .slice(0, MAX_ATIPICOS);

  return {
    criterio: CRITERIO_ATIPICOS,
    limite: LIMITE_RESIDUO_PADRONIZADO,
    desvioResidual: desvio,
    municipios,
  };
}

/**
 * Frase de interpretação, gerada só do que foi apurado: descreve a associação e
 * o contraste entre os dois grupos, e não diz por que os números são o que são.
 */
function escreverInterpretacao(
  indicator: IndicatorMetadata,
  correlacao: CorrelationResult,
  classificacao: AssociationClassification,
  grupos: GroupComparison | null,
): string {
  const nome = indicator.metric.label;
  if (correlacao.amostraInsuficiente || classificacao.coeficiente === null) {
    return (
      `Só ${contarMunicipios(correlacao.n)} ${correlacao.n === 1 ? "tem" : "têm"}, ao mesmo tempo, ` +
      `percentual dos válidos apurado e valor de ${nome.toLowerCase()} — ` +
      `abaixo do mínimo de ${PEARSON_MIN_N}. Nenhum coeficiente é publicado ` +
      "para este cruzamento."
    );
  }

  const partes: string[] = [];
  partes.push(
    `Entre os ${contarMunicipios(correlacao.n)} com percentual dos ` +
      `válidos apurado e valor de ${nome.toLowerCase()}, o coeficiente de ` +
      `Spearman é ${formatAssociationCoefficient(classificacao.coeficiente)} — ` +
      `${classificacao.label}.`,
  );

  // "valor mais alto de <indicador>" evita concordar adjetivo com o gênero do
  // rótulo, que varia por indicador do catálogo.
  if (classificacao.direction === "sem associação clara") {
    partes.push(
      `Municípios com valor mais alto de ${nome.toLowerCase()} não aparecem, ` +
        "no conjunto, com percentual dos válidos sistematicamente mais alto " +
        "nem mais baixo.",
    );
  } else {
    const sentido = classificacao.direction === "positiva" ? "mais alto" : "mais baixo";
    partes.push(
      `Municípios com valor mais alto de ${nome.toLowerCase()} aparecem, em ` +
        `geral, com percentual dos válidos ${sentido}.`,
    );
  }

  const acima = grupos?.grupos[0];
  const abaixo = grupos?.grupos[1];
  if (
    grupos &&
    acima?.medianaPctValidos != null &&
    abaixo?.medianaPctValidos != null &&
    grupos.diferencaMediana !== null
  ) {
    // Sinal em ASCII, igual ao que `formatAssociationCoefficient` produz:
    // dois traços diferentes no mesmo parágrafo parecem erro de fonte.
    const sinal = grupos.diferencaMediana >= 0 ? "+" : "-";
    // O plural segue o número EXIBIDO (1 casa), não o valor cheio: escrever
    // "1,0 pontos percentuais" ao lado de "1,0" seria erro de leitura.
    const distancia = Math.round(Math.abs(grupos.diferencaMediana) * 10) / 10;
    const unidade = distancia === 1 ? "ponto percentual" : "pontos percentuais";
    partes.push(
      `A mediana do percentual dos válidos é ` +
        `${formatPercent(acima.medianaPctValidos)} nos ` +
        `${contarMunicipios(acima.municipios)} com o indicador igual ` +
        `ou acima da mediana e ${formatPercent(abaixo.medianaPctValidos)} nos ` +
        `${formatInteger(abaixo.municipios)} abaixo dela ` +
        `(${sinal}${formatDecimal(distancia)} ${unidade}).`,
    );
  }
  return partes.join(" ");
}

/**
 * Análise completa de UM indicador contra a métrica eleitoral principal. Um
 * capítulo do relatório, sem depender do que está selecionado na tela.
 */
export function analyzeIndicator(input: {
  dataset: ReportDataset;
  indicator: IndicatorMetadata;
  destaque?: boolean;
}): IndicatorAnalysis {
  const { dataset, indicator } = input;
  const pares = montarPares(dataset, indicator);
  const semPar = dataset.analiticos.length - pares.length;
  const correlacao = calcularCorrelacao(pares, semPar, indicator.logScale);
  const classificacao = classifyAssociation(correlacao.spearman);
  const grupos = compararGrupos(pares, indicator);
  const compatibilidade = getTemporalCompatibility(
    dataset.electionYear,
    indicator,
  );
  const ressalvas = [
    RESSALVA_CAUSALIDADE,
    RESSALVA_DADO_AGREGADO,
    indicator.limitation,
  ];
  if (compatibilidade.notice) ressalvas.push(compatibilidade.notice);

  return {
    indicator,
    destaque: input.destaque ?? false,
    correlacao,
    classificacao,
    grupos,
    quadrantes: montarQuadrantes(pares, indicator),
    atipicos: encontrarAtipicos(pares),
    interpretacao: escreverInterpretacao(
      indicator,
      correlacao,
      classificacao,
      grupos,
    ),
    compatibilidade,
    ressalvas,
  };
}

/* -------------------------------------------------------------------------
 * Resumo executivo
 * ------------------------------------------------------------------------- */

export type ExecutiveSummary = {
  /** No máximo 4 frases, só de número apurado. */
  frases: string[];
};

/** Teto duro do resumo: quatro frases. */
const MAX_FRASES_RESUMO = 4;

/** Resumo executivo: só número apurado, nenhuma leitura política. */
export function buildExecutiveSummary(input: {
  dataset: ReportDataset;
  concentracao: ConcentrationAnalysis;
}): ExecutiveSummary {
  const { dataset, concentracao } = input;
  const frases: string[] = [];
  const cargo = getOfficeLabel({
    officeCode: dataset.officeCode,
    officeName: dataset.officeName,
    round: dataset.round,
  });

  frases.push(
    `Eleição de ${dataset.electionYear} para ${cargo}: ` +
      `${formatInteger(dataset.votosNoPleito)} votos nominais apurados em ` +
      `${contarMunicipios(dataset.municipios.length)} de ${STATE_LABEL}.`,
  );

  // Cortes escritos com o número REAL de municípios do recorte: "os 20
  // primeiros" num pleito de 8 municípios seria frase falsa.
  const totalMunicipios = dataset.municipios.length;
  if (
    totalMunicipios > 1 &&
    concentracao.top5Pct !== null &&
    concentracao.top20Pct !== null
  ) {
    const primeiroCorte = Math.min(5, totalMunicipios);
    const segundoCorte = Math.min(20, totalMunicipios);
    frases.push(
      primeiroCorte === segundoCorte
        ? `Os ${contarMunicipios(primeiroCorte)} mais votados reúnem ` +
          `${formatPercent(concentracao.top5Pct)} dos votos.`
        : `Os ${contarMunicipios(primeiroCorte)} mais votados reúnem ` +
          `${formatPercent(concentracao.top5Pct)} dos votos e os ` +
          `${segundoCorte} primeiros, ${formatPercent(concentracao.top20Pct)}.`,
    );
  }

  const percentuais = dataset.analiticos.map(
    (municipio) => municipio.percentualValidos as number,
  );
  const medianaPct = mediana(percentuais);
  if (medianaPct !== null) {
    frases.push(
      `${formatInteger(dataset.analiticos.length)} de ` +
        `${contarMunicipios(dataset.municipios.length)} ${dataset.analiticos.length === 1 ? "tem" : "têm"} percentual ` +
        `dos válidos apurado; a mediana é ${formatPercent(medianaPct)} e o maior ` +
        `valor, ${formatPercent(Math.max(...percentuais))}.`,
    );
  } else {
    frases.push(
      `Nenhum dos ${contarMunicipios(dataset.municipios.length)} do ` +
        "recorte tem total de votos válidos apurado.",
    );
  }

  const disponiveis = getAvailableIndicators(dataset).length;
  const total = dataset.indicadores.length;
  frases.push(
    `${formatInteger(disponiveis)} dos ${formatInteger(total)} indicadores ` +
      `territoriais ${disponiveis === 1 ? "tem" : "têm"} dado suficiente para ` +
      `cruzamento neste recorte; ${
        total - disponiveis === 1
          ? "o restante está declarado"
          : `os ${formatInteger(total - disponiveis)} restantes estão declarados`
      } como não analisado${total - disponiveis === 1 ? "" : "s"}.`,
  );

  return { frases: frases.slice(0, MAX_FRASES_RESUMO) };
}

/* -------------------------------------------------------------------------
 * A análise inteira
 * ------------------------------------------------------------------------- */

export type ReportAnalysis = {
  dataset: ReportDataset;
  /** O indicador em destaque; null quando a tela não tem seleção com dado. */
  featuredIndicator: IndicatorMetadata | null;
  /** Uma análise por indicador DISPONÍVEL, destaque primeiro. */
  indicadores: IndicatorAnalysis[];
  concentracao: ConcentrationAnalysis;
  resumo: ExecutiveSummary;
  /** Indicadores sem dado suficiente, declarados com motivo. */
  omissoes: ReportOmission[];
  /** As duas ressalvas obrigatórias do relatório. */
  ressalvas: string[];
  /** Municípios fora da análise por falta de denominador, contados. */
  municipiosExcluidos: number;
  /** Frase pronta declarando a exclusão; vazia quando não houve nenhuma. */
  notaExclusoes: string;
};

/**
 * A análise completa do pleito. `activeViewFilter` é o ÚNICO ponto de entrada
 * do estado da interface e só escolhe ordem e destaque: não acrescenta nem
 * remove indicador, município ou número.
 */
export function buildReportAnalysis(input: {
  dataset: ReportDataset;
  activeViewFilter?: ReportViewFilter | null;
}): ReportAnalysis {
  const { dataset } = input;
  const filtro = input.activeViewFilter ?? null;
  const featured = getFeaturedIndicator(dataset, filtro);
  const disponiveis = orderIndicators(
    getAvailableIndicators(dataset),
    featured?.id ?? null,
  );
  const indicadores = disponiveis.map((item) =>
    analyzeIndicator({
      dataset,
      indicator: item.indicator,
      destaque: item.id === featured?.id,
    }),
  );
  const concentracao = buildConcentration(dataset);
  const excluidos = dataset.exclusoes.length;

  return {
    dataset,
    featuredIndicator: featured,
    indicadores,
    concentracao,
    resumo: buildExecutiveSummary({ dataset, concentracao }),
    omissoes: buildIndicatorOmissions(dataset),
    ressalvas: [...RESSALVAS_OBRIGATORIAS],
    municipiosExcluidos: excluidos,
    notaExclusoes:
      excluidos === 0
        ? ""
        : `${formatInteger(excluidos)} de ` +
          `${contarMunicipios(dataset.municipios.length)} ${excluidos === 1 ? "ficou" : "ficaram"} fora ` +
          "da análise de associação por não ter total de votos válidos " +
          "apurado. Os votos seguem contados no total do pleito e na " +
          "concentração, e nada entra em cálculo nenhum valendo zero.",
  };
}

/**
 * Todo texto gerado por esta análise, em uma lista: é o que o teste de
 * vocabulário varre. A coleta fica aqui (e não no teste) para que campo de
 * texto novo entre na varredura junto com o campo.
 */
export function collectAnalysisTexts(analysis: ReportAnalysis): string[] {
  const textos: string[] = [
    ...analysis.resumo.frases,
    ...analysis.ressalvas,
    analysis.notaExclusoes,
    analysis.concentracao.criterio,
    ...analysis.omissoes.flatMap((omissao) => [omissao.title, omissao.reason]),
    ...analysis.dataset.exclusoes.map((exclusao) => exclusao.descricao),
  ];
  for (const item of analysis.indicadores) {
    textos.push(item.interpretacao);
    textos.push(item.classificacao.label);
    textos.push(item.classificacao.criterio);
    textos.push(item.atipicos.criterio);
    textos.push(item.compatibilidade.notice);
    textos.push(...item.ressalvas);
    if (item.grupos) {
      textos.push(item.grupos.criterio);
      textos.push(...item.grupos.grupos.map((grupo) => grupo.label));
    }
    if (item.quadrantes) {
      textos.push(item.quadrantes.criterio);
      textos.push(...item.quadrantes.quadrantes.map((quadrante) => quadrante.label));
    }
    textos.push(...item.atipicos.municipios.map((municipio) => municipio.sentido));
  }
  return textos.filter((texto) => texto.trim() !== "");
}

/** Ids dos indicadores analisados, na ordem publicada. Atalho para os testes. */
export function listAnalyzedIndicatorIds(
  analysis: ReportAnalysis,
): AnalysisMetricId[] {
  return analysis.indicadores.map((item) => item.indicator.id);
}
