/**
 * Trajetória de uma candidatura em foco (aba "Accorsi"), espelhando
 * `src/data/candidato/<slug>.json` (`scripts/process_candidato_foco.py`).
 * `null` = dado inexistente, nunca zero: sem denominador não há taxa nem rank.
 */

import type { AnalysisBand, AnalysisMetricId } from "./analysis";
import type { MunicipalityAgeStructure } from "./ageStructure";
import type { GenderCounts } from "./electorate";
import type { MunicipalityLiteracy } from "./literacy";
import type { MunicipalitySocioeconomicValues } from "./socioeconomic";

export type CandidateMetadata = {
  schemaVersion: number;
  state: string;
  slug: string;
  /** "pendente" no placeholder inicial, ausente depois de gerar os dados. */
  status?: string;
  nomeConsultado?: string;
  processedAtUtc?: string;
  pleitos: number;
  anos: number[];
  cargos: string[];
  anosSemDado?: string[];
  anosSemCadastroDeLocais?: number[];
  source?: string;
  sourceUrl?: string;
  candidatesUrl?: string;
  privacyLevel?: string;
  note?: string;
};

export type CandidateCandidatura = {
  sqCandidato: string;
  nomeCompleto: string;
  nomeUrna: string;
  partido: string;
  numero: string;
  situacaoCandidatura: string;
  resultado: string;
};

export type CandidateMunicipio = {
  nome: string;
  votos: number;
  validos: number;
  /** null quando o total de válidos do município não foi apurado (sem denominador). */
  percentualValidos: number | null;
  /** null quando o partido não teve voto apurado ali. */
  votosDoPartido: number | null;
  percentualDoPartido: number | null;
  posicaoNoMunicipio: number | null;
  candidaturasComVoto: number;
};

export type CandidateConcentracao = {
  top5: number;
  top10: number;
  top20: number;
};

export type CandidateContest = {
  /** "ano-cargo-turno", ex.: "2022-6-1". */
  id: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  round: number;
  electionDates?: string[];
  candidatura: CandidateCandidatura;
  votosNoEstado: number;
  posicaoNoEstado: number | null;
  candidaturasNoPleito: number;
  municipiosComVoto: number;
  concentracaoPercentual: CandidateConcentracao;
  votosSemLocalDeVotacao: number;
  temRecorteSubmunicipal: boolean;
  municipios: Record<string, CandidateMunicipio>;
  /** placeId -> votos; null quando o ano não tem cadastro de locais. */
  locais: Record<string, number> | null;
  /** ibge -> (bairro normalizado -> votos); null sem recorte submunicipal. */
  bairros: Record<string, Record<string, number>> | null;
};

export type CandidateDataset = {
  metadata: CandidateMetadata;
  contests: CandidateContest[];
};

/** Recorte mínimo do electorate-go.json que o motor precisa (estrutural, para testes). */
export type ElectorateSource = {
  metadata: { status?: string };
  municipalities: Record<string, { electorate: number }>;
};

/** ibge -> eleitorado; null enquanto o snapshot do eleitorado for placeholder. */
export type ElectorateIndex = Record<string, number> | null;

export type CandidateRankingMetricId =
  | "votos"
  | "percentualValidos"
  | "percentualPartido"
  | "votosPorMilEleitores";

export type CandidateRankingMetric = {
  id: CandidateRankingMetricId;
  label: string;
  shortLabel: string;
  description: string;
  /** Cabeçalho da coluna de valor no CSV exportado. */
  csvHeader: string;
  /** true quando a métrica só existe com o eleitorado gerado. */
  requiresElectorate: boolean;
};

export type CandidateRankingRow = {
  ibgeCode: string;
  nome: string;
  votos: number;
  /** Valor da métrica escolhida; linhas sem valor (null) nem entram no ranking. */
  value: number;
  posicaoNoMunicipio: number | null;
  /** Eleitorado usado no denominador; null quando não há dado. */
  eleitorado: number | null;
};

export type TrajectoryPoint = {
  id: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  /** Rótulo curto do cargo para caber sob a barra do gráfico. */
  officeShort: string;
  round: number;
  resultado: string;
  /** Resultado legível ("Eleita", "Foi ao 2º turno"…), para dropdown/tooltip. */
  resultadoLabel: string;
  /** Versão curta do resultado para caber sob a barra ("2º turno", "Eleita QP"). */
  resultadoShort: string;
  partido: string;
  votos: number;
};

export type BairroRow = {
  bairro: string;
  votos: number;
};

