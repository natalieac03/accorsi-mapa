import type { AnalysisMetricId } from "../types/analysis";
import type {
  CandidateContest,
  StatsElectorateMunicipio,
  StatsIndicatorSource,
} from "../types/candidate";
import type { MunicipalityProfile } from "../types/electorate";
import { getAnalysisMetricValue } from "./analysis.ts";
import {
  buildStatsProfiles,
  hasSocioeconomicSnapshot,
  hasStatsElectorateField,
  isMunicipalContest,
  PEARSON_MIN_N,
  type StatsElectorateField,
} from "./candidateStats.ts";
import {
  getIndicatorMetadata,
  listIndicatorMetadata,
  type IndicatorMetadata,
} from "./reportIndicators.ts";
import type { ReportOmission } from "./reportModel.ts";

/**
 * UNIVERSO DO RELATÓRIO — o conjunto completo que o PDF analisa, reconstruído
 * do zero a partir do pleito e dos snapshots territoriais.
 *
 * Este arquivo existe por causa de um defeito concreto: o relatório era
 * montado a partir do `scatter` da TELA, que só existe para o indicador
 * selecionado no seletor. Com o filtro "Mulheres" ativo, o PDF saía com um
 * único cruzamento — o do percentual feminino — e com cara de relatório
 * completo. O mesmo valia para o ranking, que herdava a métrica escolhida na
 * interface e, pior, deixava de fora os municípios sem denominador para
 * aquela métrica: o universo mudava em silêncio conforme o clique.
 *
 * A regra que este módulo materializa, e que nenhuma função daqui pode violar:
 *
 *   O FILTRO DA TELA NÃO LIMITA O RELATÓRIO. Ele ordena e destaca. Não exclui
 *   indicador, não limita consulta, não produz PDF parcial e não muda o
 *   universo de municípios.
 *
 * Daí a separação de conceitos que atravessa o motor inteiro:
 *
 *   - `activeViewFilter` — o que está selecionado na interface. Entra em UMA
 *     única função: `orderIndicators`. Em nenhuma outra;
 *   - `reportDataset` — o conjunto COMPLETO, montado aqui, sem consultar o
 *     que a tela mostra;
 *   - `featuredIndicator` — o que recebe destaque (vem do filtro, e destaque
 *     é tudo o que ele pode fazer);
 *   - `availableIndicators` — todos os indicadores com dado suficiente para
 *     aquele universo. Quem não tem dado é DECLARADO como omitido, com o
 *     motivo — nunca escondido.
 *
 * Duas disciplinas herdadas do projeto valem aqui com força extra:
 *
 *   1. null nunca vira zero. Município sem denominador fica FORA da análise e
 *      entra na lista de exclusões, com motivo. Município sem valor de um
 *      indicador não é município com valor 0;
 *   2. nada é fixado: nem candidatura, nem partido, nem cargo, nem ano, nem
 *      UF, nem indicador. A lista de indicadores é derivada do catálogo
 *      (`reportIndicators.ts`), e o universo territorial, do próprio pleito.
 */

/* -------------------------------------------------------------------------
 * Tipos — contrato público para quem renderiza o relatório
 * ------------------------------------------------------------------------- */

/**
 * Um município do recorte, com a métrica eleitoral principal e o valor de
 * CADA indicador do catálogo.
 */
