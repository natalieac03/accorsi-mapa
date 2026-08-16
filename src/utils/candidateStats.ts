import type {
  CandidateContest,
  CandidateDataset,
  CareerBest,
  CareerOverview,
  ContestGroups,
  GrowthComparison,
  ScatterModel,
  ScatterPoint,
  StatsIndicator,
  StatsIndicatorId,
  StatsIndicatorSource,
} from "../types/candidate";
import type { MunicipalityProfile } from "../types/electorate";
import { getAnalysisMetric, getAnalysisMetricValue } from "./analysis.ts";
import { createCsv, formatCsvDecimal, type CsvCell } from "./csv.ts";

/**
 * Motor da janela "Estatísticas" — agregados de carreira e o cruzamento
 * voto × indicador municipal. Puro e sem React, como o resto dos utils, para
 * os testes cobrirem a aritmética com payloads sintéticos.
 *
 * Duas disciplinas específicas desta janela, além das herdadas do projeto
 * (null nunca vira zero; percentual só com denominador):
 *
 * - votos de eleições DIFERENTES nunca se somam num total único: cada pleito
 *   é um universo próprio de eleitores e regras. O que atravessa pleitos é
 *   contagem (municípios alcançados) ou comparação entre pares comparáveis;
 * - correlação municipal é leitura AGREGADA: o coeficiente sai daqui, mas a
 *   interface é obrigada a exibir o aviso da falácia ecológica junto.
 */

/** Prefeita (11) e Vereadora (13): os cargos de pleito municipal do TSE. */
const MUNICIPAL_OFFICE_CODES = new Set([11, 13]);

export function isMunicipalContest(contest: Pick<CandidateContest, "officeCode">): boolean {
  return MUNICIPAL_OFFICE_CODES.has(contest.officeCode);
}

/**
 * Divide a trajetória nos dois universos da navegação lateral. Os grupos são
 * DERIVADOS do dado (nunca uma lista fixa de anos): uma candidatura nova no
 * JSON aparece no grupo certo sem tocar em código. Ordem: mais recente
 * primeiro; dentro do mesmo ano, 1º turno antes do 2º.
 */
export function groupContests(dataset: CandidateDataset): ContestGroups {
  const ordered = [...dataset.contests].sort(
    (a, b) =>
      b.electionYear - a.electionYear ||
      a.round - b.round ||
      a.officeCode - b.officeCode,
  );
  return {
    municipais: ordered.filter((contest) => isMunicipalContest(contest)),
    federaisEstaduais: ordered.filter((contest) => !isMunicipalContest(contest)),
  };
}

/** Maior votação nominal num único pleito — o pico da carreira. */
export function buildCareerBest(dataset: CandidateDataset): CareerBest | null {
  let best: CandidateContest | null = null;
  for (const contest of dataset.contests) {
    if (best === null || contest.votosNoEstado > best.votosNoEstado) {
      best = contest;
    }
  }
  if (!best) return null;
  return {
    contestId: best.id,
    electionYear: best.electionYear,
    officeName: best.officeName,
    round: best.round,
    votos: best.votosNoEstado,
  };
}

/**
 * Crescimento entre os dois pleitos municipais mais recentes que sejam
 * COMPARÁVEIS: mesmo cargo e mesmo turno, em anos diferentes. Prefeita 2024
 * não se compara com vereadora 2016 — se não existe par comparável, não
 * existe taxa (null), em vez de um número que não significa nada.
 * Variação arredondada (declarado) a 1 casa.
 */
export function buildMunicipalGrowth(
  dataset: CandidateDataset,
): GrowthComparison | null {
  const municipais = groupContests(dataset).municipais; // já em ordem: recente -> antigo
  for (const recente of municipais) {
    const anterior = municipais.find(
      (contest) =>
        contest.officeCode === recente.officeCode &&
        contest.round === recente.round &&
        contest.electionYear < recente.electionYear,
    );
    if (!anterior || anterior.votosNoEstado <= 0) continue;
    return {
      anteriorId: anterior.id,
      recenteId: recente.id,
      officeCode: recente.officeCode,
      officeName: recente.officeName,
      round: recente.round,
      anoAnterior: anterior.electionYear,
      anoRecente: recente.electionYear,
      votosAnterior: anterior.votosNoEstado,
      votosRecente: recente.votosNoEstado,
      variacaoPct:
        Math.round(
          ((recente.votosNoEstado - anterior.votosNoEstado) /
            anterior.votosNoEstado) *
            1000,
        ) / 10,
    };
  }
  return null;
}

/**
 * Cartões da visão geral. "Municípios alcançados" é a UNIÃO dos municípios
 * com voto em qualquer pleito — uma contagem de território, nunca soma de
 * votos entre eleições. "Campanhas" conta ano+cargo distintos: o 2º turno é
 * a mesma campanha do 1º.
 */