export type BairroComparisonRow = {
  bairro: string;
  /** null = bairro sem voto apurado naquele pleito (ausente, não zero). */
  votosAnterior: number | null;
  votosRecente: number | null;
  /** Variação % entre os pleitos; null sem base positiva nos dois lados. */
  variacaoPct: number | null;
};

/** O par de pleitos efetivamente comparado bairro a bairro. */
export type BairroComparison = {
  anterior: CandidateContest;
  recente: CandidateContest;
  rows: BairroComparisonRow[];
};

/**
 * O que a seção "Bairros de Goiânia" mostra para o pleito selecionado. A régua
 * é o CARGO e o turno: com um único pleito daquele cargo com recorte de
 * bairro não há comparação, e a interface diz isso.
 */
export type BairroComparisonScope = {
  officeCode: number;
  round: number;
  /** "Prefeita", "Deputada Federal · 2º turno": nomeia o que se compara. */
  officeLabel: string;
  /** Pleitos do mesmo cargo/turno com recorte de bairro, do mais antigo ao mais recente. */
  pleitos: CandidateContest[];
  /** null quando há menos de dois pleitos daquele cargo/turno com recorte. */
  comparacao: BairroComparison | null;
};

/* -------------------------------------------------------------------------
 * Janela "Estatísticas": tipos do motor de src/utils/candidateStats.ts.
 * ------------------------------------------------------------------------- */

/** Trajetória dividida em dois universos que NUNCA se somam entre si. */
export type ContestGroups = {
  /** Prefeita/Vereadora (códigos TSE 11 e 13): universo municipal. */
  municipais: CandidateContest[];
  /** Os demais cargos: universo federal/estadual. */
  federaisEstaduais: CandidateContest[];
};

/** Melhor votação da carreira (maior voto nominal num único pleito). */
export type CareerBest = {
  contestId: string;
  electionYear: number;
  officeName: string;
  round: number;
  votos: number;
};

/** Crescimento entre dois pleitos COMPARÁVEIS: mesmo cargo e mesmo turno. */
export type GrowthComparison = {
  anteriorId: string;
  recenteId: string;
  officeCode: number;
  officeName: string;
  round: number;
  anoAnterior: number;
  anoRecente: number;
  votosAnterior: number;
  votosRecente: number;
  /** Variação % (1 casa, arredondamento declarado no motor). */
  variacaoPct: number;
};

export type CareerOverview = {
  best: CareerBest | null;
  /** null quando não há dois pleitos municipais do mesmo cargo/turno. */
  growth: GrowthComparison | null;
  /** União de municípios com voto em QUALQUER pleito: contagem, nunca soma de votos. */
  municipiosAlcancados: number;
  /** Campanhas distintas (ano+cargo); um 2º turno é a mesma campanha. */
  campanhas: number;
};

/**
 * Recorte de um pleito MUNICIPAL: a única cidade onde a disputa aconteceu,
 * lida na régua daquela cidade e não na estadual.
 */
export type MunicipalScope = {
  ibgeCode: string;
  nome: string;
  votos: number;
  /** Votos válidos apurados na cidade; 0 quando o denominador não veio. */
  validos: number;
  /** % dos válidos da cidade; null sem denominador positivo. */
  percentualValidos: number | null;
  /** Colocação dela na disputa DAQUELA cidade; null quando não apurada. */
  posicaoNoMunicipio: number | null;
  /** Candidaturas com voto apurado na cidade: o "de N" da colocação. */
  candidaturasComVoto: number;
};

/**
 * Desempenho dela num município, na eleição mais recente de cada universo:
 * Goiânia traz dois (prefeitura e cadeira), que não se somam nem se comparam.
 */
export type CandidateMunicipioDestaque = {
  contestId: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  officeShort: string;
  round: number;
  /** true para Prefeito/Vereador: muda a régua de leitura do cartão. */
  municipal: boolean;
  votos: number;
  /** % dos válidos apurados no município; null sem denominador. */
  percentualValidos: number | null;
  /** Colocação dela naquele município; null quando não apurada. */
  posicaoNoMunicipio: number | null;
  candidaturasComVoto: number;
};

/* -------------------------------------------------------------------------
 * Visão "Geral": série é a linha do tempo de UM recorte (total, bairro ou
 * município). Voto de eleição diferente nunca vira soma: lê-se variação.
 * ------------------------------------------------------------------------- */