export type ReportMunicipio = {
  ibgeCode: string;
  nome: string;
  /** Votos nominais apurados da candidatura no município. */
  votos: number;
  /** Votos válidos apurados do cargo no município (denominador). */
  validos: number;
  /**
   * MÉTRICA ELEITORAL PRINCIPAL do relatório: % dos votos válidos do
   * município que foram da candidatura. `null` quando o total de válidos não
   * foi apurado — e null é ausência, jamais 0%.
   */
  percentualValidos: number | null;
  /** % dos votos do partido no município; null quando não apurado. */
  percentualDoPartido: number | null;
  /** Colocação da candidatura naquele município; null quando não apurada. */
  posicaoNoMunicipio: number | null;
  /** Candidaturas com voto apurado no município — o "de N" da colocação. */
  candidaturasComVoto: number;
  /**
   * Participação do município no total de votos da candidatura no pleito, em
   * %. null quando o pleito não tem voto apurado (sem base para a divisão).
   */
  participacaoNosVotos: number | null;
  /** Eleitorado do município no snapshot; null sem snapshot utilizável. */
  eleitorado: number | null;
  /** Votos por mil eleitores; null sem eleitorado positivo. */
  votosPorMilEleitores: number | null;
  /**
   * Valor de cada indicador do catálogo neste município. Todas as chaves
   * existem sempre; `null` significa "sem dado nesta instalação".
   */
  indicadores: Record<AnalysisMetricId, number | null>;
};

/** Por que um município do recorte ficou fora do universo analítico. */
export type ReportExclusionReason = "sem-percentual-valido";

export type ReportExclusion = {
  ibgeCode: string;
  nome: string;
  votos: number;
  motivo: ReportExclusionReason;
  /** Frase pronta para o relatório declarar a exclusão. */
  descricao: string;
};

/** Situação de um indicador do catálogo neste universo. */
export type IndicatorAvailability = {
  id: AnalysisMetricId;
  indicator: IndicatorMetadata;
  /** Municípios do universo analítico COM valor do indicador. */
  cobertura: number;
  /** Municípios do universo analítico sem valor do indicador. */
  semValor: number;
  /** true quando `cobertura >= minimoMunicipios`. */
  disponivel: boolean;
  /** null quando disponível; motivo declarado quando não. */
  motivoIndisponibilidade: string | null;
};

/**
 * O universo COMPLETO do relatório. Sai idêntico para qualquer estado da
 * interface: nada aqui é parametrizado pelo que está selecionado na tela.
 */
/**
 * Identificação da candidatura no pleito, lida do próprio arquivo do TSE.
 * Nenhum nome, partido ou número está fixado no código: trocar o JSON da
 * candidatura troca o relatório inteiro.
 */
export type ReportCandidatura = {
  nomeUrna: string;
  nomeCompleto: string;
  partido: string;
  numero: string;
  resultado: string;
};

export type ReportDataset = {
  contestId: string;
  /** A candidatura do pleito, como o TSE publica. */
  candidatura: ReportCandidatura;
  electionYear: number;
  officeCode: number;
  officeName: string;
  round: number;
  /** true em pleito de prefeita/vereadora — disputa dentro de uma cidade. */
  municipal: boolean;
  /** TODOS os municípios com voto apurado no pleito, do mais votado ao menos. */
  municipios: ReportMunicipio[];
  /**
   * Subconjunto com a métrica eleitoral principal apurada — a base de toda
   * correlação, comparação de grupos e quadrante. As referências são as
   * mesmas de `municipios`, não cópias.
   */
  analiticos: ReportMunicipio[];
  /** Municípios do recorte que ficaram fora do universo analítico, com motivo. */
  exclusoes: ReportExclusion[];
  /** Votos nominais da candidatura no pleito, como o TSE publica. */
  votosNoPleito: number;
  /** Soma dos votos dos municípios do recorte. */
  votosNosMunicipios: number;
  /** Eleitorado somado dos municípios do recorte; null sem snapshot. */
  eleitoradoCoberto: number | null;
  /** TODOS os indicadores do catálogo, disponíveis ou não. */
  indicadores: IndicatorAvailability[];
  /** Mínimo de municípios com valor para um indicador ser analisado. */
  minimoMunicipios: number;
  /** false quando o snapshot do eleitorado ainda é placeholder. */
  perfisDisponiveis: boolean;
  /** false quando o snapshot do IBGE não veio (indicadores socioeconômicos). */
  socioeconomicoDisponivel: boolean;
};

