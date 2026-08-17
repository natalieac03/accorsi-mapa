import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipioDestaque,
  CareerBest,
  CareerOverview,
  ContestGroups,
  GrowthArrow,
  GrowthComparison,
  GrowthGroupId,
  GrowthModel,
  GrowthOption,
  GrowthPoint,
  GrowthSeries,
  MunicipalScope,
  ScatterModel,
  ScatterPoint,
  StatsIndicator,
  StatsIndicatorId,
  StatsIndicatorSource,
} from "../types/candidate";
import type { MunicipalityProfile } from "../types/electorate";
import { getAnalysisMetric, getAnalysisMetricValue } from "./analysis.ts";
import { getOfficeShort } from "./candidate.ts";
import { createCsv, formatCsvDecimal, type CsvCell } from "./csv.ts";
import { formatInteger, formatPercent } from "./electorate.ts";

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

/**
 * A cidade de um pleito municipal, quando o pleito de fato tem uma só.
 *
 * Prefeita e vereadora se disputam dentro de um município; ler esse pleito na
 * régua do estado gera cartão sem conteúdo ("1 município com voto", "top 5 =
 * 100%") e uma colocação que mistura candidaturas de cidades diferentes. Aqui
 * devolvemos o recorte certo para a interface trocar a régua.
 *
 * Devolve null fora de pleito municipal e também quando o pleito traz mais de
 * um município — nesse caso o dado contraria a premissa e o certo é a
 * interface continuar na leitura estadual em vez de escolher uma cidade em
 * silêncio.
 */
export function getMunicipalScope(
  contest: CandidateContest,
): MunicipalScope | null {
  if (!isMunicipalContest(contest)) return null;
  const entradas = Object.entries(contest.municipios);
  if (entradas.length !== 1) return null;
  const [ibgeCode, municipio] = entradas[0];
  return {
    ibgeCode,
    nome: municipio.nome,
    votos: municipio.votos,
    validos: municipio.validos,
    percentualValidos: municipio.percentualValidos,
    posicaoNoMunicipio: municipio.posicaoNoMunicipio,
    candidaturasComVoto: municipio.candidaturasComVoto,
  };
}

/**
 * O que ela fez num município, na eleição mais recente de CADA universo.
 *
 * Devolve no máximo dois destaques — um municipal (prefeita/vereadora) e um
 * estadual/federal —, do mais recente para o mais antigo. Em quase todo
 * município de Goiás sai um só, porque prefeitura ela só disputou em Goiânia;
 * lá saem os dois.
 *
 * Os dois universos são apurados separados de propósito: 168 mil votos para
 * prefeita de Goiânia e 96 mil para deputada federal são disputas de regras,
 * eleitorados e adversários diferentes. Somá-los daria um número que não
 * existe, e escolher "o maior" esconderia metade da história.
 *
 * Município sem voto apurado dela devolve lista vazia — e a interface tem de
 * dizer isso, nunca desenhar zero.
 */
export function getMunicipioDestaques(
  dataset: CandidateDataset,
  ibgeCode: string,
): CandidateMunicipioDestaque[] {
  const maisRecentePorUniverso = new Map<string, CandidateMunicipioDestaque>();

  // Do mais recente para o mais antigo: o primeiro de cada universo vence.
  const ordenados = [...dataset.contests].sort(
    (a, b) => b.electionYear - a.electionYear || b.round - a.round,
  );

  for (const contest of ordenados) {
    const municipio = contest.municipios[ibgeCode];
    if (!municipio || municipio.votos <= 0) continue;
    const municipal = isMunicipalContest(contest);
    const universo = municipal ? "municipal" : "estadual";
    if (maisRecentePorUniverso.has(universo)) continue;
    maisRecentePorUniverso.set(universo, {
      contestId: contest.id,
      electionYear: contest.electionYear,
      officeCode: contest.officeCode,
      officeName: contest.officeName,
      officeShort: getOfficeShort(contest.officeCode, contest.officeName),
      round: contest.round,
      municipal,
      votos: municipio.votos,
      percentualValidos: municipio.percentualValidos,
      posicaoNoMunicipio: municipio.posicaoNoMunicipio,
      candidaturasComVoto: municipio.candidaturasComVoto,
    });
  }

  return [...maisRecentePorUniverso.values()].sort(
    (a, b) => b.electionYear - a.electionYear || b.round - a.round,
  );
}

