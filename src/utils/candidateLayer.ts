import type { AnalysisBand } from "../types/analysis";
import type {
  CandidateDataset,
  CandidateLayerItem,
  CandidateLayerModel,
  CandidateLayerMunicipio,
  CandidateLayerState,
  CandidateRankingMetricId,
  ElectorateIndex,
} from "../types/candidate";
import {
  ALL_ANALYSIS_BANDS,
  calculateQuantileThresholds,
  getAnalysisBand,
  toggleAnalysisBand,
} from "./analysis.ts";
import {
  CANDIDATE_RANKING_METRICS,
  formatRankingValue,
  getCandidateRankingMetric,
  getContestLabel,
  getOfficeLabel,
  getRankingMetricValue,
  isCandidatePendente,
  votosPorMilEleitores,
} from "./candidate.ts";
import { getMunicipalScope, isMunicipalContest } from "./candidateStats.ts";
import { formatInteger } from "./electorate.ts";
import { POLLING_CANDIDATE_COLORS } from "./pollingPlaces.ts";

/**
 * Motor da camada "candidato" do mapa: o coroplético do desempenho DELA,
 * município a município, no pleito e na métrica escolhidos na aba "Accorsi".
 *
 * As duas regras que este arquivo existe para não deixar escapar:
 *
 * 1. pleito MUNICIPAL (prefeita/vereadora, cargos 11/13) aconteceu em UMA
 *    cidade. Município fora dela não é zero voto: ela não estava na urna.
 *    Fica fora da escala, fora do ranking e com a cor de dado ausente, e a
 *    interface é obrigada a dizer por quê;
 * 2. pleito ESTADUAL/FEDERAL tinha o nome dela na urna do estado inteiro:
 *    município ausente do pleito apurou ZERO voto dela, e zero é dado. O que
 *    pode faltar ali é o DENOMINADOR da métrica (eleitorado, válidos, voto do
 *    partido); sem denominador a taxa é null, cinza e fora da escala.
 */

/**
 * Rampa da camada: a MESMA de "votos dela por local de votação"
 * (POLLING_CANDIDATE_COLORS), porque as duas leituras medem o voto nominal
 * dela em recortes diferentes. A validação de contraste e o ΔE contra o cinza
 * de dado ausente estão documentados na constante original, em
 * utils/pollingPlaces.ts.
 */
export const CANDIDATE_LAYER_COLORS = POLLING_CANDIDATE_COLORS;

/**
 * O denominador de cada métrica, escrito por extenso. "Votos por 1.000
 * eleitores" divide pelo ELEITORADO APTO do TSE, não pela população: por
 * habitante entraria no denominador quem não vota. São réguas diferentes, e a
 * camada diz qual está usando.
 */
const DENOMINADOR_NOTAS: Record<CandidateRankingMetricId, string | null> = {
  votos: null,
  percentualValidos:
    "Denominador: votos nominais válidos do cargo apurados no município.",
  percentualPartido:
    "Denominador: votos do partido dela apurados no município.",
  votosPorMilEleitores:
    "Denominador: eleitorado apto do município (TSE) — não a população.",
};

export function getCandidateLayerDenominadorNota(
  metricId: CandidateRankingMetricId,
): string | null {
  return DENOMINADOR_NOTAS[metricId] ?? null;
}

const METRIC_IDS = new Set(CANDIDATE_RANKING_METRICS.map((metric) => metric.id));

/**
 * Estado inicial da camada e do painel. A leitura de entrada é "votos por
 * 1.000 eleitores", única métrica que compara cidades de tamanhos muito
 * diferentes sem que Goiânia coma o mapa. Sem o snapshot do eleitorado essa
 * métrica não existe e o padrão cai em votos absolutos.
 */
export function getDefaultCandidateLayerState(
  dataset: CandidateDataset,
  electorateIndex: ElectorateIndex,
): CandidateLayerState {
  return {
    contestId: dataset.contests[0]?.id ?? "",
    metricId: electorateIndex === null ? "votos" : "votosPorMilEleitores",
    activeBands: [...ALL_ANALYSIS_BANDS],
  };
}

/**
 * Estado vindo do armazenamento local: só sobrevive o que ainda existe nos
 * dados de hoje. Pleito que sumiu do JSON (ou métrica sem denominador nesta
 * instalação) volta ao padrão.
 */
