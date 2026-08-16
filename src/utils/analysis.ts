import type {
  AnalysisBand,
  AnalysisMetricDefinition,
  AnalysisMetricId,
  AnalysisModel,
  AnalysisState,
} from "../types/analysis";
import type { MunicipalityProfile } from "../types/electorate";
import { createCsv, formatCsvDecimal } from "./csv.ts";
import {
  formatCurrency,
  formatDecimal,
  formatInteger,
  formatPercent,
  percentage,
} from "./electorate.ts";

export const ALL_ANALYSIS_BANDS: AnalysisBand[] = [0, 1, 2, 3, 4];

const TSE_SOURCE_URL =
  "https://www.tse.jus.br/eleicoes/estatisticas/estatisticas-de-eleitorado/consulta-por-regiao-uf-municipio-zona";
const IBGE_SOURCE_URL = "https://servicodados.ibge.gov.br/api/docs/pesquisas";
const CENSUS_AGE_SOURCE_URL = "https://sidra.ibge.gov.br/tabela/9514";
const CENSUS_LITERACY_SOURCE_URL = "https://sidra.ibge.gov.br/tabela/9542";

export const ANALYSIS_METRICS: AnalysisMetricDefinition[] = [
  {
    id: "electorate",
    label: "Eleitorado total",
    shortLabel: "Eleitorado",
    description: "Quantidade de pessoas aptas a votar em cada município.",
    unit: "eleitores",
    source: "TSE",
    sourceLabel: "TSE — Perfil do Eleitorado",
    sourceUrl: TSE_SOURCE_URL,
    referenceYear: 2026,
    sourceIndicatorId: "eleitorado_2026",
    valueFormat: "integer",
  },
  {
    id: "biometrics",
    label: "Cadastro com biometria",
    shortLabel: "Biometria",
    description: "Percentual do eleitorado municipal com biometria cadastrada.",
    unit: "% do eleitorado",
    source: "TSE",
    sourceLabel: "TSE — Perfil do Eleitorado",
    sourceUrl: TSE_SOURCE_URL,
    referenceYear: 2026,
    sourceIndicatorId: "biometria_2026",
    valueFormat: "percent",
  },
  {
    id: "disability",
    label: "Deficiência cadastrada",
    shortLabel: "Deficiência",
    description:
      "Percentual do eleitorado com deficiência informada no cadastro eleitoral.",
    unit: "% do eleitorado",
    source: "TSE",
    sourceLabel: "TSE — Perfil do Eleitorado",
    sourceUrl: TSE_SOURCE_URL,
    referenceYear: 2026,
    sourceIndicatorId: "deficiencia_2026",
    valueFormat: "percent",
  },
  {
    id: "female",
    label: "Mulheres no cadastro",
    shortLabel: "Mulheres",
    description: "Participação feminina no cadastro eleitoral municipal.",
    unit: "% do eleitorado",
    source: "TSE",
    sourceLabel: "TSE — Perfil do Eleitorado",
    sourceUrl: TSE_SOURCE_URL,
    referenceYear: 2026,
    sourceIndicatorId: "genero_feminino_2026",
    valueFormat: "percent",
  },
  {
    id: "socialName",
    label: "Uso de nome social",
    shortLabel: "Nome social",
    description: "Cadastros com nome social a cada 10 mil pessoas do eleitorado.",
    unit: "por 10 mil",
    source: "TSE",
    sourceLabel: "TSE — Perfil do Eleitorado",
    sourceUrl: TSE_SOURCE_URL,
    referenceYear: 2026,
    sourceIndicatorId: "nome_social_2026",
    valueFormat: "rate",
  },
  {
    id: "electorsPerZone",
    label: "Eleitores por zona",
    shortLabel: "Por zona",
    description: "Média municipal de eleitores para cada zona eleitoral informada.",
    unit: "eleitores por zona",
    source: "TSE",
    sourceLabel: "TSE — Perfil do Eleitorado",
    sourceUrl: TSE_SOURCE_URL,
    referenceYear: 2026,
    sourceIndicatorId: "eleitores_por_zona_2026",
    valueFormat: "integer",
  },
  {
    id: "populationEstimate",
    label: "População estimada",
    shortLabel: "População estimada",
    description: "Estimativa oficial da população residente no município.",
    unit: "pessoas",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2025,
    sourceIndicatorId: "29171",
    valueFormat: "integer",
  },
  {
    id: "censusPopulation",
    label: "População no último Censo",
    shortLabel: "População do Censo",
    description: "População residente recenseada pelo Censo Demográfico 2022.",
    unit: "pessoas",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "96385",
    valueFormat: "integer",
  },
  {
    id: "population16Plus",
    label: "População apta a votar (16+)",
    shortLabel: "Pop. 16+",
    description:
      "População residente com 16 anos ou mais no Censo Demográfico 2022.",
    unit: "pessoas",
    source: "IBGE",
    sourceLabel: "IBGE — Censo 2022",
    sourceUrl: CENSUS_AGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "censo-9514",
    valueFormat: "integer",
  },
  {
    id: "electoralPenetration",
    label: "Penetração eleitoral",
    shortLabel: "Penetração",
    description:
      "Eleitorado de 2026 em relação à população com 16 anos ou mais do Censo 2022; acima de 100% indica eleitores com título no município morando fora dele.",
    unit: "% da população 16+",
    source: "IBGE",
    sourceLabel: "IBGE — Censo 2022",
    sourceUrl: CENSUS_AGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "censo-9514",
    valueFormat: "percent",
  },
  {
    id: "share16to24",
    label: "Eleitorado jovem potencial",
    shortLabel: "Jovens 16–24",
    description:
      "Participação das faixas de 16 a 17 e 18 a 24 anos na população com 16 anos ou mais do Censo 2022.",
    unit: "% da população 16+",
    source: "IBGE",
    sourceLabel: "IBGE — Censo 2022",
    sourceUrl: CENSUS_AGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "censo-9514",
    valueFormat: "percent",
  },
  {
    id: "share60Plus",
    label: "População 60+",
    shortLabel: "60+",
    description:
      "Participação da faixa de 60 anos ou mais na população com 16 anos ou mais do Censo 2022.",
    unit: "% da população 16+",
    source: "IBGE",
    sourceLabel: "IBGE — Censo 2022",
    sourceUrl: CENSUS_AGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "censo-9514",
    valueFormat: "percent",
  },
  {
    id: "literacyRate15Plus",
    label: "Alfabetização 15+ (%)",
    shortLabel: "Alfabetização 15+",
    description:
      "Pessoas alfabetizadas entre as de 15 anos ou mais no Censo Demográfico 2022.",
    unit: "% da população 15+",
    source: "IBGE",
    sourceLabel: "IBGE — Censo 2022",
    sourceUrl: CENSUS_LITERACY_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "censo-9542",
    valueFormat: "percent",
  },
  {
    id: "populationDensity",
    label: "Densidade demográfica",
    shortLabel: "Densidade",
    description: "Habitantes por quilômetro quadrado no Censo 2022.",
    unit: "hab./km²",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "96386",
    valueFormat: "decimal",
  },
  {
    id: "gdpPerCapita",
    label: "PIB per capita",
    shortLabel: "PIB per capita",
    description: "Produto Interno Bruto municipal por habitante.",
    unit: "R$ por pessoa",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2023,
    sourceIndicatorId: "47001",
    valueFormat: "currency",
  },
  {
    id: "schoolAttendance",
    label: "Escolarização de 6 a 14 anos",
    shortLabel: "Escolarização",
    description: "Percentual das crianças de 6 a 14 anos que frequentam a escola.",
    unit: "% da faixa etária",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "60045",
    valueFormat: "percent",
  },
  {
    id: "occupiedPopulation",
    label: "População ocupada",
    shortLabel: "População ocupada",
    description: "Pessoas ocupadas em relação à população do município.",
    unit: "% da população",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "60036",
    valueFormat: "percent",
  },
  {
    id: "formalAverageSalary",
    label: "Salário médio dos trabalhadores formais",
    shortLabel: "Salário formal",
    description: "Rendimento médio mensal dos trabalhadores formais.",
    unit: "salários mínimos",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2024,
    sourceIndicatorId: "143558",
    valueFormat: "decimal",
  },
  {
    id: "adequateSanitation",
    label: "Esgotamento sanitário adequado",
    shortLabel: "Saneamento adequado",
    description: "Domicílios com esgotamento sanitário considerado adequado.",
    unit: "% dos domicílios",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2022,
    sourceIndicatorId: "60030",
    valueFormat: "percent",
  },
  {
    id: "lowIncomePopulation",
    label: "População com renda per capita de até 1/2 salário mínimo",
    shortLabel: "Renda baixa",
    description:
      "Indicador histórico de população com renda nominal mensal per capita de até meio salário mínimo.",
    unit: "% da população",
    source: "IBGE",
    sourceLabel: "IBGE — Cidades e Estados",
    sourceUrl: IBGE_SOURCE_URL,
    referenceYear: 2010,
    sourceIndicatorId: "60037",
    valueFormat: "percent",
  },
];

