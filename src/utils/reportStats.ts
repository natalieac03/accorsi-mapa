import type {
  CandidateContest,
  CandidateDataset,
  CandidateRankingMetricId,
  CandidateRankingRow,
  GrowthGroupId,
  GrowthModel,
  ScatterModel,
  TrajectoryPoint,
} from "../types/candidate";
import type { CareerOverview } from "../types/candidate";
import { ESTADO } from "../config/estado.ts";
import { getAnalysisMetric } from "./analysis.ts";
import {
  getCandidateRankingMetric,
  getContestLabel,
  getOfficeLabel,
  isCandidatePendente,
} from "./candidate.ts";
import {
  buildContestCards,
  getMunicipalScope,
  isMunicipalContest,
  PEARSON_MIN_N,
} from "./candidateStats.ts";
import { formatDecimal, formatInteger } from "./electorate.ts";
import {
  columnFormatFromMetric,
  columnHeaderWithUnit,
  createReportDocument,
  slugifyReport,
  type ReportColumn,
  type ReportDocument,
  type ReportHighlight,
  type ReportImage,
  type ReportOmission,
  type ReportSource,
  type ReportTable,
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
 * Visão de um pleito — ranking e cruzamento
 * ------------------------------------------------------------------------- */

/**
 * Coluna do valor da métrica escolhida no ranking.
 *
 * Devolve `null` para "votos absolutos": ali a métrica JÁ É a coluna de votos,
 * e repeti-la produziria duas colunas "Votos" idênticas lado a lado — o tipo
 * de detalhe que faz um relatório parecer gerado por script.
 */
function colunaMetricaRanking(
  metricId: CandidateRankingMetricId,
): ReportColumn | null {
  if (metricId === "votos") return null;
  const metric = getCandidateRankingMetric(metricId);
  if (metricId === "votosPorMilEleitores") {
    return { header: metric.csvHeader, format: "decimal", decimals: 1 };
  }
  return { header: metric.csvHeader, format: "percentual", decimals: 2 };
}

export function buildRankingTable(
  dataset: CandidateDataset,
  contest: CandidateContest,
  metricId: CandidateRankingMetricId,
  rows: CandidateRankingRow[],
): ReportTable {
  const metric = getCandidateRankingMetric(metricId);
  const colunaMetrica = colunaMetricaRanking(metricId);
  return {
    id: "ranking",
    title: `Municípios ${contest.electionYear}`,
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · ordenado por ${metric.label.toLowerCase()}`,
    columns: [
      { header: "Posição", format: "numero" },
      { header: "Município", format: "texto" },
      { header: "Código IBGE", format: "texto", pdfHidden: true },
      { header: "Votos", format: "inteiro" },
      ...(colunaMetrica ? [colunaMetrica] : []),
      { header: "Posição no município", format: "numero" },
      { header: "Eleitorado do município", format: "inteiro" },
    ],
    rows: rows.map((row, indice) => [
      indice + 1,
      row.nome,
      row.ibgeCode,
      row.votos,
      ...(colunaMetrica ? [row.value] : []),
      // Célula vazia = não apurado. A posição dela na cidade e o eleitorado
      // podem faltar sem que os votos faltem; escrever 0 aqui inventaria uma
      // colocação e um denominador que o TSE não publicou.
      row.posicaoNoMunicipio,
      row.eleitorado,
    ]),
    notes: [
      metric.description,
      "Municípios sem denominador apurado para a métrica escolhida ficam fora do ranking — não entram com valor zero.",
    ],
    source: fonteTse(
      dataset,
      `${getContestLabel(contest)} · votação nominal por município`,
    ),
  };
}

export function buildScatterTable(
  contest: CandidateContest,
  model: ScatterModel,
): ReportTable {
  const metric = getAnalysisMetric(model.indicator.id);
  const excluidos = model.semIndicador + model.semPercentual;
  const notes = [
    `Cada linha é um município de Goiás com % dos válidos e ${model.indicator.label.toLowerCase()} apurados no mesmo recorte.`,
  ];
  if (excluidos > 0) {
    notes.push(
      `${formatInteger(excluidos)} municípios ficaram fora por falta de dado: ${formatInteger(model.semIndicador)} sem o indicador e ${formatInteger(model.semPercentual)} sem % dos válidos. Eles não aparecem com zero.`,
    );
  }
  notes.push(
    model.amostraInsuficiente
      ? `Correlação não calculada: ${formatInteger(model.points.length)} municípios no cruzamento (mínimo ${PEARSON_MIN_N}). Com poucos pontos o coeficiente vira ruído.`
      : model.pearson === null
        ? "Correlação indefinida: um dos eixos não varia entre as cidades."
        : `Correlação de Pearson r = ${model.pearson.toFixed(2).replace(".", ",")}${model.indicator.logScale ? " (sobre o log10 do indicador)" : ""}.`,
  );
  notes.push(
    "Leitura: o cruzamento compara CIDADES, não eleitores. Se cidades com mais mulheres votaram mais nela, isso não prova que as mulheres votaram mais nela — e relação não é causa.",
  );
  return {
    id: "cruzamento",
    title: `Cruzamento ${model.indicator.shortLabel}`.slice(0, 31),
    subtitle: `${contest.electionYear} · ${getOfficeLabel(contest)} · % dos válidos por município × ${model.indicator.label}`,
    columns: [
      { header: "Município", format: "texto" },
      { header: "Código IBGE", format: "texto", pdfHidden: true },
      { header: "Votos", format: "inteiro" },
      { header: "% dos válidos", format: "percentual", decimals: 2 },
      {
        header: columnHeaderWithUnit(model.indicator.label, model.indicator.unit),
        ...columnFormatFromMetric(metric.valueFormat),
      },
    ],
    rows: model.points.map((point) => [
      point.nome,
      point.ibgeCode,
      point.votos,
      point.y,
      point.indicadorValor,
    ]),
    notes,
    source: {
      label: metric.sourceLabel,
      detail: `Indicador ${metric.sourceIndicatorId} · ano de referência ${metric.referenceYear}`,
      url: metric.sourceUrl,
    },
  };
}

export function buildContestReport(input: {
  dataset: CandidateDataset;
  contest: CandidateContest;
  ranking: CandidateRankingRow[];
  rankingMetric: CandidateRankingMetricId;
  scatter: ScatterModel | null;
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  const { dataset, contest, scatter } = input;
  const escopo = getMunicipalScope(contest);
  // Título, escopo e nome do arquivo falam da candidata no feminino, como o
  // resto da vitrine ("Deputada Federal"); as CÉLULAS das tabelas mantêm o
  // nome do cargo como o TSE publica, para o dado continuar rastreável.
  const cargoLabel = getOfficeLabel(contest);
  const doc = baseDocument(dataset, {
    filenameBase: `relatorio-${contest.electionYear}-${slugifyReport(cargoLabel)}`,
    title: `Eleição ${contest.electionYear} · ${cargoLabel}`,
    subtitle: `${contest.candidatura.nomeUrna} · ${contest.candidatura.partido} ${contest.candidatura.numero}`,
    scope: escopo
      ? `${contest.electionYear} · ${cargoLabel} · ${escopo.nome}`
      : `${contest.electionYear} · ${cargoLabel} · ${ESTADO.nome}`,
    generatedAt: input.generatedAt,
    images: input.images,
  });

  const tables: ReportTable[] = [];
  const omitted: ReportOmission[] = [];

  // Ranking de municípios num pleito de uma cidade só seria uma tabela de UMA
  // linha repetindo o cartão do resumo. A omissão é declarada com o motivo.
  if (escopo) {
    omitted.push({
      title: "Ranking de municípios",
      reason: `A disputa aconteceu inteira dentro de ${escopo.nome}: um ranking de municípios teria uma linha só. O recorte que informa aqui é o de bairros, na visão Geral.`,
    });
  } else if (input.ranking.length === 0) {
    omitted.push({
      title: "Ranking de municípios",
      reason:
        "Nenhum município tem denominador apurado para a métrica escolhida neste pleito.",
    });
  } else {
    tables.push(
      buildRankingTable(dataset, contest, input.rankingMetric, input.ranking),
    );
  }

  // Correlação entre municípios só faz sentido com cobertura estadual e com
  // amostra: em pleito municipal existe UM município, e não há dispersão.
  if (isMunicipalContest(contest)) {
    omitted.push({
      title: "Cruzamento com indicadores municipais",
      reason:
        "Esta disputa aconteceu em uma cidade só: não existe comparação entre municípios para este pleito.",
    });
  } else if (!scatter || scatter.points.length === 0) {
    omitted.push({
      title: "Cruzamento com indicadores municipais",
      reason:
        "Nenhum município tem, ao mesmo tempo, % dos válidos apurado e o indicador escolhido.",
    });
  } else {
    tables.push(buildScatterTable(contest, scatter));
  }

  return {
    ...doc,
    highlights: buildContestCards(contest).map((card) => ({
      label: card.titulo,
      value: card.valor,
      note: card.nota,
    })),
    tables,
    omitted,
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