/* -------------------------------------------------------------------------
 * Visão "Geral": crescimento ao longo das eleições
 * ------------------------------------------------------------------------- */

/** Variação % de `de` para `para`, 1 casa. null sem base positiva. */
function variacao(de: number | null, para: number | null): number | null {
  if (de === null || para === null || de <= 0) return null;
  return Math.round(((para - de) / de) * 1000) / 10;
}

function pontoDoPleito(contest: CandidateContest, votos: number | null): GrowthPoint {
  return {
    contestId: contest.id,
    electionYear: contest.electionYear,
    officeCode: contest.officeCode,
    officeName: contest.officeName,
    officeShort: getOfficeShort(contest.officeCode, contest.officeName),
    round: contest.round,
    votos,
  };
}

/** Pleitos do grupo em ordem cronológica (o groupContests devolve invertido). */
function pleitosDoGrupo(
  dataset: CandidateDataset,
  grupo: GrowthGroupId,
): CandidateContest[] {
  return [...groupContests(dataset)[grupo]].sort(
    (a, b) =>
      a.electionYear - b.electionYear ||
      a.round - b.round ||
      a.officeCode - b.officeCode,
  );
}

/**
 * Monta as setas de uma série a partir dos seus pontos consecutivos.
 * Dois pleitos só são COMPARÁVEIS quando são do mesmo cargo e do mesmo turno.
 * A variação entre cargos diferentes continua sendo calculada e exibida — é o
 * crescimento que a campanha quer enxergar — mas sai marcada, para ninguém ler
 * "cresceu 146%" achando que é a mesma disputa medida duas vezes.
 */
function construirSetas(points: GrowthPoint[]): GrowthArrow[] {
  const arrows: GrowthArrow[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const de = points[i - 1];
    const para = points[i];
    arrows.push({
      deContestId: de.contestId,
      paraContestId: para.contestId,
      anoDe: de.electionYear,
      anoPara: para.electionYear,
      votosDe: de.votos,
      votosPara: para.votos,
      variacaoPct: variacao(de.votos, para.votos),
      comparavel: de.officeCode === para.officeCode && de.round === para.round,
    });
  }
  return arrows;
}

function construirSerie(
  id: string,
  label: string,
  points: GrowthPoint[],
): GrowthSeries {
  const comVoto = points.filter((ponto) => ponto.votos !== null);
  const primeiro = comVoto[0] ?? null;
  const ultimo = comVoto.length > 1 ? comVoto[comVoto.length - 1] : null;
  return {
    id,
    label,
    points,
    arrows: construirSetas(points),
    variacaoTotalPct: ultimo ? variacao(primeiro?.votos ?? null, ultimo.votos) : null,
    variacaoTotalComparavel:
      !!primeiro &&
      !!ultimo &&
      primeiro.officeCode === ultimo.officeCode &&
      primeiro.round === ultimo.round,
  };
}

/**
 * Recortes disponíveis para comparar dentro do grupo.
 *
 * Ordenados pelo voto no pleito MAIS RECENTE em que o recorte aparece — nunca
 * pela soma entre eleições. Somar votos de 2016 com os de 2024 para ordenar uma
 * lista pareceria inofensivo e é exatamente o tipo de total que não existe:
 * são eleitorados e disputas diferentes.
 */
function construirOpcoes(
  pleitos: CandidateContest[],
  grupo: GrowthGroupId,
  focoIbge: string | null,
): GrowthOption[] {
  const porId = new Map<string, GrowthOption>();
  // Do mais recente para o mais antigo: o primeiro que define o rótulo e o
  // valor de ordenação é justamente o pleito mais recente do recorte.
  for (const contest of [...pleitos].reverse()) {
    if (grupo === "municipais") {
      const mapa = focoIbge ? contest.bairros?.[focoIbge] : null;
      if (!mapa) continue;
      for (const [chave, votos] of Object.entries(mapa)) {
        const id = `bairro:${chave}`;
        if (!porId.has(id)) {
          porId.set(id, { id, label: chave, votosRecentes: votos });
        }
      }
    } else {
      for (const [ibge, municipio] of Object.entries(contest.municipios)) {
        const id = `ibge:${ibge}`;
        if (!porId.has(id)) {
          porId.set(id, {
            id,
            label: municipio.nome,
            votosRecentes: municipio.votos,
          });
        }
      }
    }
  }
  return [...porId.values()].sort(
    (a, b) =>
      b.votosRecentes - a.votosRecentes ||
      a.label.localeCompare(b.label, "pt-BR"),
  );
}