export const ELECTORAL_ANALYSIS_METRICS = ANALYSIS_METRICS.filter(
  (metric) => metric.source === "TSE",
);
export const SOCIOECONOMIC_ANALYSIS_METRICS = ANALYSIS_METRICS.filter(
  (metric) => metric.source === "IBGE",
);

const metricIds = new Set(ANALYSIS_METRICS.map((metric) => metric.id));

export function getDefaultAnalysisState(): AnalysisState {
  return {
    metricId: "electorate",
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
}

export function sanitizeAnalysisState(value: unknown): AnalysisState {
  const fallback = getDefaultAnalysisState();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Record<string, unknown>;
  const metricId =
    typeof candidate.metricId === "string" &&
    metricIds.has(candidate.metricId as AnalysisMetricId)
      ? (candidate.metricId as AnalysisMetricId)
      : fallback.metricId;
  const sortDirection =
    candidate.sortDirection === "asc" || candidate.sortDirection === "desc"
      ? candidate.sortDirection
      : fallback.sortDirection;
  const activeBands = Array.isArray(candidate.activeBands)
    ? Array.from(
        new Set(
          candidate.activeBands.filter(
            (band): band is AnalysisBand =>
              Number.isInteger(band) &&
              typeof band === "number" &&
              band >= 0 &&
              band <= 4,
          ),
        ),
      ).sort((a, b) => a - b)
    : [];

  return {
    metricId,
    sortDirection,
    activeBands:
      activeBands.length > 0 ? activeBands : [...ALL_ANALYSIS_BANDS],
  };
}

export function toggleAnalysisBand(
  activeBands: AnalysisBand[],
  band: AnalysisBand,
) {
  if (activeBands.includes(band)) {
    if (activeBands.length === 1) return activeBands;
    return activeBands.filter((candidate) => candidate !== band);
  }
  return [...activeBands, band].sort((a, b) => a - b);
}

export function getAnalysisMetric(metricId: AnalysisMetricId) {
  return (
    ANALYSIS_METRICS.find((metric) => metric.id === metricId) ??
    ANALYSIS_METRICS[0]
  );
}

export function getAnalysisMetricValue(
  municipality: MunicipalityProfile,
  metricId: AnalysisMetricId,
): number | null {
  switch (metricId) {
    case "biometrics":
      return municipality.biometricsPct;
    case "disability":
      return percentage(
        municipality.registeredDisability,
        municipality.electorate,
      );
    case "female":
      return percentage(municipality.gender.female, municipality.electorate);
    case "socialName":
      return (municipality.socialName / municipality.electorate) * 10_000;
    case "electorsPerZone":
      return municipality.electorate / Math.max(1, municipality.zoneCount);
    case "population16Plus":
      return municipality.age?.population16Plus ?? null;
    case "electoralPenetration": {
      const population16Plus = municipality.age?.population16Plus ?? null;
      if (population16Plus === null || population16Plus === 0) return null;
      return (municipality.electorate / population16Plus) * 100;
    }
    case "share16to24": {
      const age = municipality.age;
      if (!age || age.population16Plus === 0) return null;
      return (
        ((age.bands.a16to17 + age.bands.a18to24) / age.population16Plus) * 100
      );
    }
    case "share60Plus": {
      const age = municipality.age;
      if (!age || age.population16Plus === 0) return null;
      return (age.bands.a60plus / age.population16Plus) * 100;
    }
    case "literacyRate15Plus": {
      const literacy = municipality.literacy;
      // Dado pendente ou município sem cobertura fica null, nunca zero.
      if (!literacy || literacy.population15Plus === 0) return null;
      return (literacy.literate15Plus / literacy.population15Plus) * 100;
    }
    case "populationEstimate":
    case "censusPopulation":
    case "populationDensity":
    case "gdpPerCapita":
    case "schoolAttendance":
    case "occupiedPopulation":
    case "formalAverageSalary":
    case "adequateSanitation":
    case "lowIncomePopulation":
      return municipality.socioeconomic[metricId];
    case "electorate":
    default:
      return municipality.electorate;
  }
}

export function formatAnalysisMetricValue(
  metricId: AnalysisMetricId,
  value: number | null,
) {
  if (value === null || !Number.isFinite(value)) return "Sem dado";

  switch (metricId) {
    case "biometrics":
    case "disability":
    case "female":
    case "schoolAttendance":
    case "occupiedPopulation":
    case "adequateSanitation":
    case "lowIncomePopulation":
    case "electoralPenetration":
    case "share16to24":
    case "share60Plus":
    case "literacyRate15Plus":
      return formatPercent(value);
    case "socialName":
      return `${formatDecimal(value)} / 10 mil`;
    case "populationDensity":
      return `${formatDecimal(value)} hab./km²`;
    case "gdpPerCapita":
      return formatCurrency(value);
    case "formalAverageSalary":
      return `${formatDecimal(value)} salários mínimos`;
    case "electorsPerZone":
    case "electorate":
    case "populationEstimate":
    case "censusPopulation":
    case "population16Plus":
    default:
      return formatInteger(Math.round(value));
  }
}

export function calculateQuantileThresholds(values: number[]) {
  const sorted = values
    .filter(Number.isFinite)
    .slice()
    .sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0];

  return [1, 2, 3, 4].map((quintile) => {
    const index = Math.max(
      0,
      Math.min(sorted.length - 1, Math.ceil((sorted.length * quintile) / 5) - 1),
    );
    return sorted[index];
  });
}