export function sanitizeCandidateLayerState(
  value: unknown,
  dataset: CandidateDataset,
  electorateIndex: ElectorateIndex,
): CandidateLayerState {
  const fallback = getDefaultCandidateLayerState(dataset, electorateIndex);
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Record<string, unknown>;
  const contestId =
    typeof candidate.contestId === "string" &&
    dataset.contests.some((contest) => contest.id === candidate.contestId)
      ? candidate.contestId
      : fallback.contestId;
  const metricIdBruto =
    typeof candidate.metricId === "string" &&
    METRIC_IDS.has(candidate.metricId as CandidateRankingMetricId)
      ? (candidate.metricId as CandidateRankingMetricId)
      : fallback.metricId;
  const metricId =
    electorateIndex === null &&
    getCandidateRankingMetric(metricIdBruto).requiresElectorate
      ? fallback.metricId
      : metricIdBruto;
  const activeBands = Array.isArray(candidate.activeBands)
    ? Array.from(
        new Set(
          candidate.activeBands.filter(
            (band): band is AnalysisBand =>
              typeof band === "number" &&
              Number.isInteger(band) &&
              band >= 0 &&
              band <= 4,
          ),
        ),
      ).sort((a, b) => a - b)
    : [];

  return {
    contestId,
    metricId,
    activeBands:
      activeBands.length > 0 ? activeBands : [...ALL_ANALYSIS_BANDS],
  };
}

export function toggleCandidateLayerBand(
  activeBands: AnalysisBand[],
  band: AnalysisBand,
) {
  return toggleAnalysisBand(activeBands, band);
}

export type CandidateLayerInput = {
  dataset: CandidateDataset;
  /** Municípios da malha: o universo que o mapa pinta. */
  municipios: CandidateLayerMunicipio[];
  electorateIndex: ElectorateIndex;
  state: CandidateLayerState;
};

/**
 * Modelo da camada; null quando ela NÃO pode ser oferecida (trajetória
 * pendente ou sem nenhum pleito). Mesmo contrato do histórico do TSE
 * (`electionModel`): quem chama cai na camada padrão e explica.
 */
