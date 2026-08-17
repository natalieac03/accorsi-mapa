import type {
  CandidateContest,
  CandidateDataset,
  GrowthGroupId,
  GrowthModel,
  TrajectoryPoint,
} from "../types/candidate";
import type { CareerOverview } from "../types/candidate";
import { ESTADO } from "../config/estado.ts";
import {
  getContestLabel,
  getOfficeLabel,
  isCandidatePendente,
} from "./candidate.ts";
import {
  buildContestCards,
  getMunicipalScope,
  PEARSON_MIN_N,
} from "./candidateStats.ts";
import { formatDecimal, formatInteger, formatPercent } from "./electorate.ts";
import {
  buildReportAnalysis,
  formatAssociationCoefficient,
  type CorrelationInterval,
  type IndicatorAnalysis,
  type ReportAnalysis,
} from "./reportAnalysis.ts";
import type { ReportDataset, ReportViewFilter } from "./reportDataset.ts";
import {
  buildContestSections,
  buildContestSummarySections,
  selecionarIndicadoresResumidos,
} from "./reportNarrative.ts";
import {
  columnFormatFromMetric,
  columnHeaderWithUnit,
  createReportDocument,
  slugifyReport,
  type ReportCell,
  type ReportColumn,
  type ReportDocument,
  type ReportHighlight,
  type ReportImage,
  type ReportOmission,
  type ReportSource,
  type ReportTable,
  type ReportVariant,
} from "./reportModel.ts";

/**
 * Relatórios da janela "Estatísticas" — a montagem do MODELO (capa, cartões,
 * tabelas, omissões) a partir dos motores já existentes. Nada aqui conhece
 * exceljs ou jsPDF: quem traduz o modelo em arquivo são `exportExcel.ts` e
 * `exportPdf.ts`, e é por isso que estas funções podem ser testadas com um
 * dataset sintético inline.
 *
 * Cada visão da janela vira um relatório do RECORTE VISÍVEL: a visão geral
 * exporta a trajetória inteira, a visão de um pleito exporta aquele pleito, e
 * a visão "Geral" exporta o crescimento do grupo. Ninguém recebe um arquivo
 * com dados que não estava vendo.
 */

const ATRIBUICAO =
  "Elaborado com dados públicos do TSE e do IBGE · Plataforma de inteligência eleitoral";

/** A candidatura em foco, lida do pleito mais recente do próprio arquivo. */
function getCandidatura(dataset: CandidateDataset) {
  const recente = [...dataset.contests].sort(
    (a, b) => b.electionYear - a.electionYear || b.round - a.round,
  )[0];
  if (!recente) return "Candidatura";
  return `${recente.candidatura.nomeUrna} · ${recente.candidatura.partido}`;
}

/**
 * Procedência do arquivo da candidata. O `source`/`sourceUrl` vem do próprio
 * JSON gravado pelo ETL — se um dia a fonte mudar, o relatório muda junto, sem
 * ninguém precisar lembrar de editar um texto aqui.
 */
function fonteTse(dataset: CandidateDataset, detail: string): ReportSource {
  return {
    label: dataset.metadata.source ?? "TSE · Dados abertos de resultados",
    detail,
    url: dataset.metadata.sourceUrl,
  };
}

function baseDocument(
  dataset: CandidateDataset,
  input: {
    filenameBase: string;
    title: string;
    subtitle: string;
    scope: string;
    generatedAt: Date;
    images?: ReportImage[];
  },
): ReportDocument {
  return createReportDocument({
    filenameBase: input.filenameBase,
    title: input.title,
    subtitle: input.subtitle,
    scope: input.scope,
    candidatura: getCandidatura(dataset),
    estado: ESTADO.nome,
    generatedAt: input.generatedAt,
    attribution: ATRIBUICAO,
    images: input.images ?? [],
  });
}

/**
 * Dataset ainda não gerado: em vez de um arquivo com abas vazias (que
 * pareceria "a candidata não teve voto"), o relatório sai com a omissão
 * declarada. Os componentes desabilitam o botão antes disso — esta é a
 * segunda linha de defesa, para nenhum caminho novo produzir arquivo vazio.
 */
export function omissaoDatasetPendente(): ReportOmission {
  return {
    title: "Trajetória da candidata (TSE)",
    reason:
      "Os dados desta instalação ainda não foram baixados do TSE. Rode `bash gerar_dados.sh` na raiz do projeto.",
  };
}

/* -------------------------------------------------------------------------
 * Visão geral — trajetória da carreira
 * ------------------------------------------------------------------------- */

const COLUNAS_TRAJETORIA: ReportColumn[] = [
  { header: "Ano", format: "numero" },
  { header: "Cargo", format: "texto" },
  { header: "Turno", format: "numero" },
  { header: "Partido", format: "texto" },
  { header: "Resultado", format: "texto" },
  { header: "Votos no estado", format: "inteiro" },
  { header: "Municípios com voto", format: "inteiro" },
];