export type GrowthPoint = {
  contestId: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  officeShort: string;
  round: number;
  /** null = recorte sem voto apurado naquele pleito (ausente, jamais zero). */
  votos: number | null;
};

/** Passagem de um pleito para o seguinte dentro da mesma série. */
export type GrowthArrow = {
  deContestId: string;
  paraContestId: string;
  anoDe: number;
  anoPara: number;
  votosDe: number | null;
  votosPara: number | null;
  /** Variação % (1 casa); null sem base positiva dos dois lados. */
  variacaoPct: number | null;
  /** false quando os pleitos têm cargos ou turnos diferentes: variação visível, mas marcada. */
  comparavel: boolean;
};

export type GrowthSeries = {
  /** "total", "bairro:<chave>" ou "ibge:<código>". */
  id: string;
  label: string;
  /** Um ponto por pleito do grupo, do mais antigo ao mais recente. */
  points: GrowthPoint[];
  arrows: GrowthArrow[];
  /** Variação da primeira à última medição com base; null quando não há par. */
  variacaoTotalPct: number | null;
  /** false quando a ponta inicial e a final são de cargos/turnos diferentes. */
  variacaoTotalComparavel: boolean;
};

/** Recorte do seletor; `votosRecentes` = voto no pleito MAIS RECENTE, nunca a soma. */
export type GrowthOption = {
  id: string;
  label: string;
  votosRecentes: number;
};

export type GrowthGroupId = "municipais" | "federaisEstaduais";

export type GrowthModel = {
  grupo: GrowthGroupId;
  /** Pleitos do grupo, do mais antigo ao mais recente. */
  pleitos: GrowthPoint[];
  /** A série "total" sempre vem primeiro; depois os recortes escolhidos. */
  series: GrowthSeries[];
  /** "Bairros de Goiânia" ou "Municípios": o que o seletor oferece. */
  breakdownLabel: string;
  options: GrowthOption[];
  /** true quando o grupo mistura cargos: a interface explica as setas marcadas. */
  temCargosDiferentes: boolean;
};

/** Indicadores municipais oferecidos no cruzamento (subconjunto da Análise). */
export type StatsIndicatorId = Extract<
  AnalysisMetricId,
  | "female"
  | "literacyRate15Plus"
  | "share60Plus"
  | "electoralPenetration"
  | "electorate"
>;

export type StatsIndicator = {
  id: StatsIndicatorId;
  label: string;
  shortLabel: string;
  description: string;
  unit: string;
  /** true para o eleitorado total: scatter e Pearson usam log10, e a interface declara. */
  logScale: boolean;
};

/**
 * Município no snapshot do eleitorado, como o motor de indicadores o lê.
 * `name`, `electorate` e `gender` são obrigatórios; os demais, OPCIONAIS.
 * Campo ausente tira da análise o indicador que depende dele, nunca vale zero.
 */
export type StatsElectorateMunicipio = {
  name: string;
  electorate: number;
  gender: GenderCounts;
  /** Zonas eleitorais do município; ausente ou 0 deixa "eleitores por zona" sem valor. */
  zoneCount?: number;
  biometricsPct?: number;
  registeredDisability?: number;
  socialName?: number;
};

/**
 * Recorte do socioeconomic-<uf>.json: valores por município. OPCIONAL; sem ele
 * renda, PIB, densidade, saneamento, escolarização e população ficam fora dos
 * indicadores, em vez de entrar zerados.
 */
export type StatsSocioeconomicSource = {
  metadata: { status?: string };
  municipalities: Record<string, { values: MunicipalitySocioeconomicValues }>;
};

/** Insumo mínimo dos indicadores; estrutural, como o ElectorateSource acima. */
export type StatsIndicatorSource = {
  electorate: {
    metadata: { status?: string };
    municipalities: Record<string, StatsElectorateMunicipio>;
  };
  age: {
    metadata: { status?: string };
    municipalities: Record<string, MunicipalityAgeStructure>;
  };
  literacy: {
    metadata: { status?: string };
    municipalities: Record<string, MunicipalityLiteracy>;
  };
  /**
   * Snapshot do IBGE. Opcional: a janela de estatísticas passa três snapshots;
   * o relatório passa os quatro, para renda, população e urbanização no PDF.
   */
  socioeconomic?: StatsSocioeconomicSource;
};

export type ScatterPoint = {
  ibgeCode: string;
  nome: string;
  /** Valor plotado no eixo X (log10 do indicador quando logScale). */
  x: number;
  /** Valor bruto do indicador, para tooltip e CSV. */
  indicadorValor: number;
  /** % dos votos válidos da candidata no município (eixo Y). */
  y: number;
  votos: number;
};