export function buildCandidateLayerModel(
  input: CandidateLayerInput,
): CandidateLayerModel | null {
  const { dataset, municipios, electorateIndex, state } = input;
  if (isCandidatePendente(dataset)) return null;

  const contest =
    dataset.contests.find((item) => item.id === state.contestId) ??
    dataset.contests[0] ??
    null;
  if (!contest) return null;

  const eleitoradoPendente = electorateIndex === null;
  // Métrica de taxa sem snapshot do eleitorado não tem denominador: cair em
  // votos absolutos mostra dado; insistir mostraria 246 municípios cinza.
  const metricId: CandidateRankingMetricId =
    eleitoradoPendente && getCandidateRankingMetric(state.metricId).requiresElectorate
      ? "votos"
      : state.metricId;
  const metric = getCandidateRankingMetric(metricId);
  const escopoMunicipal = getMunicipalScope(contest);
  // Prefeita/vereadora se disputam DENTRO de um município: cidade fora do
  // pleito não teve o nome dela na urna. A régua vem do cargo do TSE, nunca de
  // uma lista de anos ou de candidaturas fixada em código.
  const pleitoMunicipal = isMunicipalContest(contest);

  const items: CandidateLayerItem[] = municipios.map((municipio) => {
    const eleitorado = electorateIndex?.[municipio.ibgeCode] ?? null;
    const registro = contest.municipios[municipio.ibgeCode];

    // Caso 1: pleito municipal. Onde ela não concorreu não existe voto zero,
    // existe ausência de disputa (com mais de uma cidade no arquivo, a regra
    // continua valendo por cidade).
    if (pleitoMunicipal && !registro) {
      return {
        ibgeCode: municipio.ibgeCode,
        nome: municipio.name,
        votos: null,
        value: null,
        band: null,
        eleitorado,
        status: "foraDaDisputa",
        rank: null,
      };
    }

    // Caso 2: pleito estadual/federal sem registro do município. Ela estava na
    // urna do estado inteiro, então o município apurou ZERO voto dela, e zero é
    // dado. O que falta é denominador: votos por 1.000 eleitores existe (0)
    // quando há eleitorado; os percentuais não, porque válidos e voto do
    // partido não foram apurados no arquivo dela.
    const votos = registro ? registro.votos : 0;
    const value = registro
      ? getRankingMetricValue(registro, metricId, eleitorado)
      : metricId === "votos"
        ? 0
        : metricId === "votosPorMilEleitores"
          ? // Zero voto sobre o eleitorado apto é taxa de verdade (0), e
            // continua null onde não há eleitorado apurado.
            votosPorMilEleitores(0, eleitorado)
          : // % dos válidos e % do partido precisam de denominadores que o
            // arquivo dela só traz onde ela teve voto.
            null;

    return {
      ibgeCode: municipio.ibgeCode,
      nome: registro?.nome ?? municipio.name,
      votos,
      value,
      band: null,
      eleitorado,
      status: value === null ? "semDenominador" : "medido",
      rank: null,
    };
  });

  const medidos = items.filter((item) => item.value !== null);
  const valores = medidos.map((item) => item.value as number);
  // Um valor só (o caso do pleito municipal) não tem distribuição: quintil
  // sobre um ponto pintaria a cidade como "a faixa mais baixa".
  const escalaPorQuantil = valores.length >= 2;
  const thresholds = escalaPorQuantil ? calculateQuantileThresholds(valores) : [];

  for (const item of items) {
    if (item.value === null) continue;
    // Sem escala, a cidade recebe o passo do meio da rampa; a ponta escura
    // sugeriria um "topo de escala" que não existe.
    item.band = escalaPorQuantil
      ? getAnalysisBand(item.value, thresholds)
      : (2 as AnalysisBand);
  }

  const ordenados = [...medidos].sort(
    (a, b) =>
      (b.value as number) - (a.value as number) ||
      (b.votos ?? 0) - (a.votos ?? 0) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
  ordenados.forEach((item, index) => {
    item.rank = index + 1;
  });

  const bandCounts = ALL_ANALYSIS_BANDS.map(
    (band) => items.filter((item) => item.band === band).length,
  );

  return {
    contest,
    contestLabel: getContestLabel(contest),
    officeLabel: getOfficeLabel(contest),
    metric,
    metricId,
    eleitoradoPendente,
    escopoMunicipal,
    escalaPorQuantil,
    thresholds,
    bandCounts,
    // Faixa herdada de outro pleito não pode apagar a única cidade pintada.
    activeBands: escalaPorQuantil
      ? [...state.activeBands]
      : [...ALL_ANALYSIS_BANDS],
    allItems: items,
    medidosCount: medidos.length,
    semDenominadorCount: items.filter((item) => item.status === "semDenominador")
      .length,
    foraDaDisputaCount: items.filter((item) => item.status === "foraDaDisputa")
      .length,
    denominadorNota: getCandidateLayerDenominadorNota(metricId),
  };
}

/** Rótulo do intervalo de uma faixa, na unidade da métrica ativa. */
export function getCandidateLayerRangeLabel(
  metricId: CandidateRankingMetricId,
  thresholds: number[],
  band: AnalysisBand,
): string {
  if (band === 0) {
    return `Até ${formatRankingValue(metricId, thresholds[0] ?? 0)}`;
  }
  if (band === 4) {
    return `Acima de ${formatRankingValue(metricId, thresholds[3] ?? 0)}`;
  }
  return `> ${formatRankingValue(metricId, thresholds[band - 1] ?? 0)} até ${formatRankingValue(metricId, thresholds[band] ?? 0)}`;
}

/** Nome curto da camada para o botão "Camada ativa" e para o aria-label. */
export function getCandidateLayerShortLabel(model: CandidateLayerModel): string {
  return `${model.contest.candidatura.nomeUrna} · ${model.metric.shortLabel}`;
}

/**
 * Linha curta do que a camada está pintando, para o cartão "Camada ativa".
 * Na taxa o denominador vai junto na forma mais curta possível: "por 1.000
 * eleitores" sem complemento faz supor habitantes. A nota completa fica na
 * legenda e no painel.
 */
export function describeCandidateLayer(model: CandidateLayerModel): string {
  const base = `${model.contest.electionYear} · ${model.officeLabel}`;
  if (model.metricId === "votosPorMilEleitores") {
    return `${base} · por 1.000 eleitores aptos, não habitantes`;
  }
  return `${base} · ${model.metric.shortLabel.toLowerCase()}`;
}

/**
 * O que o tooltip do município diz. Cada ausência tem a sua frase: "ela não
 * disputou aqui" e "aqui falta denominador" são leituras diferentes do mesmo
 * cinza; um "sem dado" genérico apagaria a informação.
 */
export function describeCandidateLayerItem(
  model: CandidateLayerModel,
  item: CandidateLayerItem | null | undefined,
): string {
  if (!item) return "Sem dado da candidatura neste município";

  if (item.status === "foraDaDisputa") {
    const cidade = model.escopoMunicipal?.nome ?? "outra cidade";
    return `Fora da disputa — ${model.contest.electionYear} foi pleito municipal, disputado em ${cidade}`;
  }

  if (item.status === "semDenominador") {
    const votos = `${formatInteger(item.votos ?? 0)} votos`;
    if (model.metricId === "votosPorMilEleitores") {
      return `${votos} · sem eleitorado apurado, fica fora da escala`;
    }
    if (model.metricId === "percentualPartido") {
      return `${votos} · sem voto do partido apurado, fica fora da escala`;
    }
    return `${votos} · sem denominador apurado, fica fora da escala`;
  }

  const valor = formatRankingValue(model.metricId, item.value as number);
  if (model.metricId === "votos") return `${valor} votos`;
  return `${valor} · ${formatInteger(item.votos ?? 0)} votos`;
}