export function buildTrajectoryTable(dataset: CandidateDataset): ReportTable {
  const ordenados = [...dataset.contests].sort(
    (a, b) => a.electionYear - b.electionYear || a.round - b.round,
  );
  return {
    id: "trajetoria",
    title: "Trajetória",
    subtitle:
      "Uma linha por eleição disputada, da mais antiga para a mais recente.",
    columns: COLUNAS_TRAJETORIA,
    rows: ordenados.map((contest) => [
      contest.electionYear,
      contest.officeName,
      contest.round,
      contest.candidatura.partido,
      contest.candidatura.resultado,
      contest.votosNoEstado,
      contest.municipiosComVoto,
    ]),
    notes: [
      "Não existe linha de total: cada eleição é um universo próprio de eleitores, cargo e regras, e somar votos de pleitos diferentes produziria um número que não existe.",
      "Pleitos municipais (prefeita, vereadora) são disputados dentro de uma cidade; os demais, no estado inteiro.",
      "A coluna Cargo reproduz o nome como o TSE publica (masculino genérico), para o número continuar rastreável até a fonte.",
    ],
    source: fonteTse(
      dataset,
      `Votação nominal por município · ${dataset.metadata.anos.join(", ")}`,
    ),
  };
}

function highlightsCarreira(
  overview: CareerOverview,
  trajectory: TrajectoryPoint[],
): ReportHighlight[] {
  const { best, growth } = overview;
  // Prosa de cartão fala dela no feminino, como o resto da vitrine; a coluna
  // "Cargo" da tabela é que mantém o nome cru do TSE, para rastreabilidade.
  const melhorPleito = trajectory.find((ponto) => ponto.id === best?.contestId);
  return [
    {
      label: "Melhor votação da carreira",
      value: best ? formatInteger(best.votos) : "—",
      note: best
        ? `${best.electionYear} · ${melhorPleito ? getOfficeLabel(melhorPleito) : best.officeName}`
        : "sem pleito apurado",
    },
    {
      label: "Crescimento municipal",
      value: growth
        ? `${growth.variacaoPct > 0 ? "+" : ""}${formatDecimal(growth.variacaoPct)}%`
        : "—",
      note: growth
        ? `${getOfficeLabel(growth)}, de ${growth.anoAnterior} para ${growth.anoRecente} (mesmo cargo e turno)`
        : "sem dois pleitos municipais comparáveis (mesmo cargo e turno)",
    },
    {
      label: "Municípios alcançados",
      value: formatInteger(overview.municipiosAlcancados),
      note: "com voto nominal em pelo menos um pleito",
    },
    {
      label: "Campanhas disputadas",
      value: formatInteger(overview.campanhas),
      note: `1º e 2º turno contam como a mesma campanha · ${formatInteger(trajectory.length)} pleitos apurados`,
    },
  ];
}

