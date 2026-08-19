import type {
  AnalysisMetricDefinition,
  AnalysisMetricId,
} from "../types/analysis";
import { ANALYSIS_METRICS, getAnalysisMetric } from "./analysis.ts";

/**
 * CATÁLOGO DE INDICADORES DO RELATÓRIO: metadados que o PDF usa sozinho.
 *
 * NÃO redefine indicador: ESTENDE `ANALYSIS_METRICS` (rótulo, descrição,
 * unidade, fonte, URL oficial, ano de referência e formato) acrescentando
 * denominador, método de cálculo, faixa esperada, limitação conhecida e o texto
 * de metodologia.
 *
 * Duas regras:
 *
 * 1. NADA é fixado por candidatura, partido, cargo, ano, UF ou indicador: a
 *    lista é DERIVADA do catálogo e do dado do recorte (indicador novo em
 *    `analysis.ts` aparece no PDF sem tocar aqui, com metadados padrão).
 * 2. O filtro da tela não entra nesta lista: quem escolhe o que é analisado é a
 *    disponibilidade de dado.
 */

/** Como o indicador se comporta, para o relatório escolher gráfico e leitura. */
export type IndicatorShape =
  /** Percentual limitado a 0–100: comparação de grupos e mediana funcionam bem. */
  | "percentual"
  /** Contagem muito assimétrica (eleitorado, população): pede escala log. */
  | "contagem"
  /** Valor monetário ou contínuo sem teto natural. */
  | "continuo";

export type IndicatorMetadata = {
  id: AnalysisMetricId;
  /** O metric do catálogo, com rótulo, unidade, fonte, URL e ano. */
  metric: AnalysisMetricDefinition;
  shape: IndicatorShape;
  /** Sobre o que o valor é calculado. Vai na página de metodologia. */
  denominator: string;
  /** A conta, em uma frase. */
  method: string;
  /** Faixa que se espera encontrar; fora dela, vale conferir. */
  expectedRange: string;
  /** O que este indicador NÃO diz. Aparece junto da análise. */
  limitation: string;
  /** true quando o eixo deve ser log10 (distribuição muito assimétrica). */
  logScale: boolean;
};

/** Limitação padrão de qualquer indicador municipal cruzado com voto. */
const LIMITACAO_AGREGADA =
  "O valor é do MUNICÍPIO, não de quem votou. Serve para achar associação " +
  "territorial, não para descrever o perfil de quem votou na candidatura.";