export function getAnalysisBand(value: number, thresholds: number[]) {
  const band = thresholds.findIndex((threshold) => value <= threshold);
  return (band === -1 ? 4 : band) as AnalysisBand;
}

export function getAnalysisRangeLabel(
  metricId: AnalysisMetricId,
  thresholds: number[],
  band: AnalysisBand,
) {
  if (band === 0) {
    return `Até ${formatAnalysisMetricValue(metricId, thresholds[0] ?? 0)}`;
  }
  if (band === 4) {
    return `Acima de ${formatAnalysisMetricValue(metricId, thresholds[3] ?? 0)}`;
  }
  return `> ${formatAnalysisMetricValue(metricId, thresholds[band - 1] ?? 0)} até ${formatAnalysisMetricValue(metricId, thresholds[band] ?? 0)}`;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function buildAnalysisModel(
  municipalities: MunicipalityProfile[],
  state: AnalysisState,
  stateElectorate: number,
): AnalysisModel {
  const metric = getAnalysisMetric(state.metricId);
  const candidates = municipalities
    .map((municipality) => ({
      municipality,
      value: getAnalysisMetricValue(municipality, state.metricId),
    }))
    .filter(
      (item): item is { municipality: MunicipalityProfile; value: number } =>
        item.value !== null && Number.isFinite(item.value),
    );
  const values = candidates.map((item) => item.value);
  const thresholds = calculateQuantileThresholds(values);
  const rankedMunicipalities = candidates.slice().sort(
    (a, b) =>
      b.value - a.value ||
      a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
  );
  const rankById = new Map(
    rankedMunicipalities.map((item, index) => [
      item.municipality.ibgeCode,
      index + 1,
    ]),
  );
  const allItems = candidates.map(({ municipality, value }) => ({
    municipality,
    value,
    band: getAnalysisBand(value, thresholds),
    rank: rankById.get(municipality.ibgeCode) ?? candidates.length,
  }));
  const activeBandSet = new Set(state.activeBands);
  const filteredItems = allItems
    .filter((item) => activeBandSet.has(item.band))
    .sort((a, b) => {
      const valueOrder =
        state.sortDirection === "desc"
          ? b.value - a.value
          : a.value - b.value;
      return (
        valueOrder ||
        a.municipality.name.localeCompare(b.municipality.name, "pt-BR")
      );
    });
  const filteredValues = filteredItems.map((item) => item.value);
  const focusedElectorate = filteredItems.reduce(
    (total, item) => total + item.municipality.electorate,
    0,
  );
  const bandCounts = ALL_ANALYSIS_BANDS.map(
    (band) => allItems.filter((item) => item.band === band).length,
  );

  return {
    metric,
    thresholds,
    bandCounts,
    allItems,
    filteredItems,
    missingMunicipalityCount: municipalities.length - allItems.length,
    median: median(values),
    focusedMinimum:
      filteredValues.length > 0 ? Math.min(...filteredValues) : 0,
    focusedMaximum:
      filteredValues.length > 0 ? Math.max(...filteredValues) : 0,
    focusedElectorate,
    focusedElectoratePct: percentage(focusedElectorate, stateElectorate),
  };
}

function nullableCsv(value: number | null) {
  return value === null ? "" : formatCsvDecimal(value);
}

export function createAnalysisCsv(model: AnalysisModel) {
  const headers = [
    "ano_referencia_indicador",
    "fonte_indicador",
    "codigo_indicador_fonte",
    "codigo_ibge",
    "codigo_tse",
    "municipio",
    "indicador",
    "valor_indicador",
    "unidade",
    "faixa_quintil",
    "posicao_indicador_rs",
    "eleitorado_total_2026",
    "populacao_estimada_2025",
    "populacao_censo_2022",
    "densidade_demografica_2022",
    "pib_per_capita_2023",
    "escolarizacao_6_a_14_2022_percentual",
    "populacao_ocupada_2022_percentual",
    "salario_formal_medio_2024_salarios_minimos",
    "saneamento_adequado_2022_percentual",
    "renda_baixa_2010_percentual",
    "populacao_16_mais_2022",
    "penetracao_eleitoral_percentual",
    "populacao_16_a_24_2022_percentual",
    "populacao_60_mais_2022_percentual",
    "alfabetizacao_15_mais_2022_percentual",
  ];
  const rows = model.filteredItems.map(({ municipality, value, band, rank }) => [
    model.metric.referenceYear,
    model.metric.source,
    model.metric.sourceIndicatorId,
    municipality.ibgeCode,
    municipality.tseCode,
    municipality.name,
    model.metric.label,
    formatCsvDecimal(value),
    model.metric.unit,
    band + 1,
    rank,
    municipality.electorate,
    nullableCsv(municipality.socioeconomic.populationEstimate),
    nullableCsv(municipality.socioeconomic.censusPopulation),
    nullableCsv(municipality.socioeconomic.populationDensity),
    nullableCsv(municipality.socioeconomic.gdpPerCapita),
    nullableCsv(municipality.socioeconomic.schoolAttendance),
    nullableCsv(municipality.socioeconomic.occupiedPopulation),
    nullableCsv(municipality.socioeconomic.formalAverageSalary),
    nullableCsv(municipality.socioeconomic.adequateSanitation),
    nullableCsv(municipality.socioeconomic.lowIncomePopulation),
    nullableCsv(getAnalysisMetricValue(municipality, "population16Plus")),
    nullableCsv(getAnalysisMetricValue(municipality, "electoralPenetration")),
    nullableCsv(getAnalysisMetricValue(municipality, "share16to24")),
    nullableCsv(getAnalysisMetricValue(municipality, "share60Plus")),
    nullableCsv(getAnalysisMetricValue(municipality, "literacyRate15Plus")),
  ]);

  return createCsv(headers, rows);
}

export function getAnalysisCsvFilename(metricId: AnalysisMetricId) {
  const metric = getAnalysisMetric(metricId);
  return `acqr-analise-${metricId}-${metric.referenceYear}.csv`;
}
