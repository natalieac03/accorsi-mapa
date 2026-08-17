/**
 * Trajetória de uma candidatura em foco (aba "Accorsi").
 *
 * O shape espelha o que `scripts/process_candidato_foco.py` grava em
 * `src/data/candidato/<slug>.json` (função `consolidar`). Os campos que lá
 * saem como `None` chegam aqui como `null` — e null significa "o dado não
 * existe", nunca zero: município sem denominador fica sem taxa e fora de
 * qualquer ranking, em vez de aparecer com 0% falso.
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

/**
 * Recorte mínimo do electorate-go.json que o motor precisa. Estrutural de
 * propósito: o motor não conhece o resto do perfil do eleitorado e os testes
 * conseguem montar o insumo inline.
 */
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
  /** Valor da métrica escolhida — linhas sem valor (null) nem entram no ranking. */
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
  /**
   * Versão curta do resultado para caber sob a barra sem colidir com as
   * vizinhas ("2º turno", "Eleita QP"); o rótulo completo fica no tooltip.
   */
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
 * O que a seção "Bairros de Goiânia" pode mostrar para o pleito selecionado.
 *
 * A régua é o CARGO (e o turno) do pleito escolhido no seletor: só se comparam
 * eleições da mesma disputa. Quando aquele cargo tem um pleito só com recorte
 * de bairro — o caso de uma candidatura a deputada federal com cadastro de
 * locais publicado em um único ano — não existe comparação, e a interface diz
 * isso em vez de silenciosamente comparar com outro cargo.
 */
export type BairroComparisonScope = {
  officeCode: number;
  round: number;
  /** "Prefeita", "Deputada Federal · 2º turno"… — nomeia o que se compara. */
  officeLabel: string;
  /** Pleitos do mesmo cargo/turno com recorte de bairro, do mais antigo ao mais recente. */
  pleitos: CandidateContest[];
  /** null quando há menos de dois pleitos daquele cargo/turno com recorte. */
  comparacao: BairroComparison | null;
};

/* -------------------------------------------------------------------------
 * Janela "Estatísticas" — tipos do motor de src/utils/candidateStats.ts.
 *
 * Moram aqui (e não num arquivo novo) porque descrevem a MESMA candidatura
 * em foco: agrupamentos da trajetória, crescimento entre pleitos comparáveis
 * e o cruzamento voto × indicador municipal.
 * ------------------------------------------------------------------------- */

/** Trajetória dividida em dois universos que NUNCA se somam entre si. */
export type ContestGroups = {
  /** Prefeita/Vereadora (códigos TSE 11 e 13) — universo municipal. */
  municipais: CandidateContest[];
  /** Os demais cargos — universo federal/estadual. */
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

/**
 * Crescimento entre dois pleitos COMPARÁVEIS: mesmo cargo e mesmo turno.
 * Comparar prefeita com vereadora (ou 1º com 2º turno) não mede crescimento
 * de nada — são disputas de natureza diferente.
 */
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
  /** União de municípios com voto em QUALQUER pleito — contagem, nunca soma de votos. */
  municipiosAlcancados: number;
  /** Campanhas distintas (ano+cargo); um 2º turno é a mesma campanha. */
  campanhas: number;
};

/**
 * Recorte de um pleito MUNICIPAL: a única cidade onde a disputa aconteceu.
 *
 * Prefeita e vereadora se disputam dentro de um município só. Ler esse pleito
 * com a régua estadual produz cartão degenerado — "1 município com voto",
 * "concentração top 5: 100%" — e uma posição ("3ª de 627 candidaturas") que
 * compara a candidata com gente que disputava OUTRA cidade. Aqui o pleito é
 * lido na régua certa: a disputa daquela cidade.
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
  /** Candidaturas com voto apurado na cidade — o "de N" da colocação. */
  candidaturasComVoto: number;
};

/**
 * O desempenho dela num município, na eleição mais recente de cada universo.
 *
 * É o que aparece no cartão do município clicado no mapa. Um município comum
 * traz um só: a última disputa estadual/federal em que ele apurou voto dela.
 * Goiânia traz dois, porque lá ela disputou os dois universos — a prefeitura e
 * uma cadeira — e esses números não se somam nem se comparam entre si.
 */