/**
 * O QUE ESTÁ SELECIONADO NA TELA. Existe para ser passado adiante sem virar
 * filtro: quem consome só pode usá-lo para ordenar e destacar.
 */
export type ReportViewFilter = {
  /** Indicador selecionado no seletor da janela; null quando não há seleção. */
  featuredIndicatorId: AnalysisMetricId | null;
};

/* -------------------------------------------------------------------------
 * Construção
 * ------------------------------------------------------------------------- */

/**
 * Indicadores que dependem de um campo BRUTO do snapshot do eleitorado que
 * pode não vir. Sem este mapa, um insumo sem biometria produziria "0%" em
 * todos os municípios — um valor sintético, com variância zero, que entraria
 * em correlação como se fosse apuração.
 */
const CAMPO_BRUTO_EXIGIDO: Partial<
  Record<AnalysisMetricId, StatsElectorateField>
> = {
  biometrics: "biometricsPct",
  disability: "registeredDisability",
  socialName: "socialName",
  electorsPerZone: "zoneCount",
};

/**
 * Valor de um indicador para um município, ou null.
 *
 * O cálculo é REUSADO de `getAnalysisMetricValue` — a mesma conta da aba
 * Análise, nunca uma segunda implementação que possa divergir. O que se
 * acrescenta é a guarda do campo bruto ausente descrita acima.
 */
function valorDoIndicador(
  profile: MunicipalityProfile | undefined,
  bruto: StatsElectorateMunicipio | undefined,
  id: AnalysisMetricId,
): number | null {
  if (!profile) return null;
  const campo = CAMPO_BRUTO_EXIGIDO[id];
  if (campo && !hasStatsElectorateField(bruto, campo)) return null;
  const valor = getAnalysisMetricValue(profile, id);
  return valor === null || !Number.isFinite(valor) ? null : valor;
}

/** Votos por mil eleitores; null sem eleitorado positivo (não pode dividir). */
function votosPorMil(votos: number, eleitorado: number | null): number | null {
  if (eleitorado === null || eleitorado <= 0) return null;
  return (votos / eleitorado) * 1000;
}

/**
 * Monta o universo completo do relatório para um pleito.
 *
 * Repare no que a assinatura NÃO tem: nenhum `indicatorId`, nenhum
 * `rankingMetric`, nenhum estado de interface. Não é omissão — é o contrato.
 * O que a tela mostra não pode alterar uma linha deste conjunto, e o teste
 * `o mesmo reportDataset sai idêntico com activeViewFilter diferente` existe
 * para travar isso.
 */