export function buildCareerOverview(dataset: CandidateDataset): CareerOverview {
  const alcancados = new Set<string>();
  const campanhas = new Set<string>();
  for (const contest of dataset.contests) {
    campanhas.add(`${contest.electionYear}-${contest.officeCode}`);
    for (const ibge of Object.keys(contest.municipios)) alcancados.add(ibge);
  }
  return {
    best: buildCareerBest(dataset),
    growth: buildMunicipalGrowth(dataset),
    municipiosAlcancados: alcancados.size,
    campanhas: campanhas.size,
  };
}

/**
 * % dos votos válidos do cargo que foram dela, no agregado do estado — só
 * faz sentido para cargo de disputa estadual (deputada, senadora…), onde os
 * válidos de todos os municípios pertencem à MESMA disputa. Em pleito
 * municipal cada cidade é uma eleição diferente e somar válidos seria
 * misturar universos: null. O denominador soma os válidos apurados dos
 * municípios onde ela teve voto — municípios sem voto dela ficam fora do
 * arquivo, então o valor é declarado na interface como "dos municípios com
 * voto". Arredondado (declarado) a 2 casas.
 */
export function pctValidosNoEstado(contest: CandidateContest): number | null {
  if (isMunicipalContest(contest)) return null;
  let validos = 0;
  for (const municipio of Object.values(contest.municipios)) {
    validos += municipio.validos;
  }
  if (validos <= 0) return null;
  return Math.round((contest.votosNoEstado / validos) * 100 * 100) / 100;
}

/* -------------------------------------------------------------------------
 * Correlação (Pearson)
 * ------------------------------------------------------------------------- */

/**
 * Abaixo de 10 municípios plotados o coeficiente vira ruído de amostra
 * pequena — a interface mostra "amostra insuficiente" em vez de um número.
 */
export const PEARSON_MIN_N = 10;

/**
 * Coeficiente de correlação de Pearson. null com menos de 2 pontos ou com
 * variância zero em qualquer eixo (reta vertical/horizontal não tem
 * correlação definida — o denominador é zero). Sem arredondar: quem exibe
 * decide a precisão.
 */
export function pearson(points: ReadonlyArray<{ x: number; y: number }>): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let covXY = 0;
  let varX = 0;
  let varY = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return covXY / Math.sqrt(varX * varY);
}

/* -------------------------------------------------------------------------
 * Indicadores municipais do cruzamento
 * ------------------------------------------------------------------------- */

/**
 * Subconjunto dos indicadores da aba Análise que respondem à pergunta da
 * janela ("ela foi melhor em cidades com mais mulheres? mais alfabetizadas?
 * mais velhas?"). Rótulos e descrições vêm de ANALYSIS_METRICS — mesma
 * fonte, mesma redação em toda a aplicação.
 */
const STATS_INDICATOR_IDS: StatsIndicatorId[] = [
  "female",
  "literacyRate15Plus",
  "share60Plus",
  "electoralPenetration",
  "electorate",
];

export const STATS_INDICATORS: StatsIndicator[] = STATS_INDICATOR_IDS.map(
  (id) => {
    const metric = getAnalysisMetric(id);
    return {
      id,
      label: metric.label,
      shortLabel: metric.shortLabel,
      description: metric.description,
      unit: metric.unit,
      logScale: id === "electorate",
    };
  },
);

export function getStatsIndicator(id: StatsIndicatorId): StatsIndicator {
  return (
    STATS_INDICATORS.find((indicator) => indicator.id === id) ??
    STATS_INDICATORS[0]
  );
}

/**
 * Valores socioeconômicos inertes para completar o shape MunicipalityProfile:
 * nenhum indicador desta janela lê esses campos, e null é "sem dado" em toda
 * a aplicação — se um dia alguém adicionar aqui um indicador que os use, o
 * resultado é o comportamento correto (município fora do scatter), não um
 * número inventado.
 */
const SOCIOECONOMIC_INERTE: MunicipalityProfile["socioeconomic"] = {
  populationEstimate: null,
  censusPopulation: null,
  populationDensity: null,
  gdpPerCapita: null,
  schoolAttendance: null,
  occupiedPopulation: null,
  formalAverageSalary: null,
  adequateSanitation: null,
  lowIncomePopulation: null,
};

/**
 * Monta o índice ibge -> perfil que alimenta getAnalysisMetricValue — o
 * cálculo de cada indicador é REUSADO da aba Análise, não reimplementado.
 * Devolve null enquanto o snapshot do eleitorado for placeholder ("pendente"
 * ou vazio): sem eleitorado não há nenhum indicador confiável. Censo pendente
 * não anula o índice — só deixa null os indicadores que dependem dele.
 * Município com eleitorado zerado fica fora (não pode ser denominador).
 */