export type CandidateMunicipioDestaque = {
  contestId: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  officeShort: string;
  round: number;
  /** true para Prefeito/Vereador — muda a régua de leitura do cartão. */
  municipal: boolean;
  votos: number;
  /** % dos válidos apurados no município; null sem denominador. */
  percentualValidos: number | null;
  /** Colocação dela naquele município; null quando não apurada. */
  posicaoNoMunicipio: number | null;
  candidaturasComVoto: number;
};

/* -------------------------------------------------------------------------
 * Visão "Geral": crescimento ao longo das eleições
 *
 * Uma série é uma linha do tempo de UM recorte (o total da candidatura, um
 * bairro, um município) medida em vários pleitos. A regra que atravessa todos
 * estes tipos: voto de eleição diferente nunca vira soma — o que se lê entre
 * pleitos é variação, e só quando existe base para calculá-la.
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
  /**
   * false quando os dois pleitos são de cargos ou turnos diferentes. A
   * variação continua visível — é o que a usuária pediu para enxergar — mas
   * marcada, porque disputar a prefeitura e disputar uma cadeira na Assembleia
   * não são a mesma corrida e a taxa entre elas não mede a mesma coisa.
   */
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

/**
 * Recorte oferecido no seletor. `votosRecentes` é o voto no pleito MAIS
 * RECENTE em que o recorte aparece — nunca a soma entre eleições, que
 * misturaria universos de eleitores diferentes só para ordenar uma lista.
 */
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
  /** "Bairros de Goiânia" ou "Municípios" — o que o seletor oferece. */
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
  /**
   * true para o eleitorado total: a distribuição é tão assimétrica (Goiânia
   * tem ~1000× o menor município) que o eixo linear esmagaria todo mundo no
   * canto; o scatter e o Pearson usam log10, e a interface declara isso.
   */
  logScale: boolean;
};

/**
 * Um município no snapshot do eleitorado, como o motor de indicadores o lê.
 *
 * `name`, `electorate` e `gender` são obrigatórios porque sem eles não existe
 * indicador nenhum. Os demais são OPCIONAIS de propósito: o insumo é
 * estrutural (os testes montam payload inline) e nem todo consumidor tem o
 * perfil completo do eleitorado à mão. Campo ausente significa "esta
 * instalação não trouxe o dado" — e o indicador que depende dele fica FORA da
 * análise, declarado como sem dado. Nunca entra valendo zero: um município com
 * `biometricsPct` ausente não é um município com 0% de biometria.
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
 * Recorte do socioeconomic-<uf>.json que o motor precisa: o mapa de valores
 * por município. É OPCIONAL no insumo — sem ele, renda, PIB, densidade,
 * saneamento, escolarização e população simplesmente não entram na lista de
 * indicadores disponíveis, em vez de entrarem zerados.
 */
export type StatsSocioeconomicSource = {
  metadata: { status?: string };
  municipalities: Record<string, { values: MunicipalitySocioeconomicValues }>;
};

/**
 * Insumo mínimo para montar os indicadores — estrutural de propósito, como o
 * ElectorateSource acima: os testes montam payloads inline e o motor não
 * conhece o resto dos snapshots.
 */
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
   * Snapshot do IBGE. Opcional: quem só precisa dos indicadores do eleitorado
   * (a janela de estatísticas até aqui) continua passando três snapshots, e o
   * relatório passa os quatro para renda, população e urbanização chegarem ao
   * PDF.
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
  /** Municípios do pleito sem valor do indicador — FORA do gráfico, contados. */
  semIndicador: number;
  /** Municípios sem % dos válidos (denominador não apurado) — idem. */
  semPercentual: number;
  /** Pearson sobre os pontos plotados; null sem amostra ou sem variância. */
  pearson: number | null;
  /** true quando n < 10 — correlação não é exibida. */
  amostraInsuficiente: boolean;
};