export function buildReportDataset(input: {
  contest: CandidateContest;
  /** Snapshots territoriais; o socioeconômico é opcional. */
  source: StatsIndicatorSource;
}): ReportDataset {
  const { contest, source } = input;
  const profiles = buildStatsProfiles(source);
  const catalogo = listIndicatorMetadata();

  const municipios: ReportMunicipio[] = [];
  const exclusoes: ReportExclusion[] = [];
  let votosNosMunicipios = 0;
  let eleitoradoCoberto = 0;
  let temEleitorado = false;

  for (const [ibge, municipio] of Object.entries(contest.municipios)) {
    const profile = profiles?.[ibge];
    const bruto = source.electorate.municipalities[ibge];
    const eleitorado = profile ? profile.electorate : null;
    if (eleitorado !== null) {
      eleitoradoCoberto += eleitorado;
      temEleitorado = true;
    }
    votosNosMunicipios += municipio.votos;

    const indicadores = {} as Record<AnalysisMetricId, number | null>;
    for (const metadata of catalogo) {
      indicadores[metadata.id] = valorDoIndicador(profile, bruto, metadata.id);
    }

    const linha: ReportMunicipio = {
      ibgeCode: ibge,
      nome: municipio.nome,
      votos: municipio.votos,
      validos: municipio.validos,
      percentualValidos: municipio.percentualValidos,
      percentualDoPartido: municipio.percentualDoPartido,
      posicaoNoMunicipio: municipio.posicaoNoMunicipio,
      candidaturasComVoto: municipio.candidaturasComVoto,
      participacaoNosVotos:
        contest.votosNoEstado > 0
          ? (municipio.votos / contest.votosNoEstado) * 100
          : null,
      eleitorado,
      votosPorMilEleitores: votosPorMil(municipio.votos, eleitorado),
      indicadores,
    };
    municipios.push(linha);

    // Sem denominador não há métrica eleitoral principal: o município sai da
    // ANÁLISE (correlação, grupos, quadrantes) e entra declarado na lista de
    // exclusões. Ele continua no universo de votos — a concentração e o
    // ranking de votos absolutos seguem contando com ele —, porque tirá-lo
    // dali seria mudar o total apurado da candidatura em silêncio.
    if (linha.percentualValidos === null) {
      exclusoes.push({
        ibgeCode: ibge,
        nome: municipio.nome,
        votos: municipio.votos,
        motivo: "sem-percentual-valido",
        descricao:
          "Sem total de votos válidos apurado no município: não existe " +
          "percentual dos válidos para cruzar com os indicadores. Fica fora " +
          "da análise e não entra como zero.",
      });
    }
  }

  // Ordem estável e determinística: mais votado primeiro, nome desempata.
  municipios.sort(
    (a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, "pt-BR"),
  );
  exclusoes.sort(
    (a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const analiticos = municipios.filter(
    (municipio) => municipio.percentualValidos !== null,
  );

  const indicadores = catalogo.map((indicator) =>
    avaliarIndicador(indicator, analiticos, profiles !== null),
  );

  return {
    contestId: contest.id,
    candidatura: {
      nomeUrna: contest.candidatura.nomeUrna,
      nomeCompleto: contest.candidatura.nomeCompleto,
      partido: contest.candidatura.partido,
      numero: contest.candidatura.numero,
      resultado: contest.candidatura.resultado,
    },
    electionYear: contest.electionYear,
    officeCode: contest.officeCode,
    officeName: contest.officeName,
    round: contest.round,
    municipal: isMunicipalContest(contest),
    municipios,
    analiticos,
    exclusoes,
    votosNoPleito: contest.votosNoEstado,
    votosNosMunicipios,
    eleitoradoCoberto: temEleitorado ? eleitoradoCoberto : null,
    indicadores,
    minimoMunicipios: PEARSON_MIN_N,
    perfisDisponiveis: profiles !== null,
    socioeconomicoDisponivel: hasSocioeconomicSnapshot(source),
  };
}

/**
 * Situação de um indicador: quantos municípios do universo analítico têm
 * valor e, quando não dá para analisar, POR QUÊ — em uma frase que o
 * relatório publica. Indicador sem dado nunca some da lista; ele aparece
 * declarado.
 */
function avaliarIndicador(
  indicator: IndicatorMetadata,
  analiticos: readonly ReportMunicipio[],
  temPerfis: boolean,
): IndicatorAvailability {
  const cobertura = analiticos.filter(
    (municipio) => municipio.indicadores[indicator.id] !== null,
  ).length;
  const semValor = analiticos.length - cobertura;
  const disponivel = cobertura >= PEARSON_MIN_N;
  return {
    id: indicator.id,
    indicator,
    cobertura,
    semValor,
    disponivel,
    motivoIndisponibilidade: disponivel
      ? null
      : motivoIndisponibilidade(indicator, cobertura, analiticos.length, temPerfis),
  };
}

function motivoIndisponibilidade(
  indicator: IndicatorMetadata,
  cobertura: number,
  universo: number,
  temPerfis: boolean,
): string {
  const nome = indicator.metric.label;
  if (!temPerfis) {
    return (
      `${nome}: o snapshot territorial desta instalação ainda não foi ` +
      "gerado. Rode `bash gerar_dados.sh` na raiz do projeto."
    );
  }
  if (universo === 0) {
    return (
      `${nome}: nenhum município do recorte tem percentual dos válidos ` +
      "apurado, então não há base para cruzar com indicador nenhum."
    );
  }
  if (cobertura === 0) {
    return (
      `${nome}: nenhum dos ${universo} municípios do recorte tem valor ` +
      `apurado para este indicador (fonte ${indicator.metric.sourceLabel}).`
    );
  }
  return (
    `${nome}: só ${cobertura} de ${universo} municípios do recorte têm valor ` +
    `apurado, abaixo do mínimo de ${PEARSON_MIN_N} para calcular associação. ` +
    "Com poucos pontos o coeficiente vira ruído de amostra pequena."
  );
}

/* -------------------------------------------------------------------------
 * Disponibilidade, omissões e ordem
 * ------------------------------------------------------------------------- */

/**
 * Todo indicador com pelo menos `minimoMunicipios` municípios com valor.
 *
 * A pergunta que decide o que entra no relatório é "existe dado?", nunca "o
 * que está selecionado na tela?". Ordem do catálogo.
 */
export function getAvailableIndicators(
  dataset: ReportDataset,
): IndicatorAvailability[] {
  return dataset.indicadores.filter((item) => item.disponivel);
}

/** O complemento: os indicadores que ficaram fora, cada um com o motivo. */
export function getUnavailableIndicators(
  dataset: ReportDataset,
): IndicatorAvailability[] {
  return dataset.indicadores.filter((item) => !item.disponivel);
}

/**
 * As omissões declaradas do relatório: um item por indicador sem dado
 * suficiente. Esconder o indicador daria a impressão de que ele não existe;
 * declará-lo diz que ele existe e que o dado não veio.
 */
export function buildIndicatorOmissions(
  dataset: ReportDataset,
): ReportOmission[] {
  return getUnavailableIndicators(dataset).map((item) => ({
    title: `Cruzamento com ${item.indicator.metric.label}`,
    reason: item.motivoIndisponibilidade ?? "Sem dado suficiente no recorte.",
  }));
}

/**
 * A ÚNICA função do motor em que o filtro da tela pode influir.
 *
 * O indicador em destaque vai para a frente; o resto segue a ordem do
 * catálogo. Nada entra, nada sai — trocar o destaque reordena a lista e não
 * muda o seu conteúdo, o que é exatamente o que se exige do filtro: ordenar e
 * destacar, nunca limitar.
 */
export function orderIndicators<T extends { id: AnalysisMetricId }>(
  available: readonly T[],
  featuredId: AnalysisMetricId | null,
): T[] {
  const ordem = listIndicatorMetadata().map((item) => item.id);
  const posicao = (id: AnalysisMetricId) => {
    const indice = ordem.indexOf(id);
    return indice === -1 ? ordem.length : indice;
  };
  return [...available].sort((a, b) => {
    if (featuredId !== null) {
      if (a.id === featuredId && b.id !== featuredId) return -1;
      if (b.id === featuredId && a.id !== featuredId) return 1;
    }
    return posicao(a.id) - posicao(b.id);
  });
}

/**
 * O indicador em destaque, quando ele está entre os disponíveis.
 *
 * Devolve null quando o que está selecionado na tela não tem dado no recorte:
 * o relatório continua completo, apenas sem destaque — o filtro não pode nem
 * limitar o conjunto nem forçar um capítulo sem apuração.
 */
export function getFeaturedIndicator(
  dataset: ReportDataset,
  filter: ReportViewFilter | null,
): IndicatorMetadata | null {
  const id = filter?.featuredIndicatorId ?? null;
  if (id === null) return null;
  const disponivel = getAvailableIndicators(dataset).some(
    (item) => item.id === id,
  );
  return disponivel ? getIndicatorMetadata(id) : null;
}