/** Indicador ausente daqui não some do relatório: usa `metadataPadrao`. */
const ESPECIFICOS: Partial<Record<AnalysisMetricId, Partial<IndicatorMetadata>>> = {
  electorate: {
    shape: "contagem",
    logScale: true,
    denominator: "Nenhum: é uma contagem absoluta.",
    method: "Total de eleitores aptos com domicílio eleitoral no município.",
    expectedRange: "De poucas centenas a mais de um milhão no mesmo estado.",
    limitation:
      "É contagem, não taxa: municípios grandes dominam qualquer soma. " +
      "A escala do gráfico é logarítmica para as cidades pequenas não " +
      "colapsarem num canto. " + LIMITACAO_AGREGADA,
  },
  female: {
    shape: "percentual",
    denominator: "Eleitorado total do município.",
    method: "Eleitoras do sexo feminino dividido pelo eleitorado, vezes 100.",
    expectedRange: "Geralmente entre 48% e 55%.",
    limitation:
      "Um município com mais mulheres no eleitorado não diz nada sobre em " +
      "quem as mulheres votaram. " + LIMITACAO_AGREGADA,
  },
  electoralPenetration: {
    shape: "percentual",
    denominator: "População residente de 16 anos ou mais (Censo/estimativa).",
    method:
      "Eleitorado cadastrado dividido pela população de 16 anos ou mais, " +
      "vezes 100.",
    expectedRange:
      "Frequentemente acima de 100%, e isso não é erro por si só.",
    limitation:
      "Pode passar de 100% porque o cadastro conta o DOMICÍLIO ELEITORAL e o " +
      "denominador conta a população residente recenseada ou estimada: quem " +
      "mudou de cidade sem transferir o título é contado duas vezes por " +
      "recortes diferentes. " + LIMITACAO_AGREGADA,
  },
  literacyRate15Plus: {
    shape: "percentual",
    denominator: "População de 15 anos ou mais.",
    method: "Pessoas alfabetizadas de 15+ dividido pela população de 15+, vezes 100.",
    expectedRange: "Entre 80% e 99% na maioria dos municípios brasileiros.",
    limitation:
      "Alfabetização não é escolaridade concluída. " + LIMITACAO_AGREGADA,
  },
  share60Plus: {
    shape: "percentual",
    denominator: "População total do município.",
    method: "População de 60 anos ou mais dividido pela população, vezes 100.",
    expectedRange: "Entre 8% e 25%.",
    limitation: LIMITACAO_AGREGADA,
  },
  share16to24: {
    shape: "percentual",
    denominator: "População total do município.",
    method: "População de 16 a 24 anos dividido pela população, vezes 100.",
    expectedRange: "Entre 10% e 20%.",
    limitation: LIMITACAO_AGREGADA,
  },
  gdpPerCapita: {
    shape: "continuo",
    logScale: true,
    denominator: "População residente do município.",
    method: "PIB municipal dividido pela população.",
    expectedRange:
      "Varia em ordens de grandeza; municípios com agroindústria ou " +
      "mineração destoam muito da mediana.",
    limitation:
      "PIB per capita alto não significa renda distribuída: um município com " +
      "uma planta industrial grande e pouca gente tem valor altíssimo sem " +
      "que a população seja rica. " + LIMITACAO_AGREGADA,
  },
  formalAverageSalary: {
    shape: "continuo",
    denominator: "Trabalhadores com vínculo formal.",
    method: "Rendimento médio mensal dos trabalhadores formais, em salários mínimos.",
    expectedRange: "Entre 1,5 e 4 salários mínimos na maior parte dos municípios.",
    limitation:
      "Só quem tem carteira assinada entra na conta — em municípios com muita " +
      "informalidade o valor descreve uma minoria. " + LIMITACAO_AGREGADA,
  },
  lowIncomePopulation: {
    shape: "percentual",
    denominator: "População total do município.",
    method:
      "População com renda per capita de até meio salário mínimo dividido " +
      "pela população, vezes 100.",
    expectedRange: "Entre 15% e 60%.",
    limitation:
      "A referência é de 2010 e é o dado histórico mais recente publicado " +
      "para este recorte: a distância temporal para uma eleição recente é " +
      "grande e a leitura é exploratória. " + LIMITACAO_AGREGADA,
  },
  populationDensity: {
    shape: "continuo",
    logScale: true,
    denominator: "Área do município em km².",
    method: "População residente dividida pela área.",
    expectedRange: "De menos de 2 a mais de 2.000 hab/km².",
    limitation:
      "Densidade é a proxy de urbanização usada aqui, não a taxa de " +
      "urbanização do IBGE: um município extenso com uma cidade concentrada " +
      "tem densidade baixa e população urbana. " + LIMITACAO_AGREGADA,
  },
  censusPopulation: {
    shape: "contagem",
    logScale: true,
    denominator: "Nenhum: é uma contagem absoluta.",
    method: "População residente recenseada.",
    expectedRange: "De poucos milhares a milhões.",
    limitation: "É contagem, não taxa. " + LIMITACAO_AGREGADA,
  },
  populationEstimate: {
    shape: "contagem",
    logScale: true,
    denominator: "Nenhum: é uma contagem absoluta.",
    method: "População residente estimada pelo IBGE.",
    expectedRange: "De poucos milhares a milhões.",
    limitation:
      "Estimativa, não contagem direta: para municípios pequenos o intervalo " +
      "de incerteza é proporcionalmente maior. " + LIMITACAO_AGREGADA,
  },
  schoolAttendance: {
    shape: "percentual",
    denominator: "População de 6 a 14 anos.",
    method: "Crianças de 6 a 14 anos na escola dividido pela faixa, vezes 100.",
    expectedRange: "Entre 95% e 100%.",
    limitation:
      "A faixa é quase universalizada, então o indicador varia pouco e " +
      "associações fracas são esperadas. " + LIMITACAO_AGREGADA,
  },
  adequateSanitation: {
    shape: "percentual",
    denominator: "Domicílios do município.",
    method: "Domicílios com esgotamento adequado dividido pelos domicílios, vezes 100.",
    expectedRange: "Entre 10% e 99%.",
    limitation: LIMITACAO_AGREGADA,
  },
};