export function buildTrajectoryReport(input: {
  dataset: CandidateDataset;
  overview: CareerOverview;
  trajectory: TrajectoryPoint[];
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  const { dataset } = input;
  const doc = baseDocument(dataset, {
    filenameBase: `relatorio-trajetoria-${dataset.metadata.slug}`,
    title: "Trajetória eleitoral",
    subtitle: "Visão geral da carreira, eleição a eleição",
    scope: "Todas as campanhas disputadas",
    generatedAt: input.generatedAt,
    images: input.images,
  });
  if (isCandidatePendente(dataset)) {
    return { ...doc, omitted: [omissaoDatasetPendente()] };
  }
  return {
    ...doc,
    highlights: highlightsCarreira(input.overview, input.trajectory),
    tables: [buildTrajectoryTable(dataset)],
  };
}

/* -------------------------------------------------------------------------
 * Visão de um pleito — o relatório COMPLETO do recorte
 *
 * Aqui mora o defeito que motivou este motor, e vale escrever o que ele era
 * para ninguém reintroduzi-lo: o relatório do pleito era montado a partir do
 * `scatter` da TELA — um único cruzamento, o do indicador selecionado no
 * seletor — e do `rankingMetric` da tela. Com o filtro "Mulheres" ativo, o
 * PDF saía com o percentual feminino e nada mais, com aparência de relatório
 * completo. O ranking, pior: a métrica escolhida na interface decidia quais
 * municípios entravam, porque quem não tinha denominador para AQUELA métrica
 * ficava de fora — o universo mudava em silêncio a cada clique.
 *
 * Agora o documento é montado sobre o `reportDataset` inteiro (todos os
 * municípios, todos os indicadores com dado) e o que está selecionado na tela
 * entra só como `activeViewFilter`, que ordena e destaca. Trocar o filtro
 * muda a ORDEM dos capítulos e qual deles ganha as tabelas de detalhe;
 * nenhuma linha de dado entra ou sai.
 * ------------------------------------------------------------------------- */

/** Colunas do quadro municipal: TODAS as métricas, nunca só a da tela. */
const COLUNAS_MUNICIPIOS: ReportColumn[] = [
  { header: "Posição", format: "numero" },
  { header: "Município", format: "texto" },
  { header: "Código IBGE", format: "texto", pdfHidden: true },
  { header: "Votos", format: "inteiro" },
  { header: "% dos válidos", format: "percentual", decimals: 2 },
  { header: "% do partido", format: "percentual", decimals: 2 },
  { header: "Votos por mil eleitores", format: "decimal", decimals: 1 },
  { header: "% dos votos da candidatura", format: "percentual", decimals: 2 },
  { header: "Posição no município", format: "numero" },
  { header: "Eleitorado do município", format: "inteiro", pdfHidden: true },
];

/**
 * O quadro municipal do pleito: uma linha por município com voto apurado.
 *
 * Ordenado por VOTOS ABSOLUTOS, sempre — não pela métrica escolhida na tela.
 * A ordenação por votos é a única que não depende de denominador nenhum, e é
 * por isso que ela não exclui ninguém: todas as demais métricas viram
 * COLUNAS, e o município que não tem denominador para uma delas fica com a
 * célula vazia em vez de sumir do quadro.
 */
export function buildMunicipiosTable(
  dataset: CandidateDataset,
  contest: CandidateContest,
  reportDataset: ReportDataset,
): ReportTable {
  return {
    id: "municipios",
    title: `Municípios ${contest.electionYear}`,
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · todos os municípios com voto apurado, do mais votado ao menos votado`,
    columns: COLUNAS_MUNICIPIOS,
    rows: reportDataset.municipios.map((municipio, indice) => [
      indice + 1,
      municipio.nome,
      municipio.ibgeCode,
      municipio.votos,
      // Célula vazia = denominador não apurado. Escrever 0 aqui inventaria um
      // desempenho que o TSE não publicou — e a planilha somaria a invenção.
      municipio.percentualValidos,
      municipio.percentualDoPartido,
      municipio.votosPorMilEleitores,
      municipio.participacaoNosVotos,
      municipio.posicaoNoMunicipio,
      municipio.eleitorado,
    ]),
    notes: [
      "Todas as métricas do município aparecem como coluna. O quadro é ordenado por votos absolutos porque essa é a única ordem que não depende de denominador: assim nenhum município fica de fora por falta de dado em uma métrica específica.",
      "Célula vazia significa denominador não apurado para aquela métrica — não é zero.",
      "O que estiver selecionado na tela não altera este quadro: ele traz o universo inteiro do recorte.",
    ],
    source: fonteTse(
      dataset,
      `${getContestLabel(contest)} · votação nominal por município`,
    ),
  };
}

/** O resumo executivo como tabela de leitura — no máximo quatro frases. */
export function buildResumoTable(
  dataset: CandidateDataset,
  contest: CandidateContest,
  analysis: ReportAnalysis,
): ReportTable {
  const notes = [...analysis.ressalvas];
  if (analysis.notaExclusoes) notes.unshift(analysis.notaExclusoes);
  return {
    id: "resumo",
    title: "Resumo executivo",
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · números apurados do recorte`,
    columns: [{ header: "Resumo executivo", format: "texto" }],
    rows: analysis.resumo.frases.map((frase) => [frase]),
    notes,
    source: fonteTse(
      dataset,
      `${getContestLabel(contest)} · votação nominal por município`,
    ),
  };
}

/** Um intervalo de confiança em texto; string vazia quando não existe. */
function textoIntervalo(intervalo: CorrelationInterval | null): string {
  if (!intervalo) return "";
  return (
    ` (IC ${Math.round(intervalo.nivel * 100)}%: de ` +
    `${formatAssociationCoefficient(intervalo.inferior)} a ` +
    `${formatAssociationCoefficient(intervalo.superior)})`
  );
}

/** As notas de um capítulo de cruzamento: estatística, critério e ressalva. */
function notasDoIndicador(
  item: IndicatorAnalysis,
  reportDataset: ReportDataset,
): string[] {
  const notas: string[] = [item.interpretacao];
  const { correlacao } = item;

  if (correlacao.amostraInsuficiente) {
    notas.push(
      `Correlação não calculada: ${formatInteger(correlacao.n)} municípios no cruzamento, abaixo do mínimo de ${PEARSON_MIN_N}. Com poucos pontos o coeficiente vira ruído de amostra pequena.`,
    );
  } else {
    const pearsonTexto =
      correlacao.pearson === null
        ? "Pearson indefinido: um dos eixos não varia entre os municípios."
        : `Pearson r = ${formatAssociationCoefficient(correlacao.pearson)}${textoIntervalo(correlacao.pearsonIntervalo)}`;
    const spearmanTexto =
      correlacao.spearman === null
        ? "Spearman indefinido: um dos eixos não varia entre os municípios."
        : `Spearman ρ = ${formatAssociationCoefficient(correlacao.spearman)}${textoIntervalo(correlacao.spearmanIntervalo)}`;
    notas.push(
      `${pearsonTexto} · ${spearmanTexto} · n = ${formatInteger(correlacao.n)} municípios${correlacao.logScale ? " · o eixo do indicador entra em log10, porque a distribuição é muito assimétrica" : ""}.`,
    );
    notas.push(item.classificacao.criterio);
  }

  if (item.grupos) {
    const [acima, abaixo] = item.grupos.grupos;
    const descreve = (grupo: (typeof item.grupos.grupos)[number]) =>
      `${grupo.label}: ${formatInteger(grupo.municipios)} municípios, mediana ${grupo.medianaPctValidos === null ? "—" : formatPercent(grupo.medianaPctValidos)}, média ${grupo.mediaPctValidos === null ? "—" : formatPercent(grupo.mediaPctValidos)}, desvio padrão ${grupo.desvioPadraoPctValidos === null ? "—" : formatDecimal(grupo.desvioPadraoPctValidos)} p.p., amplitude interquartil ${grupo.amplitudeInterquartilPctValidos === null ? "—" : formatDecimal(grupo.amplitudeInterquartilPctValidos)} p.p., eleitorado coberto ${grupo.eleitoradoCoberto === null ? "—" : formatInteger(grupo.eleitoradoCoberto)}`;
    notas.push(`${descreve(acima)}. ${descreve(abaixo)}.`);
    notas.push(
      `${item.grupos.criterio} Diferença entre as medianas dos grupos: ${item.grupos.diferencaMediana === null ? "—" : `${formatDecimal(item.grupos.diferencaMediana)} p.p.`}; entre as médias: ${item.grupos.diferencaMedia === null ? "—" : `${formatDecimal(item.grupos.diferencaMedia)} p.p.`}.`,
    );
  }

  if (item.quadrantes) {
    const contagem = item.quadrantes.quadrantes
      .map((quadrante) => `${quadrante.label} — ${formatInteger(quadrante.municipios)}`)
      .join("; ");
    notas.push(`Grupos por mediana dos dois eixos: ${contagem}.`);
  }

  if (item.atipicos.municipios.length > 0) {
    notas.push(
      `${formatInteger(item.atipicos.municipios.length)} municípios se afastam da tendência do conjunto. ${item.atipicos.criterio}`,
    );
  }

  const foraDoIndicador = correlacao.semPar;
  const foraSemDenominador = reportDataset.exclusoes.length;
  if (foraDoIndicador > 0 || foraSemDenominador > 0) {
    notas.push(
      `Ficaram fora deste cruzamento ${formatInteger(foraDoIndicador)} municípios sem valor do indicador e ${formatInteger(foraSemDenominador)} sem total de válidos apurado. Nenhum deles entra valendo zero.`,
    );
  }

  notas.push(`Denominador: ${item.indicator.denominator} Cálculo: ${item.indicator.method} Faixa esperada: ${item.indicator.expectedRange}`);
  notas.push(...item.ressalvas);
  return notas;
}

/** O capítulo de um indicador: uma linha por município cruzado. */
export function buildIndicatorTable(
  item: IndicatorAnalysis,
  contest: CandidateContest,
  reportDataset: ReportDataset,
): ReportTable {
  const metric = item.indicator.metric;
  const linhas = reportDataset.analiticos.filter(
    (municipio) => municipio.indicadores[item.indicator.id] !== null,
  );
  return {
    id: `cruzamento-${item.indicator.id}`,
    title: `Cruzamento ${metric.shortLabel}`.slice(0, 31),
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · % dos válidos por município × ${metric.label}${item.destaque ? " · indicador em destaque" : ""}`,
    columns: [
      { header: "Município", format: "texto" },
      { header: "Código IBGE", format: "texto", pdfHidden: true },
      { header: "Votos", format: "inteiro" },
      { header: "% dos válidos", format: "percentual", decimals: 2 },
      {
        header: columnHeaderWithUnit(metric.label, metric.unit),
        ...columnFormatFromMetric(metric.valueFormat),
      },
    ],
    rows: linhas.map((municipio) => [
      municipio.nome,
      municipio.ibgeCode,
      municipio.votos,
      municipio.percentualValidos,
      municipio.indicadores[item.indicator.id],
    ]),
    notes: notasDoIndicador(item, reportDataset),
    source: {
      label: metric.sourceLabel,
      detail: `Indicador ${metric.sourceIndicatorId} · ano de referência ${metric.referenceYear}`,
      url: metric.sourceUrl,
    },
  };
}

/**
 * Os quatro grupos formados pelas medianas dos dois eixos, para o indicador
 * em destaque. Os nomes são descritivos do corte — nada de "oportunidade",
 * "ameaça" ou "prioridade": rotular um grupo assim é decidir estratégia de
 * campanha dentro de uma tabela, e essa decisão não é do relatório.
 */
export function buildQuadrantTable(
  item: IndicatorAnalysis,
  contest: CandidateContest,
): ReportTable | null {
  if (!item.quadrantes) return null;
  const metric = item.indicator.metric;
  const rows: ReportCell[][] = [];
  for (const quadrante of item.quadrantes.quadrantes) {
    for (const municipio of quadrante.exemplos) {
      rows.push([
        quadrante.label,
        quadrante.municipios,
        municipio.nome,
        municipio.votos,
        municipio.percentualValidos,
        municipio.valorIndicador,
      ]);
    }
  }
  const vazios = item.quadrantes.quadrantes.filter(
    (quadrante) => quadrante.municipios === 0,
  );
  const notes = [
    item.quadrantes.criterio,
    `Medianas do recorte: ${metric.label} em ${formatDecimal(item.quadrantes.medianaIndicador)} ${metric.unit} e percentual dos válidos em ${formatPercent(item.quadrantes.medianaPercentualValidos)}.`,
    "Os grupos são nomeados pelo corte que os define. A leitura do que fazer com cada grupo é de quem lê o relatório, não dele.",
    ...item.ressalvas,
  ];
  if (vazios.length > 0) {
    notes.push(
      `Sem nenhum município: ${vazios.map((quadrante) => quadrante.label).join("; ")}.`,
    );
  }
  return {
    id: `quadrantes-${item.indicator.id}`,
    title: `Grupos ${metric.shortLabel}`.slice(0, 31),
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · grupos por mediana de ${metric.label} e do % dos válidos`,
    columns: [
      { header: "Grupo", format: "texto" },
      { header: "Municípios no grupo", format: "inteiro" },
      { header: "Município", format: "texto" },
      { header: "Votos", format: "inteiro" },
      { header: "% dos válidos", format: "percentual", decimals: 2 },
      {
        header: columnHeaderWithUnit(metric.label, metric.unit),
        ...columnFormatFromMetric(metric.valueFormat),
      },
    ],
    rows,
    notes,
    source: {
      label: metric.sourceLabel,
      detail: `Indicador ${metric.sourceIndicatorId} · ano de referência ${metric.referenceYear}`,
      url: metric.sourceUrl,
    },
  };
}

/** Municípios que se afastam da tendência do conjunto, para o destaque. */
export function buildOutlierTable(
  item: IndicatorAnalysis,
  contest: CandidateContest,
): ReportTable | null {
  if (item.atipicos.municipios.length === 0) return null;
  const metric = item.indicator.metric;
  return {
    id: `atipicos-${item.indicator.id}`,
    title: `Atípicos ${metric.shortLabel}`.slice(0, 31),
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · municípios distantes da tendência de ${metric.label}`,
    columns: [
      { header: "Município", format: "texto" },
      { header: "Código IBGE", format: "texto", pdfHidden: true },
      {
        header: columnHeaderWithUnit(metric.label, metric.unit),
        ...columnFormatFromMetric(metric.valueFormat),
      },
      { header: "% dos válidos apurado", format: "percentual", decimals: 2 },
      { header: "% descrito pela tendência", format: "percentual", decimals: 2 },
      { header: "Diferença (p.p.)", format: "decimal", decimals: 2 },
      { header: "Resíduo padronizado", format: "decimal", decimals: 2 },
      { header: "Sentido", format: "texto" },
    ],
    rows: item.atipicos.municipios.map((municipio) => [
      municipio.nome,
      municipio.ibgeCode,
      municipio.valorIndicador,
      municipio.percentualValidos,
      municipio.esperado,
      municipio.residuo,
      municipio.residuoPadronizado,
      municipio.sentido,
    ]),
    notes: [
      item.atipicos.criterio,
      "“Atípico” aqui significa apenas distância da tendência do conjunto; não é erro de apuração nem sinal de nada por si só.",
      ...item.ressalvas,
    ],
    source: {
      label: metric.sourceLabel,
      detail: `Indicador ${metric.sourceIndicatorId} · ano de referência ${metric.referenceYear}`,
      url: metric.sourceUrl,
    },
  };
}

/** A curva acumulada dos votos (Pareto), sobre todos os municípios. */
export function buildConcentrationTable(
  dataset: CandidateDataset,
  contest: CandidateContest,
  analysis: ReportAnalysis,
): ReportTable {
  const { concentracao } = analysis;
  const pct = (valor: number | null) =>
    valor === null ? "—" : formatPercent(valor);
  return {
    id: "concentracao",
    title: "Concentração dos votos",
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · curva acumulada por município`,
    columns: [
      { header: "Posição", format: "numero" },
      { header: "Município", format: "texto" },
      { header: "Código IBGE", format: "texto", pdfHidden: true },
      { header: "Votos", format: "inteiro" },
      { header: "% dos votos", format: "percentual", decimals: 2 },
      { header: "% acumulado", format: "percentual", decimals: 2 },
    ],
    rows: concentracao.pontos.map((ponto) => [
      ponto.posicao,
      ponto.nome,
      ponto.ibgeCode,
      ponto.votos,
      ponto.participacaoPct,
      ponto.acumuladoPct,
    ]),
    notes: [
      `Concentração em 5 municípios: ${pct(concentracao.top5Pct)} · em 10: ${pct(concentracao.top10Pct)} · em 20: ${pct(concentracao.top20Pct)}.`,
      concentracao.municipiosParaMetade === null
        ? "Sem votos apurados no recorte, não há curva acumulada."
        : `${formatInteger(concentracao.municipiosParaMetade)} municípios reúnem metade dos votos do pleito.`,
      concentracao.criterio,
      "A curva usa TODOS os municípios com voto apurado, inclusive os que ficaram fora da análise de associação por não terem total de válidos: o voto apurado não depende desse denominador.",
    ],
    source: fonteTse(
      dataset,
      `${getContestLabel(contest)} · votação nominal por município`,
    ),
  };
}

/** Os municípios que ficaram fora da análise, nomeados um a um. */
export function buildExclusionTable(
  dataset: CandidateDataset,
  contest: CandidateContest,
  reportDataset: ReportDataset,
): ReportTable | null {
  if (reportDataset.exclusoes.length === 0) return null;
  return {
    id: "exclusoes",
    title: "Municípios fora da análise",
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · sem denominador para a métrica eleitoral principal`,
    columns: [
      { header: "Município", format: "texto" },
      { header: "Código IBGE", format: "texto", pdfHidden: true },
      { header: "Votos apurados", format: "inteiro" },
      { header: "Por que ficou fora", format: "texto" },
    ],
    rows: reportDataset.exclusoes.map((exclusao) => [
      exclusao.nome,
      exclusao.ibgeCode,
      exclusao.votos,
      exclusao.descricao,
    ]),
    notes: [
      "Estes municípios não entram em nenhuma correlação, comparação de grupos ou quadrante — e não entram valendo zero em lugar nenhum.",
      "Os votos deles continuam contados no total do pleito e na curva de concentração.",
    ],
    source: fonteTse(
      dataset,
      `${getContestLabel(contest)} · votação nominal por município`,
    ),
  };
}

/**
 * O relatório de um pleito.
 *
 * Recebe o `reportDataset` COMPLETO e, separadamente, o que está selecionado
 * na tela (`activeViewFilter`). O filtro entra em duas decisões, as duas de
 * apresentação: a ORDEM dos capítulos de cruzamento e QUAL indicador ganha as
 * tabelas de detalhe (grupos por mediana e municípios atípicos). Todo
 * indicador com dado tem o seu capítulo, com estatística completa, seja qual
 * for o filtro; todo indicador sem dado é declarado na lista de omissões.
 */
export function buildContestReport(input: {
  dataset: CandidateDataset;
  contest: CandidateContest;
  /** O universo completo, montado por `buildReportDataset`. */
  reportDataset: ReportDataset;
  /** O que está selecionado na tela. Só ordena e destaca. */
  activeViewFilter?: ReportViewFilter | null;
  generatedAt: Date;
  images?: ReportImage[];
  /**
   * Qual versão o PDF vai imprimir. Padrão: a completa — quem não escolhe
   * recebe o documento inteiro, nunca o recorte.
   *
   * A variante muda SÓ a projeção de leitura (`sections`) e o nome do
   * arquivo. As tabelas do Excel (`doc.tables`), as omissões e os cartões são
   * os mesmos nas duas: a pasta de trabalho não tem versão resumida.
   */
  variante?: ReportVariant;
}): ReportDocument {
  const { dataset, contest, reportDataset } = input;
  const variante: ReportVariant = input.variante ?? "completo";
  const analysis = buildReportAnalysis({
    dataset: reportDataset,
    activeViewFilter: input.activeViewFilter ?? null,
  });
  const escopo = getMunicipalScope(contest);
  // Título, escopo e nome do arquivo falam da candidata no feminino, como o
  // resto da vitrine ("Deputada Federal"); as CÉLULAS das tabelas mantêm o
  // nome do cargo como o TSE publica, para o dado continuar rastreável.
  const cargoLabel = getOfficeLabel(contest);
  // O título é SEMPRE geral. O que estava selecionado na tela não pode
  // rebatizar o documento: um PDF chamado "Relatório de mulheres" porque o
  // filtro estava em Mulheres seria a mesma falha do relatório parcial, agora
  // na capa — o arquivo traz todos os cruzamentos, e o nome diz isso.
  const doc = baseDocument(dataset, {
    // O nome do arquivo distingue as versões: as duas circulam por e-mail e
    // grupo de mensagem no mesmo dia, e duas anexos com o mesmo nome viram
    // "relatorio (1).pdf" na pasta de quem recebe.
    filenameBase:
      variante === "resumido"
        ? `relatorio-resumido-${contest.electionYear}-${slugifyReport(cargoLabel)}`
        : `relatorio-${contest.electionYear}-${slugifyReport(cargoLabel)}`,
    title: `Desempenho eleitoral — ${contest.electionYear} · ${cargoLabel}`,
    subtitle: `${contest.candidatura.nomeUrna} · ${contest.candidatura.partido} ${contest.candidatura.numero}`,
    scope: escopo
      ? `${contest.electionYear} · ${cargoLabel} · ${escopo.nome}`
      : `${contest.electionYear} · ${cargoLabel} · ${ESTADO.nome}`,
    generatedAt: input.generatedAt,
    images: input.images,
  });

  const tables: ReportTable[] = [
    buildResumoTable(dataset, contest, analysis),
  ];
  const omitted: ReportOmission[] = [];
  /** O quadro municipal completo: vai para o Excel e para o anexo opcional. */
  let quadroMunicipal: ReportTable | null = null;

  // Quadro de municípios num pleito de uma cidade só seria uma tabela de UMA
  // linha repetindo o cartão do resumo. A omissão é declarada com o motivo.
  if (escopo) {
    omitted.push({
      title: "Quadro de municípios",
      reason: `A disputa aconteceu inteira dentro de ${escopo.nome}: um quadro de municípios teria uma linha só. O recorte que informa aqui é o de bairros, na visão Geral.`,
    });
    omitted.push({
      title: "Concentração dos votos",
      reason: `Com um município só, a curva acumulada de ${escopo.nome} chegaria a 100% na primeira linha e não descreveria nada.`,
    });
  } else {
    quadroMunicipal = buildMunicipiosTable(dataset, contest, reportDataset);
    tables.push(quadroMunicipal);
    tables.push(buildConcentrationTable(dataset, contest, analysis));
  }

  const exclusoes = buildExclusionTable(dataset, contest, reportDataset);
  if (exclusoes) tables.push(exclusoes);

  // Correlação entre municípios só faz sentido com dispersão territorial: em
  // pleito municipal existe UM município, e não há o que comparar.
  if (reportDataset.municipal) {
    omitted.push({
      title: "Cruzamento com indicadores municipais",
      reason:
        "Esta disputa aconteceu em uma cidade só: não existe comparação entre municípios para este pleito.",
    });
  } else {
    for (const item of analysis.indicadores) {
      tables.push(buildIndicatorTable(item, contest, reportDataset));
      // As tabelas de detalhe acompanham o indicador em DESTAQUE. É a única
      // coisa que o filtro da tela decide, e é decisão de apresentação: a
      // estatística dos quadrantes e dos atípicos de todos os indicadores
      // continua nas notas e no modelo de análise, disponível para quem
      // renderiza.
      if (!item.destaque) continue;
      const quadrantes = buildQuadrantTable(item, contest);
      if (quadrantes) tables.push(quadrantes);
      const atipicos = buildOutlierTable(item, contest);
      if (atipicos) tables.push(atipicos);
    }
    omitted.push(...analysis.omissoes);
  }

  const fonteEleitoral = fonteTse(
    dataset,
    `${getContestLabel(contest)} · votação nominal por município`,
  );
  const narrativa = { contest, reportDataset, analysis, generatedAt: input.generatedAt, fonteEleitoral };
  // A marca da versão vai para a CAPA, com a contagem que a distingue: a
  // resumida nunca pode ser confundida com a completa em cima de uma mesa.
  const comCapitulo =
    variante === "resumido"
      ? selecionarIndicadoresResumidos(analysis.indicadores).length
      : analysis.indicadores.length;
  const versionBadge =
    variante === "resumido"
      ? `Versão resumida · ${formatInteger(comCapitulo)} de ${formatInteger(analysis.indicadores.length)} indicadores com capítulo`
      : `Versão completa · ${formatInteger(comCapitulo)} indicadores com capítulo`;

  return {
    ...doc,
    variant: variante,
    versionBadge,
    highlights: buildContestCards(contest).map((card) => ({
      label: card.titulo,
      value: card.valor,
      note: card.nota,
    })),
    tables,
    omitted,
    // A projeção do PDF: as mesmas contas, organizadas como documento de
    // leitura. `doc.tables` continua sendo a projeção da planilha, e é dela
    // que o exceljs monta as abas — a planilha não tem versão resumida.
    sections:
      variante === "resumido"
        ? buildContestSummarySections(narrativa)
        : buildContestSections(narrativa),
    ...(quadroMunicipal ? { annexTable: quadroMunicipal } : {}),
  };
}

/* -------------------------------------------------------------------------
 * Visão "Geral" — crescimento entre eleições
 * ------------------------------------------------------------------------- */

const COLUNAS_CRESCIMENTO: ReportColumn[] = [
  { header: "Recorte", format: "texto" },
  { header: "Ano", format: "numero" },
  { header: "Cargo", format: "texto" },
  { header: "Turno", format: "numero" },
  { header: "Votos", format: "inteiro" },
  {
    header: "Variação % desde o pleito anterior",
    format: "percentual",
    decimals: 1,
  },
  { header: "Comparável", format: "texto" },
];

export function buildGrowthTable(
  model: GrowthModel,
  dataset: CandidateDataset,
): ReportTable {
  const rows = [];
  for (const serie of model.series) {
    const setaPorDestino = new Map(
      serie.arrows.map((seta) => [seta.paraContestId, seta]),
    );
    for (const ponto of serie.points) {
      const seta = setaPorDestino.get(ponto.contestId);
      // Célula VAZIA quando não houve apuração para o recorte naquele pleito.
      // Escrever 0 transformaria "o bairro não aparece neste pleito" em "o
      // bairro deu zero voto" — e a planilha somaria essa mentira sem avisar.
      rows.push([
        serie.label,
        ponto.electionYear,
        ponto.officeName,
        ponto.round,
        ponto.votos,
        seta?.variacaoPct ?? null,
        seta?.variacaoPct != null
          ? seta.comparavel
            ? "sim"
            : "cargos diferentes"
          : null,
      ]);
    }
  }
  return {
    id: "crescimento",
    title: "Crescimento",
    subtitle: `${model.breakdownLabel} · ${model.series.length} séries comparadas`,
    columns: COLUNAS_CRESCIMENTO,
    rows,
    notes: [
      "Célula de votos vazia significa recorte sem apuração naquele pleito — não é zero voto.",
      "A coluna Cargo reproduz o nome como o TSE publica (masculino genérico), para o número continuar rastreável até a fonte.",
      model.temCargosDiferentes
        ? "As séries deste grupo atravessam cargos diferentes: a variação marcada como “cargos diferentes” compara disputas de natureza distinta e não mede a mesma corrida duas vezes."
        : "Todos os pleitos deste grupo são do mesmo cargo e turno.",
    ],
    source: fonteTse(
      dataset,
      `Votação nominal por ${model.breakdownLabel.toLowerCase()} · ${dataset.metadata.anos.join(", ")}`,
    ),
  };
}

function highlightsCrescimento(model: GrowthModel): ReportHighlight[] {
  const total = model.series[0];
  const comVoto = total.points.filter((ponto) => ponto.votos !== null);
  return [
    {
      label: "Variação total da série principal",
      value:
        total.variacaoTotalPct === null
          ? "—"
          : `${total.variacaoTotalPct > 0 ? "+" : ""}${formatDecimal(total.variacaoTotalPct)}%`,
      note: total.variacaoTotalComparavel
        ? `${total.label}, do primeiro ao último pleito com voto (mesmo cargo e turno)`
        : `${total.label}, do primeiro ao último pleito com voto — pontas de cargos ou turnos diferentes`,
    },
    {
      label: "Pleitos comparados",
      value: formatInteger(model.pleitos.length),
      note: `${formatInteger(comVoto.length)} com voto apurado na série principal`,
    },
    {
      label: "Recortes na comparação",
      value: formatInteger(Math.max(0, model.series.length - 1)),
      note: `${model.breakdownLabel.toLowerCase()} escolhidos na tela, além da série principal`,
    },
  ];
}

export function buildGrowthReport(input: {
  dataset: CandidateDataset;
  grupo: GrowthGroupId;
  model: GrowthModel;
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  const { dataset, model } = input;
  const sufixo =
    input.grupo === "municipais" ? "municipais" : "federais-estaduais";
  const escopoLegivel =
    input.grupo === "municipais"
      ? "Eleições municipais"
      : "Eleições federais e estaduais";
  const doc = baseDocument(dataset, {
    filenameBase: `relatorio-crescimento-${dataset.metadata.slug}-${sufixo}`,
    title: "Crescimento entre eleições",
    subtitle: escopoLegivel,
    scope: `${escopoLegivel} · ${model.breakdownLabel}`,
    generatedAt: input.generatedAt,
    images: input.images,
  });
  return {
    ...doc,
    highlights: highlightsCrescimento(model),
    tables: [buildGrowthTable(model, dataset)],
  };
}