/** Voto de um recorte num pleito; null quando não há apuração para ele ali. */
function votosDoRecorte(
  contest: CandidateContest,
  recorteId: string,
  focoIbge: string | null,
): number | null {
  if (recorteId.startsWith("bairro:")) {
    const chave = recorteId.slice("bairro:".length);
    const mapa = focoIbge ? contest.bairros?.[focoIbge] : null;
    if (!mapa) return null;
    return mapa[chave] ?? null;
  }
  if (recorteId.startsWith("ibge:")) {
    const ibge = recorteId.slice("ibge:".length);
    return contest.municipios[ibge]?.votos ?? null;
  }
  return null;
}

/**
 * A cidade em foco do grupo municipal: a única cidade dos pleitos municipais,
 * quando todos correm na mesma. É dela que saem os bairros do seletor.
 */
function cidadeDoGrupoMunicipal(pleitos: CandidateContest[]): MunicipalScope | null {
  let foco: MunicipalScope | null = null;
  for (const contest of pleitos) {
    const escopo = getMunicipalScope(contest);
    if (!escopo) return null;
    if (foco && foco.ibgeCode !== escopo.ibgeCode) return null;
    foco = foco ?? escopo;
  }
  return foco;
}

/**
 * Modelo da visão "Geral" de um grupo (municipais ou federais/estaduais).
 *
 * Devolve null quando o grupo tem menos de dois pleitos: com um pleito só não
 * existe crescimento para mostrar, e uma tela de comparação vazia mente mais
 * do que ajuda.
 */
export function buildGrowthModel(
  dataset: CandidateDataset,
  grupo: GrowthGroupId,
  selecionados: readonly string[] = [],
): GrowthModel | null {
  const pleitos = pleitosDoGrupo(dataset, grupo);
  if (pleitos.length < 2) return null;

  const cidade = grupo === "municipais" ? cidadeDoGrupoMunicipal(pleitos) : null;
  const focoIbge = cidade?.ibgeCode ?? null;

  const totalPoints = pleitos.map((contest) =>
    pontoDoPleito(contest, contest.votosNoEstado),
  );
  const totalLabel = cidade ? `Total em ${cidade.nome}` : "Total da candidatura";

  const options = construirOpcoes(pleitos, grupo, focoIbge);
  const rotulos = new Map(options.map((opcao) => [opcao.id, opcao.label]));

  const series: GrowthSeries[] = [construirSerie("total", totalLabel, totalPoints)];
  for (const id of selecionados) {
    if (!rotulos.has(id)) continue;
    series.push(
      construirSerie(
        id,
        rotulos.get(id) as string,
        pleitos.map((contest) =>
          pontoDoPleito(contest, votosDoRecorte(contest, id, focoIbge)),
        ),
      ),
    );
  }

  const cargos = new Set(pleitos.map((contest) => `${contest.officeCode}-${contest.round}`));

  return {
    grupo,
    pleitos: totalPoints,
    series,
    breakdownLabel: cidade ? `Bairros de ${cidade.nome}` : "Municípios",
    options,
    temCargosDiferentes: cargos.size > 1,
  };
}