function metadataPadrao(metric: AnalysisMetricDefinition): IndicatorMetadata {
  const percentual = metric.unit.includes("%");
  return {
    id: metric.id,
    metric,
    shape: percentual ? "percentual" : "continuo",
    denominator: percentual
      ? "Ver a descrição do indicador."
      : "Nenhum: é uma contagem ou valor absoluto.",
    method: metric.description,
    expectedRange: "Não declarada para este indicador.",
    limitation: LIMITACAO_AGREGADA,
    logScale: false,
  };
}

/** Metadados completos de um indicador, com os padrões preenchidos. */
export function getIndicatorMetadata(id: AnalysisMetricId): IndicatorMetadata {
  const metric = getAnalysisMetric(id);
  return { ...metadataPadrao(metric), ...(ESPECIFICOS[id] ?? {}), id, metric };
}

/** Todos os indicadores do catálogo, com metadados. Ordem do catálogo. */
export function listIndicatorMetadata(): IndicatorMetadata[] {
  return ANALYSIS_METRICS.map((metric) => getIndicatorMetadata(metric.id));
}

/* -------------------------------------------------------------------------
 * Compatibilidade temporal
 * ------------------------------------------------------------------------- */

export type TemporalCompatibility = {
  /** Ano da eleição analisada. */
  electionYear: number;
  /** Ano de referência do indicador. */
  indicatorYear: number;
  /** Distância em anos, com sinal: positivo = indicador posterior à eleição. */
  gap: number;
  level: "mesmo-ano" | "proximo" | "exploratorio";
  /** Aviso para o relatório; vazio quando os anos coincidem. */
  notice: string;
};

/** Acima disso a leitura é declarada exploratória. */
const ANOS_TOLERADOS = 4;

/**
 * Compara o ano da eleição com o do indicador e diz o que o relatório deve
 * declarar: esconder a incompatibilidade faria o texto automático tratar o dado
 * de um ano como se descrevesse o de outro.
 */
export function getTemporalCompatibility(
  electionYear: number,
  indicator: IndicatorMetadata,
): TemporalCompatibility {
  const indicatorYear = indicator.metric.referenceYear;
  const gap = indicatorYear - electionYear;
  const distancia = Math.abs(gap);
  const nome = indicator.metric.label;

  if (gap === 0) {
    return {
      electionYear,
      indicatorYear,
      gap,
      level: "mesmo-ano",
      notice: "",
    };
  }
  const level = distancia <= ANOS_TOLERADOS ? "proximo" : "exploratorio";
  const sentido = gap > 0 ? "posterior" : "anterior";
  const base =
    `A votação é da eleição de ${electionYear} e ${nome.toLowerCase()} tem ` +
    `referência em ${indicatorYear}, ${sentido} ao pleito.`;
  return {
    electionYear,
    indicatorYear,
    gap,
    level,
    notice:
      level === "exploratorio"
        ? `${base} A distância é grande: o cruzamento é exploratório e não ` +
          `representa necessariamente a realidade existente em ${electionYear}.`
        : `${base} O cruzamento é aceitável, mas os anos não coincidem.`,
  };
}