/* -------------------------------------------------------------------------
 * Camada "candidato" do mapa — o coroplético do desempenho DELA.
 *
 * A aba "Accorsi" já lê a trajetória no painel; esta camada leva a mesma
 * leitura para o mapa, seguindo o pleito e a métrica escolhidos lá (um par de
 * controles só, nunca dois concorrendo).
 *
 * A regra que atravessa os tipos abaixo, e que aqui tem dois casos bem
 * distintos que NUNCA podem virar o mesmo cinza sem explicação:
 *
 * - pleito MUNICIPAL (prefeita/vereadora): a disputa existiu em UMA cidade.
 *   Os outros municípios não são "zero voto" — ela não estava na urna deles.
 *   Ficam FORA da disputa, fora do ranking e fora da escala;
 * - pleito ESTADUAL/FEDERAL: ela estava na urna do estado inteiro, então
 *   município ausente do pleito é ZERO voto apurado (um dado de verdade).
 *   O que pode faltar ali é o DENOMINADOR da métrica — e sem denominador a
 *   taxa é null, cinza e fora da escala, jamais 0.
 * ------------------------------------------------------------------------- */

/**
 * Universo territorial da camada: os municípios da malha do mapa. Estrutural
 * de propósito (como ElectorateSource acima) para os testes montarem a lista
 * inline e o motor não depender do perfil completo do eleitorado.
 */
export type CandidateLayerMunicipio = {
  ibgeCode: string;
  name: string;
};

export type CandidateLayerState = {
  /** Pleito em detalhe — o MESMO seletor do painel da aba dela. */
  contestId: string;
  /** Métrica do ranking e do mapa — idem, um par de controles só. */
  metricId: CandidateRankingMetricId;
  activeBands: AnalysisBand[];
};

/**
 * Por que um município está pintado, cinza ou fora da escala.
 *
 * `foraDaDisputa` e `semDenominador` são os dois cinzas, e são coisas
 * diferentes: no primeiro ela não era candidata ali; no segundo o dado dela
 * existe (inclusive zero voto apurado), mas a métrica escolhida não tem
 * denominador naquele município.
 */
export type CandidateLayerStatus =
  | "medido"
  | "semDenominador"
  | "foraDaDisputa";

export type CandidateLayerItem = {
  ibgeCode: string;
  nome: string;
  /**
   * Votos nominais dela no município. 0 é dado de verdade (pleito estadual em
   * que o município não apurou voto dela); null significa "ela não disputou
   * aqui" — pleito municipal de outra cidade.
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
  /** "Deputada Federal · 2º turno" — o cargo no feminino, como no painel. */
  officeLabel: string;
  metric: CandidateRankingMetric;
  /**
   * Métrica efetivamente usada. Sem o snapshot do eleitorado a taxa por 1.000
   * eleitores não existe: em vez de pintar o estado inteiro de cinza, a camada
   * cai em votos absolutos e a legenda declara a troca.
   */
  metricId: CandidateRankingMetricId;
  /** true quando o snapshot do eleitorado ainda é placeholder. */
  eleitoradoPendente: boolean;
  /** Cidade única de um pleito municipal; null nos pleitos estaduais/federais. */
  escopoMunicipal: MunicipalScope | null;
  /**
   * false quando há menos de dois municípios com valor — é o caso do pleito
   * municipal. Sem distribuição não existe quintil: a legenda troca as cinco
   * faixas por uma leitura só, em vez de fingir uma escala.
   */
  escalaPorQuantil: boolean;
  thresholds: number[];
  bandCounts: number[];
  /**
   * Faixas em foco no mapa. Sem escala por quantil todas ficam ativas: filtrar
   * faixa não faz sentido quando existe um valor só, e uma faixa herdada de
   * outro pleito apagaria a única cidade pintada.
   */
  activeBands: AnalysisBand[];
  allItems: CandidateLayerItem[];
  medidosCount: number;
  semDenominadorCount: number;
  foraDaDisputaCount: number;
  /**
   * Frase do denominador da métrica ativa, escrita na legenda e na descrição
   * da camada. Existe porque "votos por 1.000 eleitores" é sobre o ELEITORADO
   * APTO — não sobre a população do município, que inclui quem não vota.
   */
  denominadorNota: string | null;
};