/** CSV da visão "Geral": uma linha por série e pleito, com a variação da seta. */
export function createGrowthCsv(model: GrowthModel): string {
  const headers = [
    "Recorte",
    "Ano",
    "Cargo",
    "Turno",
    "Votos",
    "Variação % desde o pleito anterior",
    "Comparável",
  ];
  const rows: CsvCell[][] = [];
  for (const serie of model.series) {
    const setaPorDestino = new Map(
      serie.arrows.map((seta) => [seta.paraContestId, seta]),
    );
    for (const ponto of serie.points) {
      const seta = setaPorDestino.get(ponto.contestId);
      // Célula vazia = sem apuração. Escrever 0 aqui transformaria "o bairro
      // não aparece neste pleito" em "o bairro deu zero voto", que é outra
      // afirmação — e é a que a planilha somaria sem perguntar.
      rows.push([
        serie.label,
        ponto.electionYear,
        ponto.officeName,
        ponto.round,
        ponto.votos ?? "",
        seta?.variacaoPct != null ? formatCsvDecimal(seta.variacaoPct) : "",
        // A coluna só fala quando existe variação para qualificar: "sim" ao
        // lado de uma variação vazia sugeriria que houve comparação e ela deu
        // nada, quando o que houve foi ausência de apuração.
        seta?.variacaoPct != null
          ? seta.comparavel
            ? "sim"
            : "cargos diferentes"
          : "",
      ]);
    }
  }
  return createCsv(headers, rows);
}

export function getGrowthCsvFilename(
  dataset: CandidateDataset,
  grupo: GrowthGroupId,
): string {
  const sufixo = grupo === "municipais" ? "municipais" : "federais-estaduais";
  return `estatisticas-crescimento-${dataset.metadata.slug}-${sufixo}.csv`;
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

/* -------------------------------------------------------------------------
 * Cartões de resumo de um pleito
 * ------------------------------------------------------------------------- */

/** Um cartão já formatado: rótulo, valor e a nota que o qualifica. */
export type ContestCard = { titulo: string; valor: string; nota: string };

/**
 * Os cartões de resumo de um pleito, como TEXTO já formatado.
 *
 * Mora aqui, e não no componente, porque agora existem dois consumidores: a
 * tela (ContestCards) e o sumário do relatório exportado. Se cada um montasse
 * os seus, o PDF que vai para a reunião poderia divergir do que a candidata
 * viu na tela — e a régua de leitura (municipal × estadual) é justamente a
 * parte que não pode divergir.
 *
 * A régua: prefeita e vereadora se disputam dentro de uma cidade, então os
 * cartões são da cidade; em cargo estadual/federal o estado inteiro é uma
 * disputa só e a leitura é estadual. Ausência sempre vira travessão.
 */
export function buildContestCards(contest: CandidateContest): ContestCard[] {
  const escopo = getMunicipalScope(contest);
  if (escopo) {
    return [
      {
        titulo: `Votos em ${escopo.nome}`,
        valor: formatInteger(escopo.votos),
        nota: "votos nominais apurados na cidade",
      },
      {
        titulo: "Posição na cidade",
        valor:
          escopo.posicaoNoMunicipio !== null
            ? `${escopo.posicaoNoMunicipio}º`
            : "—",
        nota: `de ${formatInteger(escopo.candidaturasComVoto)} candidaturas com voto`,
      },
      {
        titulo: "% dos válidos",
        valor:
          escopo.percentualValidos !== null
            ? formatPercent(escopo.percentualValidos)
            : "—",
        nota:
          escopo.percentualValidos !== null
            ? `sobre ${formatInteger(escopo.validos)} votos válidos`
            : "sem total de válidos apurado",
      },
    ];
  }

  const pctEstado = pctValidosNoEstado(contest);
  return [
    {
      titulo: "Votos no estado",
      valor: formatInteger(contest.votosNoEstado),
      nota: `em ${formatInteger(contest.municipiosComVoto)} municípios com voto`,
    },
    {
      titulo: "Posição no pleito",
      valor:
        contest.posicaoNoEstado !== null ? `${contest.posicaoNoEstado}º` : "—",
      nota: `de ${formatInteger(contest.candidaturasNoPleito)} candidaturas do cargo`,
    },
    {
      titulo: "% dos válidos no estado",
      valor: pctEstado !== null ? formatPercent(pctEstado) : "—",
      nota: "sobre os válidos dos municípios onde teve voto",
    },
    {
      titulo: "Concentração top 5",
      valor: formatPercent(contest.concentracaoPercentual.top5),
      nota: `top 10 ${formatPercent(contest.concentracaoPercentual.top10)} · top 20 ${formatPercent(contest.concentracaoPercentual.top20)}`,
    },
  ];
}