export type ScatterModel = {
  indicator: StatsIndicator;
  points: ScatterPoint[];
  /** Municípios do pleito sem valor do indicador: FORA do gráfico, contados. */
  semIndicador: number;
  /** Municípios sem % dos válidos (denominador não apurado): idem. */
  semPercentual: number;
  /** Pearson sobre os pontos plotados; null sem amostra ou sem variância. */
  pearson: number | null;
  /** true quando n < 10: correlação não é exibida. */
  amostraInsuficiente: boolean;
};

/* -------------------------------------------------------------------------
 * Camada "candidato" do mapa: o coroplético do desempenho DELA, no pleito e na
 * métrica escolhidos no painel da aba "Accorsi". Dois cinzas distintos:
 *
 * - pleito MUNICIPAL (prefeita/vereadora): a disputa existiu em UMA cidade; os
 *   demais municípios ficam FORA da disputa, do ranking e da escala;
 * - pleito ESTADUAL/FEDERAL: município ausente é ZERO voto apurado (dado de
 *   verdade); o que pode faltar é o DENOMINADOR, e sem ele a taxa é null,
 *   cinza e fora da escala, jamais 0.
 * ------------------------------------------------------------------------- */

/** Universo territorial da camada: os municípios da malha do mapa (estrutural). */
export type CandidateLayerMunicipio = {
  ibgeCode: string;
  name: string;
};

export type CandidateLayerState = {
  /** Pleito em detalhe: o MESMO seletor do painel da aba dela. */
  contestId: string;
  /** Métrica do ranking e do mapa: idem, um par de controles só. */
  metricId: CandidateRankingMetricId;
  activeBands: AnalysisBand[];
};

/**
 * Por que um município está pintado, cinza ou fora da escala. Os dois cinzas
 * diferem: em `foraDaDisputa` ela não era candidata ali; em `semDenominador` o
 * dado existe (inclusive zero voto), mas a métrica não tem denominador ali.
 */
export type CandidateLayerStatus =
  | "medido"
  | "semDenominador"
  | "foraDaDisputa";

export type CandidateLayerItem = {
  ibgeCode: string;
  nome: string;
  /**
   * Votos nominais dela no município. 0 é dado de verdade (pleito estadual sem
   * voto dela apurado ali); null = ela não disputou aqui.
   */
  votos: number | null;
  /** Valor da métrica ativa; null mantém o município fora da escala. */
  value: number | null;
  /** null = fora da escala (cinza de dado ausente), nunca a faixa mais baixa. */
  band: AnalysisBand | null;
  /** Eleitorado apto usado como denominador; null quando não há snapshot dele. */
  eleitorado: number | null;
  status: CandidateLayerStatus;
  /** Posição no pleito pela métrica ativa; null fora da escala. */
  rank: number | null;
};

export type CandidateLayerModel = {
  contest: CandidateContest;
  contestLabel: string;
  /** "Deputada Federal · 2º turno": o cargo no feminino, como no painel. */
  officeLabel: string;
  metric: CandidateRankingMetric;
  /**
   * Métrica efetivamente usada: sem o snapshot do eleitorado não existe taxa
   * por 1.000 eleitores, a camada cai em votos absolutos e a legenda declara.
   */
  metricId: CandidateRankingMetricId;
  /** true quando o snapshot do eleitorado ainda é placeholder. */
  eleitoradoPendente: boolean;
  /** Cidade única de um pleito municipal; null nos pleitos estaduais/federais. */
  escopoMunicipal: MunicipalScope | null;
  /**
   * false quando há menos de dois municípios com valor (pleito municipal): sem
   * distribuição não há quintil, e as cinco faixas viram uma leitura só.
   */
  escalaPorQuantil: boolean;
  thresholds: number[];
  bandCounts: number[];
  /**
   * Faixas em foco no mapa. Sem escala por quantil todas ficam ativas: faixa
   * herdada de outro pleito apagaria a única cidade pintada.
   */
  activeBands: AnalysisBand[];
  allItems: CandidateLayerItem[];
  medidosCount: number;
  semDenominadorCount: number;
  foraDaDisputaCount: number;
  /**
   * Frase do denominador da métrica ativa (legenda e descrição da camada):
   * "votos por 1.000 eleitores" é sobre o ELEITORADO APTO, não a população.
   */
  denominadorNota: string | null;
};