export function buildStatsProfiles(
  source: StatsIndicatorSource,
): Record<string, MunicipalityProfile> | null {
  const entries = Object.entries(source.electorate.municipalities);
  if (source.electorate.metadata.status === "pendente" || entries.length === 0) {
    return null;
  }
  const profiles: Record<string, MunicipalityProfile> = {};
  for (const [ibge, municipio] of entries) {
    if (municipio.electorate <= 0) continue;
    profiles[ibge] = {
      ibgeCode: ibge,
      tseCode: "",
      name: municipio.name,
      electorate: municipio.electorate,
      stateSharePct: 0,
      stateRank: 0,
      zoneCount: 0,
      biometrics: 0,
      biometricsPct: 0,
      registeredDisability: 0,
      socialName: 0,
      topAgeGroup: { label: "", electorate: 0, percentage: 0 },
      gender: municipio.gender,
      socioeconomic: SOCIOECONOMIC_INERTE,
      age: source.age.municipalities[ibge] ?? null,
      literacy: source.literacy.municipalities[ibge] ?? null,
    };
  }
  return Object.keys(profiles).length > 0 ? profiles : null;
}

/**
 * Valor do indicador para um município, já na escala do eixo X. Para escala
 * log só existe valor com indicador > 0 (log de zero não existe — o município
 * sai do scatter e entra na contagem de "sem dado").
 */
function indicatorAxisValue(
  profile: MunicipalityProfile | undefined,
  indicator: StatsIndicator,
): { raw: number; axis: number } | null {
  if (!profile) return null;
  const raw = getAnalysisMetricValue(profile, indicator.id);
  if (raw === null || !Number.isFinite(raw)) return null;
  if (!indicator.logScale) return { raw, axis: raw };
  if (raw <= 0) return null;
  return { raw, axis: Math.log10(raw) };
}

/**
 * Monta o scatter % dos válidos (Y) × indicador (X) de um pleito.
 *
 * Exclusões são contadas, nunca silenciosas:
 * - município sem % dos válidos (denominador não apurado) -> semPercentual;
 * - município sem valor do indicador (ou índice inteiro pendente) -> semIndicador.
 *
 * O Pearson sai dos MESMOS pares plotados (log10 incluso, quando a escala é
 * log) e só existe com n >= PEARSON_MIN_N.
 */
export function buildScatter(
  contest: CandidateContest,
  indicatorId: StatsIndicatorId,
  profiles: Record<string, MunicipalityProfile> | null,
): ScatterModel {
  const indicator = getStatsIndicator(indicatorId);
  const points: ScatterPoint[] = [];
  let semIndicador = 0;
  let semPercentual = 0;
  for (const [ibge, municipio] of Object.entries(contest.municipios)) {
    if (municipio.percentualValidos === null) {
      semPercentual += 1;
      continue;
    }
    const value = indicatorAxisValue(profiles?.[ibge], indicator);
    if (value === null) {
      semIndicador += 1;
      continue;
    }
    points.push({
      ibgeCode: ibge,
      nome: municipio.nome,
      x: value.axis,
      indicadorValor: value.raw,
      y: municipio.percentualValidos,
      votos: municipio.votos,
    });
  }
  // Ordem estável (por nome) para render e CSV determinísticos.
  points.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const amostraInsuficiente = points.length < PEARSON_MIN_N;
  return {
    indicator,
    points,
    semIndicador,
    semPercentual,
    pearson: amostraInsuficiente ? null : pearson(points),
    amostraInsuficiente,
  };
}

/* -------------------------------------------------------------------------
 * CSV — mesmo dialeto do projeto (createCsv põe BOM e ponto e vírgula)
 * ------------------------------------------------------------------------- */

/** CSV da visão geral: uma linha por pleito, sem linha de total (de propósito). */
export function createTrajectoryCsv(dataset: CandidateDataset): string {
  const ordered = [...dataset.contests].sort(
    (a, b) => a.electionYear - b.electionYear || a.round - b.round,
  );
  const headers = [
    "Ano",
    "Cargo",
    "Turno",
    "Partido",
    "Resultado",
    "Votos no estado",
    "Municípios com voto",
  ];
  const rows: CsvCell[][] = ordered.map((contest) => [
    contest.electionYear,
    contest.officeName,
    contest.round,
    contest.candidatura.partido,
    contest.candidatura.resultado,
    contest.votosNoEstado,
    contest.municipiosComVoto,
  ]);
  return createCsv(headers, rows);
}

export function createScatterCsv(model: ScatterModel): string {
  const headers = [
    "Município",
    "Votos",
    "% dos válidos",
    model.indicator.label,
  ];
  const rows: CsvCell[][] = model.points.map((point) => [
    point.nome,
    point.votos,
    formatCsvDecimal(point.y),
    formatCsvDecimal(point.indicadorValor),
  ]);
  return createCsv(headers, rows);
}

export function getScatterCsvFilename(
  contest: CandidateContest,
  indicatorId: StatsIndicatorId,
): string {
  return `estatisticas-${contest.id}-${indicatorId.toLowerCase()}.csv`;
}

export function getTrajectoryCsvFilename(dataset: CandidateDataset): string {
  return `estatisticas-trajetoria-${dataset.metadata.slug}.csv`;
}
