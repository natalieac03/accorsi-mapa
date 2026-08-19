import type { CandidateContest } from "../types/candidate";
import { ESTADO } from "../config/estado.ts";
import { getOfficeLabel } from "./candidate.ts";
import { pctValidosNoEstado, PEARSON_MIN_N } from "./candidateStats.ts";
import { formatDecimal, formatInteger, formatPercent } from "./electorate.ts";
import {
  formatAssociationCoefficient,
  mediana,
  type IndicatorAnalysis,
  type ReportAnalysis,
} from "./reportAnalysis.ts";
import type { ReportDataset, ReportMunicipio } from "./reportDataset.ts";
import type { IndicatorMetadata } from "./reportIndicators.ts";
import {
  columnFormatFromMetric,
  columnHeaderWithUnit,
  formatGeneratedAt,
  REPORT_MISSING_TEXT,
  type ReportBarItem,
  type ReportBlock,
  type ReportBoxSeries,
  type ReportChart,
  type ReportPanel,
  type ReportScatterPoint,
  type ReportSection,
  type ReportSource,
  type ReportTable,
} from "./reportModel.ts";

/**
 * O RELATÓRIO ANALÍTICO em seções: a projeção que o PDF imprime (`doc.tables`
 * continua sendo a projeção da planilha).
 *
 * Três regras:
 * 1. NADA É RECALCULADO. Coeficiente, classificação, mediana de grupo,
 *    quadrante, atípico e resumo vêm prontos de `reportAnalysis`; gráfico que
 *    precisa dos pontos usa o `corte` publicado pelo motor, nunca um critério
 *    novo;
 * 2. O FILTRO DA TELA NÃO LIMITA NADA: chega resolvido em
 *    `analysis.indicadores` como ORDEM e `destaque`. Todo indicador com dado
 *    ganha seção e o título do documento é sempre geral;
 * 3. AUSÊNCIA É AUSÊNCIA. Município sem valor não vira ponto, barra nem zero:
 *    é contado, marcado como sem-dado e declarado por escrito.
 */

/**
 * Teto de linhas de um ranking impresso: dez cabem numa página com título e
 * notas. A lista completa fica na pasta em Excel e no CSV.
 */
export const MAX_LINHAS_RANKING = 10;

/** Painéis por gráfico de pequenos múltiplos: acima disso a célula fica ilegível. */
const MAX_PAINEIS = 6;

/** Municípios rotulados dentro de um gráfico de dispersão. */
const MAX_ROTULOS_NO_GRAFICO = 3;

const CONVENCOES = [
  "Travessão (—) significa dado não apurado. Zero significa zero apurado — os dois nunca se confundem neste documento.",
  "Município sem denominador não entra na análise valendo zero: fica fora, contado e declarado.",
  "Dado municipal não identifica quem votou: descreve a cidade, não a pessoa.",
  "Associação territorial não é causalidade: o relatório mostra o que aparece junto no território; a explicação para isso não está neste dado.",
  "A lista completa de municípios está na pasta de trabalho em Excel e no CSV; o PDF traz os recortes de leitura.",
];

/* -------------------------------------------------------------------------
 * Formatação de apoio
 * ------------------------------------------------------------------------- */

function pct(valor: number | null | undefined) {
  return valor === null || valor === undefined || !Number.isFinite(valor)
    ? REPORT_MISSING_TEXT
    : formatPercent(valor);
}

function inteiro(valor: number | null | undefined) {
  return valor === null || valor === undefined || !Number.isFinite(valor)
    ? REPORT_MISSING_TEXT
    : formatInteger(valor);
}

function contarMunicipios(quantidade: number) {
  return `${formatInteger(quantidade)} ${quantidade === 1 ? "município" : "municípios"}`;
}

/** O valor de um indicador formatado com a unidade que o catálogo declara. */
function valorComUnidade(valor: number, indicator: IndicatorMetadata) {
  const formato = columnFormatFromMetric(indicator.metric.valueFormat);
  const casas = formato.decimals ?? 0;
  const numero = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(valor);
  return indicator.metric.unit.trim().startsWith("%")
    ? `${numero}%`
    : `${numero} ${indicator.metric.unit}`.trim();
}

/**
 * As fontes distintas dos indicadores, com a eleitoral na frente. A chave é o
 * ENDEREÇO: o Censo 2022 publica vários indicadores na mesma tabela.
 */
function fontesUnicas(
  fonteEleitoral: ReportSource,
  indicadores: readonly IndicatorMetadata[],
): Array<{ label: string; url: string }> {
  const todas = [
    { label: fonteEleitoral.label, url: fonteEleitoral.url ?? "" },
    ...indicadores.map((indicator) => ({
      label: indicator.metric.sourceLabel,
      url: indicator.metric.sourceUrl,
    })),
  ].filter((item) => item.url !== "");
  const vistos = new Set<string>();
  return todas.filter((item) => {
    const chave = `${item.label}|${item.url}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function fonteDoIndicador(indicator: IndicatorMetadata): ReportSource {
  return {
    label: indicator.metric.sourceLabel,
    detail: `${indicator.metric.sourceIndicatorId} · ano de referência ${indicator.metric.referenceYear}`,
    url: indicator.metric.sourceUrl,
  };
}

/* -------------------------------------------------------------------------
 * Capa e resumo executivo
 * ------------------------------------------------------------------------- */

function cartoesDoPleito(
  contest: CandidateContest,
  reportDataset: ReportDataset,
  analysis: ReportAnalysis,
) {
  const { concentracao } = analysis;
  const melhor = [...reportDataset.analiticos].sort(
    (a, b) =>
      (b.percentualValidos as number) - (a.percentualValidos as number) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  )[0];
  const pctEstado = pctValidosNoEstado(contest);
  const primeiroCorte = Math.min(5, concentracao.municipios);

  return [
    {
      label: "Votos no estado",
      value: inteiro(reportDataset.votosNoPleito),
      note: `votos nominais apurados em ${ESTADO.nome}`,
    },
    {
      label: "% dos votos válidos",
      value: pct(pctEstado),
      note: "sobre os válidos dos municípios com apuração",
    },
    {
      label: "Posição no pleito",
      value:
        contest.posicaoNoEstado !== null
          ? `${contest.posicaoNoEstado}º`
          : REPORT_MISSING_TEXT,
      note: `de ${formatInteger(contest.candidaturasNoPleito)} candidaturas do cargo`,
    },
    {
      label: "Municípios com voto",
      value: inteiro(reportDataset.municipios.length),
      note: `${formatInteger(reportDataset.analiticos.length)} com percentual dos válidos apurado`,
    },
    {
      label: `Concentração nos ${primeiroCorte} maiores`,
      value: pct(concentracao.top5Pct),
      note: `em 10 municípios ${pct(concentracao.top10Pct)} · em 20 ${pct(concentracao.top20Pct)}`,
    },
    {
      label: "Melhor desempenho relativo",
      value: melhor ? pct(melhor.percentualValidos) : REPORT_MISSING_TEXT,
      note: melhor
        ? `${melhor.nome} · ${formatInteger(melhor.votos)} votos`
        : "nenhum município com denominador apurado",
    },
  ];
}

function secaoCapa(input: {
  contest: CandidateContest;
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  generatedAt: Date;
  fonteEleitoral: ReportSource;
  /** Aviso de escopo da versão. Entra ANTES de qualquer número. */
  avisoDeVersao?: { title: string; text: string };
}): ReportSection {
  const { contest, reportDataset, analysis } = input;
  const candidatura = reportDataset.candidatura;
  const blocks: ReportBlock[] = [
    ...(input.avisoDeVersao
      ? [
          {
            kind: "aviso" as const,
            title: input.avisoDeVersao.title,
            text: input.avisoDeVersao.text,
          },
        ]
      : []),
    {
      kind: "campos",
      colunas: 3,
      items: [
        { label: "Nome completo", value: candidatura.nomeCompleto },
        { label: "Nome de urna", value: candidatura.nomeUrna },
        { label: "Número", value: candidatura.numero },
        { label: "Partido", value: candidatura.partido },
        { label: "Cargo", value: getOfficeLabel(contest) },
        { label: "Ano da eleição", value: String(reportDataset.electionYear) },
        { label: "Turno", value: `${reportDataset.round}º` },
        { label: "Unidade da federação", value: `${ESTADO.nome} (${ESTADO.uf})` },
        { label: "Resultado", value: candidatura.resultado },
        {
          label: "Municípios analisados",
          value: `${formatInteger(reportDataset.analiticos.length)} de ${formatInteger(reportDataset.municipios.length)}`,
        },
        {
          label: "Indicadores analisados",
          value: `${formatInteger(analysis.indicadores.length)} de ${formatInteger(reportDataset.indicadores.length)}`,
        },
        { label: "Gerado em", value: formatGeneratedAt(input.generatedAt) },
      ],
    },
    { kind: "subtitulo", text: "Números do pleito" },
    {
      kind: "cartoes",
      colunas: 3,
      items: cartoesDoPleito(contest, reportDataset, analysis),
    },
    { kind: "subtitulo", text: "Resumo da análise" },
    { kind: "lista", items: analysis.resumo.frases },
  ];

  if (analysis.notaExclusoes) {
    blocks.push({
      kind: "aviso",
      title: "Municípios fora da análise",
      text: analysis.notaExclusoes,
    });
  }

  // Uma linha por FONTE, não por indicador.
  const unicas = fontesUnicas(input.fonteEleitoral, analysis.indicadores.map((item) => item.indicator));
  if (unicas.length > 0) {
    blocks.push({
      kind: "paragrafo",
      tone: "suave",
      // Aqui a lista é de NOMES, então a chave é o nome: o Censo publica duas
      // tabelas e o mesmo rótulo sairia repetido. Os endereços continuam
      // distintos na metodologia.
      text: `Fontes deste relatório: ${[...new Set(unicas.map((item) => item.label))].join(" · ")}. Os endereços completos, clicáveis, estão na página de metodologia.`,
    });
  }

  return {
    id: "capa",
    title: "Identificação do pleito",
    blocks,
  };
}

/* -------------------------------------------------------------------------
 * Distribuição territorial: as quatro leituras
 * ------------------------------------------------------------------------- */

/**
 * As quatro leituras do território não se substituem: volume é voto absoluto,
 * desempenho relativo é percentual dos válidos, importância para a campanha é
 * a fatia do próprio total e competitividade é a colocação naquela cidade.
 * "Forte" nunca significa "muito voto" neste relatório.
 */
function secaoTerritorio(input: {
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  fonteEleitoral: ReportSource;
}): ReportSection {
  const { reportDataset } = input;
  const municipios = reportDataset.municipios;
  const votos = municipios.map((municipio) => municipio.votos);
  const percentuais = municipios
    .map((municipio) => municipio.percentualValidos)
    .filter((valor): valor is number => valor !== null);
  const participacoes = municipios
    .map((municipio) => municipio.participacaoNosVotos)
    .filter((valor): valor is number => valor !== null);
  const posicoes = municipios
    .map((municipio) => municipio.posicaoNoMunicipio)
    .filter((valor): valor is number => valor !== null);

  /**
   * Escala log só quando o dado pede: todos os valores positivos (log de zero
   * não existe) e razão de pelo menos 50 entre o maior e o menor.
   */
  const pedeLog = (valores: readonly number[]) => {
    const positivos = valores.filter((valor) => valor > 0);
    if (positivos.length !== valores.length || positivos.length === 0) return false;
    return Math.max(...positivos) / Math.min(...positivos) >= 50;
  };
  const escalaVotos = pedeLog(votos) ? ("log10" as const) : ("linear" as const);
  const escalaParticipacao = pedeLog(participacoes)
    ? ("log10" as const)
    : ("linear" as const);
  const paineis: ReportPanel[] = [
    {
      title: "Volume",
      subtitle: "votos apurados no município",
      semDado: 0,
      note: `Mediana de ${inteiro(mediana(votos))} votos por município. Volume é tamanho da votação, não desempenho.`,
      spec: {
        kind: "tira",
        values: votos,
        axis: {
          label: "Votos apurados",
          unit: "votos",
          scale: escalaVotos,
          decimals: 0,
        },
      },
    },
    {
      title: "Desempenho relativo",
      subtitle: "% dos votos válidos do município",
      semDado: municipios.length - percentuais.length,
      note: `Mediana de ${pct(mediana(percentuais))} dos válidos. É a métrica eleitoral principal do relatório.`,
      spec: {
        kind: "tira",
        values: percentuais,
        axis: { label: "% dos válidos", unit: "%", decimals: 1 },
      },
    },
    {
      title: "Importância para a campanha",
      subtitle: "% dos votos da candidatura que vieram do município",
      semDado: municipios.length - participacoes.length,
      note: `Mediana de ${pct(mediana(participacoes))} do total da candidatura. Soma 100% entre todos os municípios.`,
      spec: {
        kind: "tira",
        values: participacoes,
        axis: {
          label: "% dos votos da candidatura",
          unit: "% do total",
          scale: escalaParticipacao,
          decimals: 2,
        },
      },
    },
    {
      title: "Competitividade",
      subtitle: "colocação da candidatura naquele município",
      semDado: municipios.length - posicoes.length,
      note: `Mediana de ${inteiro(mediana(posicoes))}ª colocação. Quanto mais à esquerda, melhor a posição.`,
      spec: {
        kind: "tira",
        values: posicoes,
        axis: {
          label: "Posição no município",
          unit: "colocação",
          decimals: 0,
          inverted: false,
        },
      },
    },
  ];

  const grafico: ReportChart = {
    id: "territorio-quatro-leituras",
    title: "Quatro leituras do mesmo território",
    subtitle: `${reportDataset.electionYear} · ${contarMunicipios(municipios.length)} com voto apurado · cada painel tem escala e unidade próprias`,
    legend: [
      {
        label: "metade central dos municípios, com a mediana no traço claro",
        kind: "caixaMediana",
        step: 0,
      },
      { label: "um ponto por município", kind: "ponto", step: 2 },
      { label: "sem dado (não entra no painel)", kind: "barra", cinza: true },
    ],
    description:
      "Cada painel mostra a distribuição de uma leitura diferente entre os municípios: a caixa marca a metade central, o traço branco é a mediana e cada ponto é um município. " +
      "As quatro leituras não se substituem — um município pode estar no alto do volume e no meio do desempenho relativo, e chamá-lo de forte apenas pelo voto absoluto trocaria uma leitura pela outra.",
    semDado: {
      count: municipios.length - percentuais.length,
      label: "municípios sem total de votos válidos apurado",
    },
    source: input.fonteEleitoral,
    spec: { kind: "multiplos", panels: paineis, colunas: 2 },
  };

  const cincoMaiores = municipios.slice(0, 5);
  const tabela: ReportTable = {
    id: "territorio-cinco-maiores",
    title: "Os cinco maiores em votos, lidos pelas quatro leituras",
    subtitle:
      "O mesmo município ocupa posições diferentes conforme a leitura — volume não é desempenho.",
    columns: [
      { header: "Município", format: "texto" },
      { header: "Votos", format: "inteiro" },
      { header: "% dos válidos", format: "percentual", decimals: 2 },
      { header: "% dos votos da candidatura", format: "percentual", decimals: 2 },
      { header: "Posição no município", format: "numero" },
    ],
    rows: cincoMaiores.map((municipio) => [
      municipio.nome,
      municipio.votos,
      municipio.percentualValidos,
      municipio.participacaoNosVotos,
      municipio.posicaoNoMunicipio,
    ]),
    notes: [
      "Ordenado por votos absolutos, que é a única ordem que não depende de denominador.",
      "Célula com travessão significa denominador não apurado no município.",
    ],
    source: input.fonteEleitoral,
  };

  return {
    id: "territorio",
    title: "Distribuição territorial",
    subtitle:
      "Volume, desempenho relativo, importância para a campanha e competitividade — quatro perguntas diferentes sobre o mesmo mapa.",
    startsNewPage: true,
    blocks: [
      {
        kind: "lista",
        items: [
          "Volume: quantos votos saíram do município. Depende do tamanho da cidade e não diz nada, sozinho, sobre desempenho.",
          "Desempenho relativo: que fatia dos votos válidos do município foi para a candidatura. É a métrica que os cruzamentos usam.",
          "Importância para a campanha: quanto daquele município pesa no total apurado da candidatura.",
          "Competitividade: em que colocação a candidatura terminou naquela cidade, entre as candidaturas com voto.",
        ],
      },
      { kind: "grafico", chart: grafico },
      { kind: "tabela", table: tabela },
    ],
  };
}

/* -------------------------------------------------------------------------
 * Concentração e rankings
 * ------------------------------------------------------------------------- */

function tabelaRanking(input: {
  id: string;
  title: string;
  subtitle: string;
  columns: ReportTable["columns"];
  rows: ReportTable["rows"];
  notes: string[];
  source: ReportSource;
  totalDisponivel: number;
}): ReportTable {
  return {
    id: input.id,
    title: input.title,
    subtitle: input.subtitle,
    columns: input.columns,
    rows: input.rows,
    notes: [
      ...input.notes,
      `Mostrando ${input.rows.length} de ${formatInteger(input.totalDisponivel)} municípios: o PDF é documento de leitura e a lista completa está na pasta em Excel e no CSV.`,
    ],
    source: input.source,
  };
}

/**
 * Duas seções separadas: a curva (com os cortes) e os rankings, para cada
 * ranking caber inteiro numa página.
 */
function secoesConcentracao(input: {
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  fonteEleitoral: ReportSource;
}): ReportSection[] {
  const { reportDataset, analysis, fonteEleitoral } = input;
  const { concentracao } = analysis;
  const total = concentracao.municipios;

  const marcos = [5, 10, 20]
    .filter((corte) => corte <= total)
    .map((corte) => {
      const ponto = concentracao.pontos[corte - 1];
      return {
        posicao: corte,
        acumuladoPct: ponto.acumuladoPct,
        label: `${corte} municípios: ${formatPercent(ponto.acumuladoPct)}`,
      };
    });
  if (concentracao.municipiosParaMetade !== null) {
    const ponto = concentracao.pontos[concentracao.municipiosParaMetade - 1];
    marcos.push({
      posicao: concentracao.municipiosParaMetade,
      acumuladoPct: ponto.acumuladoPct,
      label: `${formatInteger(concentracao.municipiosParaMetade)} reúnem metade dos votos`,
    });
  }

  const grafico: ReportChart = {
    id: "concentracao-pareto",
    title: "Curva acumulada dos votos (Pareto)",
    subtitle: `${reportDataset.electionYear} · ${contarMunicipios(total)} com voto apurado · ambas as séries em % do mesmo total de votos`,
    legend: [
      { label: "% dos votos do município", kind: "barra", step: 0 },
      { label: "% acumulado", kind: "linha", step: 1 },
      { label: "marcos anotados", kind: "ponto", step: 2 },
    ],
    description:
      `Os municípios entram do mais votado ao menos votado; a linha soma a participação de cada um até chegar a 100%. ` +
      `Os ${Math.min(5, total)} primeiros reúnem ${pct(concentracao.top5Pct)} dos votos, os 10 primeiros ${pct(concentracao.top10Pct)} e os 20 primeiros ${pct(concentracao.top20Pct)}. ` +
      (concentracao.municipiosParaMetade === null
        ? "Sem votos apurados no recorte, não há curva acumulada."
        : `${contarMunicipios(concentracao.municipiosParaMetade)} reúnem metade dos votos do pleito.`),
    source: fonteEleitoral,
    // 48 mm bastam para a leitura da curva e deixam o ranking de votos caber
    // nesta mesma página.
    plotHeight: 48,
    spec: {
      kind: "pareto",
      points: concentracao.pontos.map((ponto) => ({
        posicao: ponto.posicao,
        label: ponto.nome,
        participacaoPct: ponto.participacaoPct,
        acumuladoPct: ponto.acumuladoPct,
      })),
      marcos,
      axis: { label: "Participação nos votos", unit: "% dos votos", decimals: 0 },
    },
  };

  const topVotos = concentracao.pontos.slice(0, MAX_LINHAS_RANKING);
  const porPercentual = [...reportDataset.analiticos]
    .sort(
      (a, b) =>
        (b.percentualValidos as number) - (a.percentualValidos as number) ||
        b.votos - a.votos,
    )
    .slice(0, MAX_LINHAS_RANKING);
  const comPosicao = reportDataset.municipios.filter(
    (municipio) => municipio.posicaoNoMunicipio !== null,
  );
  const melhoresPosicoes = [...comPosicao]
    .sort(
      (a, b) =>
        (a.posicaoNoMunicipio as number) - (b.posicaoNoMunicipio as number) ||
        b.votos - a.votos,
    )
    .slice(0, MAX_LINHAS_RANKING);

  const concentracaoSecao: ReportSection = {
    id: "concentracao",
    title: "Concentração dos votos",
    subtitle:
      "Quanto do resultado veio de poucas cidades — a curva acumulada e os cortes.",
    startsNewPage: true,
    blocks: [
      { kind: "grafico", chart: grafico },
      {
        kind: "cartoes",
        colunas: 3,
        items: [
          {
            label: "Nos 5 maiores",
            value: pct(concentracao.top5Pct),
            note: "dos votos do pleito",
          },
          {
            label: "Nos 10 maiores",
            value: pct(concentracao.top10Pct),
            note: "dos votos do pleito",
          },
          {
            label: "Nos 20 maiores",
            value: pct(concentracao.top20Pct),
            note: "dos votos do pleito",
          },
        ],
      },
      { kind: "paragrafo", text: concentracao.criterio, tone: "suave" },
      {
        kind: "tabela",
        table: tabelaRanking({
          id: "ranking-votos",
          title: "Maiores votações em números absolutos",
          subtitle: "Volume: onde saiu mais voto, independentemente do tamanho da cidade.",
          columns: [
            { header: "Posição", format: "numero" },
            { header: "Município", format: "texto" },
            { header: "Votos", format: "inteiro" },
            { header: "% dos votos da candidatura", format: "percentual", decimals: 2 },
            { header: "% acumulado", format: "percentual", decimals: 2 },
          ],
          rows: topVotos.map((ponto) => [
            ponto.posicao,
            ponto.nome,
            ponto.votos,
            ponto.participacaoPct,
            ponto.acumuladoPct,
          ]),
          notes: [
            "Muito voto absoluto costuma acompanhar cidade grande; a leitura de desempenho é a tabela seguinte.",
          ],
          source: fonteEleitoral,
          totalDisponivel: total,
        }),
      },
    ],
  };

  const rankings: ReportSection = {
    id: "rankings",
    title: "Rankings de desempenho e competitividade",
    subtitle:
      "As duas leituras que não dependem do tamanho da cidade, cada uma com o seu critério declarado.",
    startsNewPage: true,
    blocks: [
      {
        kind: "tabela",
        table: tabelaRanking({
          id: "ranking-percentual",
          title: "Maiores percentuais dos votos válidos",
          subtitle:
            "Desempenho relativo: entre os municípios com denominador apurado.",
          columns: [
            { header: "Município", format: "texto" },
            { header: "% dos válidos", format: "percentual", decimals: 2 },
            { header: "Votos", format: "inteiro" },
            { header: "Votos válidos do município", format: "inteiro" },
          ],
          rows: porPercentual.map((municipio) => [
            municipio.nome,
            municipio.percentualValidos,
            municipio.votos,
            municipio.validos,
          ]),
          notes: [
            `${contarMunicipios(reportDataset.municipios.length - reportDataset.analiticos.length)} ficaram fora desta tabela por não ter total de válidos apurado — nenhum deles entra valendo zero.`,
          ],
          source: fonteEleitoral,
          totalDisponivel: reportDataset.analiticos.length,
        }),
      },
      {
        kind: "tabela",
        table: tabelaRanking({
          id: "ranking-posicao",
          title: "Melhores colocações municipais",
          subtitle:
            "Competitividade: em que cidades a candidatura terminou mais à frente.",
          columns: [
            { header: "Município", format: "texto" },
            { header: "Posição no município", format: "numero" },
            { header: "Candidaturas com voto", format: "inteiro" },
            { header: "Votos", format: "inteiro" },
            { header: "% dos válidos", format: "percentual", decimals: 2 },
          ],
          rows: melhoresPosicoes.map((municipio) => [
            municipio.nome,
            municipio.posicaoNoMunicipio,
            municipio.candidaturasComVoto,
            municipio.votos,
            municipio.percentualValidos,
          ]),
          notes: [
            "A colocação é entre as candidaturas com voto apurado no município, como o TSE publica.",
          ],
          source: fonteEleitoral,
          totalDisponivel: comPosicao.length,
        }),
      },
    ],
  };

  return [concentracaoSecao, rankings];
}

/* -------------------------------------------------------------------------
 * Um capítulo por indicador
 * ------------------------------------------------------------------------- */

/** Os municípios que entram no cruzamento de um indicador, com valor. */
function paresDoIndicador(
  reportDataset: ReportDataset,
  indicator: IndicatorMetadata,
): Array<{ municipio: ReportMunicipio; valor: number }> {
  const pares: Array<{ municipio: ReportMunicipio; valor: number }> = [];
  for (const municipio of reportDataset.analiticos) {
    const valor = municipio.indicadores[indicator.id];
    if (valor === null) continue;
    if (indicator.logScale && valor <= 0) continue;
    pares.push({ municipio, valor });
  }
  return pares;
}

/** Pontos da dispersão, com rótulo direto só nos poucos extremos. */
function pontosDaDispersao(
  pares: ReadonlyArray<{ municipio: ReportMunicipio; valor: number }>,
): ReportScatterPoint[] {
  const porVotos = [...pares].sort((a, b) => b.municipio.votos - a.municipio.votos);
  const destacados = new Set(
    porVotos.slice(0, MAX_ROTULOS_NO_GRAFICO).map((par) => par.municipio.ibgeCode),
  );
  return pares.map((par) => ({
    label: par.municipio.nome,
    x: par.valor,
    y: par.municipio.percentualValidos as number,
    weight: par.municipio.eleitorado,
    callout: destacados.has(par.municipio.ibgeCode),
  }));
}

/**
 * Mínimo por lado para desenhar caixa: com menos de oito municípios a caixa
 * sugeriria dispersão que a amostra não sustenta, e o gráfico vira barras com
 * as duas medianas.
 */
const MINIMO_PARA_CAIXA = 8;

function graficoDeGrupos(
  item: IndicatorAnalysis,
  reportDataset: ReportDataset,
): ReportChart | null {
  const grupos = item.grupos;
  if (!grupos) return null;
  const indicator = item.indicator;
  const pares = paresDoIndicador(reportDataset, indicator);
  const acima = pares
    .filter((par) => par.valor >= grupos.corte)
    .map((par) => par.municipio.percentualValidos as number);
  const abaixo = pares
    .filter((par) => par.valor < grupos.corte)
    .map((par) => par.municipio.percentualValidos as number);
  const [statsAcima, statsAbaixo] = grupos.grupos;
  const corte = valorComUnidade(grupos.corte, indicator);
  const eixo = {
    label: "Percentual dos votos válidos",
    unit: "%",
    decimals: 1,
  };
  const diferenca =
    grupos.diferencaMediana === null
      ? "A diferença entre as medianas não pôde ser calculada."
      : `A diferença entre as medianas dos dois grupos é de ${formatDecimal(grupos.diferencaMediana)} ponto(s) percentual(is).`;
  const base = {
    subtitle: `Corte na mediana do indicador: ${corte} · indicador de ${item.compatibilidade.indicatorYear}`,
    description:
      `${grupos.criterio} ` +
      `Mediana do percentual dos válidos: ${pct(statsAcima.medianaPctValidos)} nos ${contarMunicipios(statsAcima.municipios)} com o indicador igual ou acima da mediana e ` +
      `${pct(statsAbaixo.medianaPctValidos)} nos ${contarMunicipios(statsAbaixo.municipios)} abaixo dela. ${diferenca}`,
    source: fonteDoIndicador(indicator),
  };

  if (acima.length >= MINIMO_PARA_CAIXA && abaixo.length >= MINIMO_PARA_CAIXA) {
    const series: ReportBoxSeries[] = [
      {
        label: "Indicador igual ou acima da mediana",
        note: `${contarMunicipios(statsAcima.municipios)}`,
        values: acima,
        step: 1,
      },
      {
        label: "Indicador abaixo da mediana",
        note: `${contarMunicipios(statsAbaixo.municipios)}`,
        values: abaixo,
        step: 0,
      },
    ];
    return {
      ...base,
      id: `grupos-${indicator.id}`,
      title: `Distribuição do desempenho nos dois grupos de ${indicator.metric.label.toLowerCase()}`,
      legend: [
        {
          label: "metade central da distribuição, com a mediana no traço claro",
          kind: "caixaMediana",
          step: 1,
        },
        { label: "grupo abaixo da mediana do indicador", kind: "caixa", step: 0 },
        { label: "municípios distantes da caixa", kind: "ponto", step: 2 },
      ],
      spec: { kind: "boxplot", series, axis: eixo },
    };
  }

  const items: ReportBarItem[] = [
    {
      label: "Indicador igual ou acima da mediana",
      note: `${contarMunicipios(statsAcima.municipios)}`,
      value: statsAcima.medianaPctValidos,
      step: 1,
    },
    {
      label: "Indicador abaixo da mediana",
      note: `${contarMunicipios(statsAbaixo.municipios)}`,
      value: statsAbaixo.medianaPctValidos,
      step: 0,
    },
  ];
  return {
    ...base,
    id: `grupos-${indicator.id}`,
    title: `Mediana do desempenho nos dois grupos de ${indicator.metric.label.toLowerCase()}`,
    legend: [
      { label: "mediana do grupo, em % dos válidos", kind: "barra", step: 1 },
    ],
    description: `${base.description} Com menos de ${MINIMO_PARA_CAIXA} municípios em um dos lados, o gráfico compara as medianas em vez de desenhar a distribuição.`,
    spec: { kind: "barras", items, axis: { ...eixo, min: 0 } },
  };
}

function graficoDeQuadrantes(item: IndicatorAnalysis): ReportChart | null {
  if (!item.quadrantes) return null;
  const indicator = item.indicator;
  const quadrantes = item.quadrantes;
  return {
    id: `quadrantes-${indicator.id}`,
    title: "Quatro grupos formados pelo cruzamento das medianas",
    subtitle:
      `Mediana de ${indicator.metric.label.toLowerCase()}: ${valorComUnidade(quadrantes.medianaIndicador, indicator)} · ` +
      `mediana do percentual dos válidos: ${formatPercent(quadrantes.medianaPercentualValidos)}`,
    legend: [
      { label: "contagem de municípios no grupo", kind: "caixa", cinza: true },
    ],
    description:
      `${quadrantes.criterio} Os nomes descrevem o corte que forma cada grupo; o que fazer com cada um é decisão de quem lê, não do relatório.`,
    source: fonteDoIndicador(indicator),
    plotHeight: 98,
    spec: {
      kind: "quadrantes",
      medianaX: quadrantes.medianaIndicador,
      medianaY: quadrantes.medianaPercentualValidos,
      x: {
        label: indicator.metric.label,
        unit: indicator.metric.unit,
      },
      y: { label: "Percentual dos válidos", unit: "%" },
      cells: quadrantes.quadrantes.map((quadrante) => ({
        label: quadrante.label,
        count: quadrante.municipios,
        items: quadrante.exemplos.map((exemplo) => exemplo.nome),
        limite: quadrante.limiteExemplos,
        xAcima: quadrante.id.startsWith("indicadorAcima"),
        yAcima: quadrante.id.endsWith("VotacaoAcima"),
      })),
    },
  };
}

/** Municípios de destaque: os que se afastam da tendência ou, sem eles, os extremos. */
function tabelaDeDestaques(
  item: IndicatorAnalysis,
  reportDataset: ReportDataset,
): ReportTable {
  const indicator = item.indicator;
  const metric = indicator.metric;
  const colunaIndicador = {
    header: columnHeaderWithUnit(metric.label, metric.unit),
    ...columnFormatFromMetric(metric.valueFormat),
  };
  const fonte = fonteDoIndicador(indicator);

  if (item.atipicos.municipios.length > 0) {
    return {
      id: `destaques-${indicator.id}`,
      title: "Municípios que mais se afastam da tendência",
      subtitle:
        "Distância vertical até a reta de tendência, em desvios padrão dos resíduos.",
      columns: [
        { header: "Município", format: "texto" },
        colunaIndicador,
        { header: "% dos válidos apurado", format: "percentual", decimals: 2 },
        { header: "% descrito pela tendência", format: "percentual", decimals: 2 },
        { header: "Resíduo padronizado", format: "decimal", decimals: 2 },
        { header: "Sentido", format: "texto" },
      ],
      rows: item.atipicos.municipios
        .slice(0, MAX_LINHAS_RANKING)
        .map((municipio) => [
          municipio.nome,
          municipio.valorIndicador,
          municipio.percentualValidos,
          municipio.esperado,
          municipio.residuoPadronizado,
          municipio.sentido,
        ]),
      notes: [
        item.atipicos.criterio,
        "“Atípico” aqui significa apenas distância da tendência do conjunto; não é erro de apuração nem sinal de nada por si só.",
      ],
      source: fonte,
    };
  }

  const pares = paresDoIndicador(reportDataset, indicator).sort(
    (a, b) => b.valor - a.valor,
  );
  const extremos = [...pares.slice(0, 3), ...pares.slice(-3)].filter(
    (par, indice, lista) =>
      lista.findIndex(
        (outro) => outro.municipio.ibgeCode === par.municipio.ibgeCode,
      ) === indice,
  );
  return {
    id: `destaques-${indicator.id}`,
    title: "Municípios nos extremos do indicador",
    subtitle:
      "Nenhum município se afasta da tendência além do corte declarado; a tabela mostra as pontas do indicador.",
    columns: [
      { header: "Município", format: "texto" },
      colunaIndicador,
      { header: "% dos válidos", format: "percentual", decimals: 2 },
      { header: "Votos", format: "inteiro" },
    ],
    rows: extremos.map((par) => [
      par.municipio.nome,
      par.valor,
      par.municipio.percentualValidos,
      par.municipio.votos,
    ]),
    notes: [
      "Três municípios com os maiores valores do indicador e três com os menores, entre os que entraram no cruzamento.",
    ],
    source: fonte,
  };
}

function secaoIndicador(
  item: IndicatorAnalysis,
  reportDataset: ReportDataset,
): ReportSection {
  const indicator = item.indicator;
  const metric = indicator.metric;
  const pares = paresDoIndicador(reportDataset, indicator);
  const disponibilidade = reportDataset.indicadores.find(
    (candidato) => candidato.id === indicator.id,
  );
  const semValor = disponibilidade?.semValor ?? item.correlacao.semPar;

  const dispersao: ReportChart = {
    id: `dispersao-${indicator.id}`,
    title: `Percentual dos válidos por ${metric.label.toLowerCase()}`,
    subtitle:
      `Um ponto por município · ${contarMunicipios(item.correlacao.n)} no cruzamento · ` +
      `${indicator.logScale ? "eixo do indicador em escala logarítmica (distribuição assimétrica)" : "eixo do indicador em escala linear"} · ` +
      `indicador de ${metric.referenceYear}, votação de ${reportDataset.electionYear}`,
    legend: [
      { label: "município (tamanho do ponto = eleitorado)", kind: "ponto", step: 0 },
      { label: "reta de tendência (mínimos quadrados)", kind: "linha", step: 2 },
    ],
    description:
      `Cada ponto é um município: a posição horizontal é o valor do indicador, a vertical é o percentual dos válidos, e o tamanho é o eleitorado — para não confundir uma capital com um distrito. ` +
      `A reta é a tendência do conjunto, não uma previsão para nenhum município. A leitura do que essa nuvem mostra está logo abaixo, em “Leitura”.`,
    semDado: {
      count: semValor,
      label: `municípios com percentual dos válidos apurado, mas sem valor de ${metric.label.toLowerCase()}`,
    },
    source: fonteDoIndicador(indicator),
    plotHeight: 58,
    spec: {
      kind: "dispersao",
      points: pontosDaDispersao(pares),
      tendencia: !item.correlacao.amostraInsuficiente,
      x: {
        label: metric.label,
        unit: metric.unit,
        scale: indicator.logScale ? "log10" : "linear",
        decimals: metric.valueFormat === "integer" ? 0 : 1,
      },
      y: { label: "Percentual dos válidos", unit: "%", decimals: 1 },
    },
  };

  const blocks: ReportBlock[] = [
    { kind: "paragrafo", text: metric.description },
    {
      kind: "campos",
      colunas: 3,
      items: [
        { label: "Fonte", value: metric.sourceLabel },
        { label: "Ano de referência", value: String(metric.referenceYear) },
        { label: "Municípios analisados", value: inteiro(item.correlacao.n) },
        { label: "Municípios sem dado", value: inteiro(semValor) },
        { label: "Denominador", value: indicator.denominator },
        { label: "Faixa esperada", value: indicator.expectedRange },
      ],
    },
    { kind: "grafico", chart: dispersao },
    { kind: "subtitulo", text: "Leitura" },
    { kind: "paragrafo", text: item.interpretacao },
  ];

  /* Ordem de diagramação: ressalvas logo depois da leitura e os blocos altos
     (grupos, tabela, quadrantes) em seguida, do menor para o maior, para a
     quebra de página cair sempre ENTRE dois blocos inteiros. */
  blocks.push({
    kind: "aviso",
    title: "Limitação metodológica",
    text: `${indicator.limitation} Cálculo: ${indicator.method}`,
  });
  if (item.compatibilidade.notice) {
    blocks.push({
      kind: "aviso",
      title: "Compatibilidade temporal",
      text: item.compatibilidade.notice,
    });
  }

  const grupos = graficoDeGrupos(item, reportDataset);
  if (grupos) blocks.push({ kind: "grafico", chart: grupos });

  blocks.push({ kind: "tabela", table: tabelaDeDestaques(item, reportDataset) });

  // A matriz de quadrantes acompanha só o indicador em DESTAQUE e fecha o
  // capítulo: é o bloco mais alto do documento.
  if (item.destaque) {
    const quadrantes = graficoDeQuadrantes(item);
    if (quadrantes) blocks.push({ kind: "grafico", chart: quadrantes });
  }
  // Sem bloco de fonte no fim do capítulo: cada gráfico e cada tabela já
  // imprime a sua procedência.

  return {
    id: `indicador-${indicator.id}`,
    title: item.destaque
      ? `Análise em destaque — ${metric.label}`
      : metric.label,
    subtitle: item.destaque
      ? "Indicador selecionado na tela quando o relatório foi gerado. O destaque muda a ordem e o detalhe; não muda o conteúdo do documento."
      : undefined,
    startsNewPage: true,
    blocks,
  };
}

/* -------------------------------------------------------------------------
 * Resumo comparativo
 * ------------------------------------------------------------------------- */

/**
 * Uma linha por indicador, a mesma tabela nas duas versões: é o que prova que
 * a régua da resumida não escondeu nenhum indicador, todos com o mesmo
 * coeficiente e o mesmo número de municípios.
 */
function tabelaComparativa(
  analysis: ReportAnalysis,
  reportDataset: ReportDataset,
): ReportTable {
  return {
    id: "comparativo",
    title: "Todos os indicadores lado a lado",
    subtitle: `Uma linha por indicador com dado suficiente · ${contarMunicipios(reportDataset.analiticos.length)} no universo analítico`,
    columns: [
      { header: "Indicador", format: "texto" },
      { header: "Associação observada", format: "texto" },
      { header: "Intensidade (Spearman)", format: "texto" },
      { header: "Municípios analisados", format: "inteiro" },
      { header: "Ano", format: "numero" },
    ],
    // Direção numa coluna e coeficiente na outra: juntos numa célula só, cada
    // linha quebrava em duas e a tabela estourava a página.
    rows: analysis.indicadores.map((item) => [
      item.indicator.metric.label,
      item.classificacao.coeficiente === null
        ? REPORT_MISSING_TEXT
        : item.classificacao.direction,
      item.classificacao.coeficiente === null
        ? REPORT_MISSING_TEXT
        : `${
            item.classificacao.direction === "sem associação clara"
              ? "abaixo do corte"
              : item.classificacao.strength
          } · ${formatAssociationCoefficient(item.classificacao.coeficiente)}`,
      item.correlacao.n,
      item.indicator.metric.referenceYear,
    ]),
    notes: [
      "A coluna de intensidade traz o coeficiente de Spearman entre os municípios analisados.",
      analysis.indicadores[0]?.classificacao.criterio ??
        "Sem indicador com dado suficiente neste recorte.",
      "A ordem é a do relatório: o indicador em destaque vem primeiro, os demais seguem a ordem do catálogo.",
      ...analysis.ressalvas,
    ],
    source: {
      label: "Cruzamento entre os dados do TSE e os indicadores territoriais",
      detail: `Eleição de ${reportDataset.electionYear}`,
    },
  };
}

function secoesComparativo(
  analysis: ReportAnalysis,
  reportDataset: ReportDataset,
): ReportSection[] {
  const tabela = tabelaComparativa(analysis, reportDataset);

  const blocks: ReportBlock[] = [];

  // Painéis distribuídos por igual entre os gráficos, não empacotados até o
  // teto: com 20 indicadores, de 6 em 6 sobra um gráfico de dois painéis.
  const partes = Math.max(
    1,
    Math.ceil(analysis.indicadores.length / MAX_PAINEIS),
  );
  const porParte = Math.ceil(analysis.indicadores.length / partes);
  for (let inicio = 0; inicio < analysis.indicadores.length; inicio += porParte) {
    const bloco = analysis.indicadores.slice(inicio, inicio + porParte);
    const parte = Math.floor(inicio / porParte) + 1;
    const paineis: ReportPanel[] = bloco.map((item) => ({
      title: item.indicator.metric.shortLabel,
      subtitle: `${item.classificacao.label} · n = ${formatInteger(item.correlacao.n)}`,
      semDado: reportDataset.analiticos.length - item.correlacao.n,
      spec: {
        kind: "dispersaoMini",
        points: pontosDaDispersao(
          paresDoIndicador(reportDataset, item.indicator),
        ).map((ponto) => ({ ...ponto, callout: false })),
        x: {
          label: item.indicator.metric.shortLabel,
          unit: item.indicator.metric.unit,
          scale: item.indicator.logScale ? "log10" : "linear",
        },
        y: { label: "% dos válidos", unit: "%" },
      },
    }));
    blocks.push({
      kind: "grafico",
      chart: {
        id: `comparativo-multiplos-${parte}`,
        title:
          partes > 1
            ? `Cada cruzamento em miniatura (${parte} de ${partes})`
            : "Cada cruzamento em miniatura",
        subtitle:
          "Mesmo eixo vertical em todos os painéis: percentual dos votos válidos. O eixo horizontal é o do próprio indicador, com a escala que ele pede.",
        legend: [
          { label: "município", kind: "ponto", step: 0 },
          { label: "reta de tendência", kind: "linha", step: 2 },
        ],
        description:
          "Os painéis servem para comparar a FORMA das nuvens — inclinação e dispersão —, não para ler valores: cada capítulo traz o gráfico grande do seu indicador, com escala rotulada.",
        spec: { kind: "multiplos", panels: paineis, colunas: 3 },
      },
    });
  }

  return [
    {
      id: "resumo-comparativo",
      title: "Resumo comparativo",
      subtitle:
        "O que cada indicador mostrou, na mesma régua, para leitura de uma página só.",
      startsNewPage: true,
      blocks: [{ kind: "tabela", table: tabela }],
    },
    // Os pequenos múltiplos começam em página nova.
    {
      id: "resumo-comparativo-graficos",
      title: "Todos os cruzamentos em miniatura",
      subtitle:
        "A mesma nuvem de cada capítulo, em escala reduzida, para comparar formas — a leitura de valores é a do gráfico grande.",
      startsNewPage: true,
      blocks,
    },
  ];
}

/* -------------------------------------------------------------------------
 * Metodologia
 * ------------------------------------------------------------------------- */

/**
 * TODO INDICADOR DO CATÁLOGO, com a situação de cada um. A mesma tabela nas
 * duas versões: indicador sem dado no recorte aparece declarado, com o motivo,
 * em vez de sumir em silêncio.
 */
function tabelaCatalogoIndicadores(reportDataset: ReportDataset): ReportTable {
  return {
    id: "metodologia-indicadores",
    title: "Indicadores do catálogo e a situação de cada um",
    subtitle:
      "Todo indicador do catálogo aparece, tenha ou não dado neste recorte. Nenhum some em silêncio.",
    columns: [
      { header: "Indicador", format: "texto" },
      { header: "Fonte", format: "texto" },
      { header: "Ano", format: "numero" },
      { header: "Municípios com valor", format: "inteiro" },
      { header: "Situação", format: "texto" },
    ],
    rows: reportDataset.indicadores.map((item) => [
      item.indicator.metric.label,
      item.indicator.metric.sourceLabel,
      item.indicator.metric.referenceYear,
      item.cobertura,
      item.disponivel
        ? "analisado"
        : (item.motivoIndisponibilidade ?? "sem dado suficiente"),
    ]),
    notes: [
      `Um indicador entra na análise com pelo menos ${PEARSON_MIN_N} municípios com valor; abaixo disso o coeficiente vira ruído de amostra pequena.`,
    ],
    source: {
      label: "Catálogo de indicadores da plataforma",
      detail: "Metadados de fonte, ano e método de cada indicador",
    },
  };
}

function secaoMetodologia(input: {
  contest: CandidateContest;
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  fonteEleitoral: ReportSource;
}): ReportSection {
  const { contest, reportDataset, analysis } = input;
  const intervalo =
    analysis.indicadores.find((item) => item.correlacao.spearmanIntervalo)
      ?.correlacao.spearmanIntervalo ?? null;

  const indicadores = tabelaCatalogoIndicadores(reportDataset);

  const unicos = fontesUnicas(
    input.fonteEleitoral,
    reportDataset.indicadores.map((item) => item.indicator),
  );

  const blocks: ReportBlock[] = [
    {
      kind: "campos",
      colunas: 2,
      items: [
        {
          label: "Unidade territorial",
          value: `Município (código IBGE) · ${ESTADO.nome} (${ESTADO.uf})`,
        },
        {
          label: "Eleição",
          value: `${reportDataset.electionYear} · ${getOfficeLabel(contest)} · ${reportDataset.round}º turno`,
        },
        {
          label: "Métrica eleitoral principal",
          value:
            "Percentual dos votos válidos do município que foram da candidatura",
        },
        {
          label: "Municípios com voto apurado",
          value: inteiro(reportDataset.municipios.length),
        },
        {
          label: "Municípios no universo analítico",
          value: `${formatInteger(reportDataset.analiticos.length)} (com denominador apurado)`,
        },
        {
          label: "Municípios excluídos da análise",
          value: `${formatInteger(analysis.municipiosExcluidos)} (sem total de válidos apurado)`,
        },
        {
          label: "Mínimo para analisar um indicador",
          value: `${formatInteger(reportDataset.minimoMunicipios)} municípios com valor`,
        },
        {
          label: "Indicadores analisados",
          value: `${formatInteger(analysis.indicadores.length)} de ${formatInteger(reportDataset.indicadores.length)} do catálogo`,
        },
      ],
    },
    { kind: "subtitulo", text: "Tratamento de dados ausentes" },
    {
      kind: "lista",
      items: [
        "Município sem total de votos válidos apurado fica fora de toda correlação, comparação de grupos e quadrante — e continua contado no total de votos e na curva de concentração.",
        "Município sem valor de um indicador fica fora daquele cruzamento e é contado na legenda de sem-dado do gráfico.",
        "Indicador que dependa de um campo ausente no snapshot não é preenchido com zero: fica declarado como não analisado, com o motivo.",
        analysis.notaExclusoes ||
          "Nenhum município do recorte ficou fora da análise por falta de denominador.",
      ],
    },
    { kind: "subtitulo", text: "Método de comparação entre grupos" },
    {
      kind: "paragrafo",
      text:
        analysis.indicadores[0]?.grupos?.criterio ??
        "Sem indicador com dado suficiente neste recorte, nenhuma comparação de grupos foi calculada.",
    },
    { kind: "subtitulo", text: "Método de correlação" },
    {
      kind: "paragrafo",
      text:
        (analysis.indicadores[0]?.classificacao.criterio ??
          "Sem indicador com dado suficiente neste recorte, nenhum coeficiente foi calculado.") +
        (intervalo
          ? ` Intervalos de confiança de ${Math.round(intervalo.nivel * 100)}%: ${intervalo.metodo}`
          : ""),
    },
    { kind: "subtitulo", text: "Municípios atípicos" },
    {
      kind: "paragrafo",
      text:
        analysis.indicadores[0]?.atipicos.criterio ??
        "Sem indicador com dado suficiente neste recorte, nenhum município atípico foi listado.",
    },
    { kind: "subtitulo", text: "Concentração" },
    { kind: "paragrafo", text: analysis.concentracao.criterio },
    { kind: "subtitulo", text: "Limitações" },
    { kind: "lista", items: analysis.ressalvas },
    { kind: "subtitulo", text: "Convenções deste documento" },
    { kind: "lista", items: CONVENCOES },
  ];

  if (unicos.length > 0) {
    blocks.push({ kind: "subtitulo", text: "Fontes, com endereço clicável" });
    blocks.push({ kind: "links", items: unicos });
  }

  if (analysis.omissoes.length > 0) {
    blocks.push({ kind: "subtitulo", text: "Cruzamentos não realizados" });
    blocks.push({
      kind: "lista",
      items: analysis.omissoes.map(
        (omissao) => `${omissao.title}: ${omissao.reason}`,
      ),
    });
  }

  // Tabela longa no fim para o documento não terminar numa página com quatro
  // linhas de link.
  blocks.push({ kind: "subtitulo", text: "Indicadores incluídos e declarados" });
  blocks.push({ kind: "tabela", table: indicadores });

  return {
    id: "metodologia",
    title: "Metodologia e fontes",
    subtitle:
      "Como cada número deste relatório foi obtido, e o que ele não permite afirmar.",
    startsNewPage: true,
    blocks,
  };
}

/* -------------------------------------------------------------------------
 * O documento inteiro
 * ------------------------------------------------------------------------- */

/**
 * As seções do relatório de um pleito, na ordem em que são lidas. O
 * `activeViewFilter` já entrou em `analysis.indicadores` como ordem e
 * destaque: ele muda qual capítulo vem primeiro e qual ganha a matriz de
 * quadrantes, nenhuma seção entra ou sai e o título é sempre o geral.
 */
export function buildContestSections(input: {
  contest: CandidateContest;
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  generatedAt: Date;
  fonteEleitoral: ReportSource;
}): ReportSection[] {
  const { reportDataset, analysis } = input;
  const secoes: ReportSection[] = [
    secaoCapa({
      contest: input.contest,
      reportDataset,
      analysis,
      generatedAt: input.generatedAt,
      fonteEleitoral: input.fonteEleitoral,
    }),
  ];

  // Pleito de uma cidade só não tem território, concentração nem cruzamento:
  // existe UM município. A metodologia continua, com as omissões declaradas.
  const territorial = !reportDataset.municipal && reportDataset.municipios.length > 1;

  if (territorial) {
    secoes.push(
      secaoTerritorio({
        reportDataset,
        analysis,
        fonteEleitoral: input.fonteEleitoral,
      }),
    );
    secoes.push(
      ...secoesConcentracao({
        reportDataset,
        analysis,
        fonteEleitoral: input.fonteEleitoral,
      }),
    );
    for (const item of analysis.indicadores) {
      secoes.push(secaoIndicador(item, reportDataset));
    }
    if (analysis.indicadores.length > 0) {
      secoes.push(...secoesComparativo(analysis, reportDataset));
    }
  }

  secoes.push(
    secaoMetodologia({
      contest: input.contest,
      reportDataset,
      analysis,
      fonteEleitoral: input.fonteEleitoral,
    }),
  );
  return secoes;
}

/* -------------------------------------------------------------------------
 * A VERSÃO RESUMIDA
 * ------------------------------------------------------------------------- */

/**
 * TETO DE CAPÍTULOS DA VERSÃO RESUMIDA: cinco, cada um com cerca de meia
 * página (gráfico, leitura e limitação). O teto não esconde indicador: os que
 * ficam de fora seguem inteiros na tabela de resumo comparativo desta versão,
 * com coeficiente, direção e número de municípios.
 */
export const MAX_CAPITULOS_RESUMIDO = 5;

/**
 * O CRITÉRIO DE SELEÇÃO, em código. Primeiro o indicador em DESTAQUE (o
 * selecionado na tela), que ocupa uma vaga sem tirar ninguém do documento. As
 * vagas restantes vão para os de MAIOR MÓDULO do coeficiente de Spearman
 * (módulo porque associação negativa forte vale tanto quanto positiva forte)
 * entre os que o motor não classificou como "sem associação clara"; o corte é
 * o que `reportAnalysis` publica na metodologia, não um novo. Empate se desfaz
 * pelo número de municípios cruzados e, persistindo, pelo nome, para o arquivo
 * sair igual a cada geração.
 */
export function selecionarIndicadoresResumidos(
  indicadores: readonly IndicatorAnalysis[],
  teto: number = MAX_CAPITULOS_RESUMIDO,
): IndicatorAnalysis[] {
  const destaque = indicadores.filter((item) => item.destaque);
  const demais = indicadores
    .filter(
      (item) =>
        !item.destaque &&
        item.classificacao.coeficiente !== null &&
        item.classificacao.direction !== "sem associação clara",
    )
    .sort((a, b) => {
      const forcaA = Math.abs(a.classificacao.coeficiente as number);
      const forcaB = Math.abs(b.classificacao.coeficiente as number);
      if (forcaB !== forcaA) return forcaB - forcaA;
      if (b.correlacao.n !== a.correlacao.n) return b.correlacao.n - a.correlacao.n;
      return a.indicator.metric.label.localeCompare(
        b.indicator.metric.label,
        "pt-BR",
      );
    });
  return [...destaque, ...demais].slice(0, Math.max(0, teto));
}

/** A força de um item por extenso: "0,74" ou "sem coeficiente calculado". */
function forcaPorExtenso(item: IndicatorAnalysis): string {
  return item.classificacao.coeficiente === null
    ? "sem coeficiente calculado"
    : formatAssociationCoefficient(
        Math.abs(item.classificacao.coeficiente),
      );
}

/** O critério de seleção escrito para o papel: a régua tem de ir no documento. */
function criterioDosCapitulos(input: {
  selecionados: readonly IndicatorAnalysis[];
  /** Quantos indicadores passariam na régua se não houvesse teto. */
  elegiveis: number;
  analisados: number;
  temDestaque: boolean;
}): string {
  const { selecionados, analisados, temDestaque } = input;
  const foraDoCapitulo = Math.max(0, analisados - selecionados.length);
  const porForca = selecionados.filter((item) => !item.destaque);
  const faixa =
    porForca.length === 0
      ? " Nenhum indicador deste recorte passou desse corte, então nenhuma vaga foi preenchida por força de associação."
      : ` Neste recorte, ${formatInteger(input.elegiveis)} ${input.elegiveis === 1 ? "indicador passou" : "indicadores passaram"} desse corte, e os escolhidos vão do coeficiente ${forcaPorExtenso(porForca[0])} ao ${forcaPorExtenso(porForca[porForca.length - 1])}, em módulo.`;
  return (
    `Régua desta versão, aplicada sem exceção: no máximo ${formatInteger(MAX_CAPITULOS_RESUMIDO)} indicadores ganham capítulo próprio. ` +
    (temDestaque
      ? "A primeira vaga é do indicador que estava selecionado na tela quando o relatório foi gerado — é a única coisa que a tela decide aqui, e ela não tira nenhum indicador da tabela comparativa nem muda um número deste documento. "
      : "Nenhum indicador estava selecionado na tela quando o relatório foi gerado, então todas as vagas foram por força de associação. ") +
    "As demais vagas vão para os de maior módulo do coeficiente de Spearman entre os que têm associação classificada, isto é, os que passam do corte de classificação declarado na metodologia; " +
    "abaixo desse corte um capítulo gastaria uma página para dizer que não há associação a ler. " +
    "Empate se desfaz pelo número de municípios cruzados e, persistindo, pela ordem alfabética." +
    faixa +
    ` ${formatInteger(analisados)} indicadores foram analisados neste recorte e ${formatInteger(selecionados.length)} ganharam capítulo próprio: ` +
    (foraDoCapitulo === 0
      ? "nenhum ficou sem capítulo nesta versão."
      : `os outros ${formatInteger(foraDoCapitulo)} aparecem na tabela de resumo comparativo desta versão, com o mesmo coeficiente e o mesmo número de municípios, e têm capítulo inteiro na versão completa deste relatório.`)
  );
}

/**
 * A DECLARAÇÃO DE ESCOPO: curta na capa, inteira na metodologia (com a lista
 * do que ficou de fora), sempre da MESMA função e dos MESMOS números.
 */
function avisoDeEscopoResumido(input: {
  selecionados: readonly IndicatorAnalysis[];
  analisados: number;
  catalogo: number;
  detalhado: boolean;
}): { title: string; text: string } {
  const foraDoCapitulo = Math.max(0, input.analisados - input.selecionados.length);
  const contagem =
    `Este documento analisou ${formatInteger(input.analisados)} indicadores dos ${formatInteger(input.catalogo)} do catálogo e deu capítulo próprio a ${formatInteger(input.selecionados.length)} deles; ` +
    `${foraDoCapitulo === 0 ? "nenhum ficou sem capítulo" : `${formatInteger(foraDoCapitulo)} ficaram sem capítulo`} nesta versão. ` +
    "Os que ficaram de fora não sumiram: estão na tabela de resumo comparativo, com direção, coeficiente e número de municípios.";
  return {
    title: "Esta é a versão resumida — o que ela não traz",
    text: input.detalhado
      ? `${contagem} ` +
        "O capítulo inteiro de cada indicador — dispersão grande, comparação de grupos, municípios atípicos e quadrantes —, os quatro recortes do território e os três rankings municipais estão na VERSÃO COMPLETA deste relatório. " +
        "A base municipal linha a linha está na pasta de trabalho em Excel e no CSV. " +
        "O critério que escolheu os capítulos está logo abaixo e não depende de quem lê."
      : `${contagem} O capítulo inteiro de cada indicador, os quatro recortes do território e os rankings municipais estão na VERSÃO COMPLETA; a base município a município, na pasta em Excel e no CSV. O critério de escolha dos capítulos está na página de metodologia.`,
  };
}

/**
 * Território e concentração numa seção só: a leitura PRINCIPAL do território
 * (percentual dos válidos, a métrica dos cruzamentos), a curva acumulada, os
 * três cortes e um ranking. As outras leituras e rankings são da versão
 * completa, e o texto diz isso.
 */
function secaoTerritorioResumida(input: {
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  fonteEleitoral: ReportSource;
}): ReportSection {
  const { reportDataset, analysis, fonteEleitoral } = input;
  const municipios = reportDataset.municipios;
  const percentuais = municipios
    .map((municipio) => municipio.percentualValidos)
    .filter((valor): valor is number => valor !== null);
  const { concentracao } = analysis;
  const total = concentracao.municipios;

  const distribuicao: ReportChart = {
    id: "resumido-desempenho-relativo",
    title: "Desempenho relativo entre os municípios",
    subtitle: `${reportDataset.electionYear} · percentual dos votos válidos do município que foram da candidatura · ${contarMunicipios(percentuais.length)} com denominador apurado`,
    legend: [
      {
        label: "metade central dos municípios, com a mediana no traço claro",
        kind: "caixaMediana",
        step: 0,
      },
      { label: "um ponto por município", kind: "ponto", step: 2 },
    ],
    description:
      `A caixa marca a metade central dos municípios e o traço claro é a mediana, de ${pct(mediana(percentuais))} dos válidos; cada ponto é um município. ` +
      "Esta é a métrica eleitoral principal do relatório, e é a que todos os cruzamentos usam. " +
      "As outras três leituras do território — volume em votos, importância de cada município para a campanha e competitividade — estão na versão completa.",
    semDado: {
      count: municipios.length - percentuais.length,
      label: "municípios sem total de votos válidos apurado",
    },
    source: fonteEleitoral,
    // 32 mm: a tira é UMA distribuição, não uma grade de painéis (nos 44 mm
    // por linha dos pequenos múltiplos sobrava branco).
    plotHeight: 32,
    spec: {
      kind: "multiplos",
      colunas: 1,
      panels: [
        {
          title: "Percentual dos votos válidos",
          subtitle: "um ponto por município, do menor ao maior",
          semDado: municipios.length - percentuais.length,
          spec: {
            kind: "tira",
            values: percentuais,
            axis: { label: "% dos válidos", unit: "%", decimals: 1 },
          },
        },
      ],
    },
  };

  const marcos = [5, 10, 20]
    .filter((corte) => corte <= total)
    .map((corte) => {
      const ponto = concentracao.pontos[corte - 1];
      return {
        posicao: corte,
        acumuladoPct: ponto.acumuladoPct,
        label: `${corte} municípios: ${formatPercent(ponto.acumuladoPct)}`,
      };
    });
  if (concentracao.municipiosParaMetade !== null) {
    const ponto = concentracao.pontos[concentracao.municipiosParaMetade - 1];
    marcos.push({
      posicao: concentracao.municipiosParaMetade,
      acumuladoPct: ponto.acumuladoPct,
      label: `${formatInteger(concentracao.municipiosParaMetade)} reúnem metade dos votos`,
    });
  }

  const pareto: ReportChart = {
    id: "resumido-concentracao-pareto",
    title: "Curva acumulada dos votos (Pareto)",
    subtitle: `${reportDataset.electionYear} · ${contarMunicipios(total)} com voto apurado · ambas as séries em % do mesmo total de votos`,
    legend: [
      { label: "% dos votos do município", kind: "barra", step: 0 },
      { label: "% acumulado", kind: "linha", step: 1 },
      { label: "marcos anotados", kind: "ponto", step: 2 },
    ],
    description:
      "Os municípios entram do mais votado ao menos votado; a linha soma a participação de cada um até chegar a 100%. " +
      (concentracao.municipiosParaMetade === null
        ? "Sem votos apurados no recorte, não há curva acumulada."
        : `${contarMunicipios(concentracao.municipiosParaMetade)} reúnem metade dos votos do pleito.`),
    source: fonteEleitoral,
    plotHeight: 44,
    spec: {
      kind: "pareto",
      points: concentracao.pontos.map((ponto) => ({
        posicao: ponto.posicao,
        label: ponto.nome,
        participacaoPct: ponto.participacaoPct,
        acumuladoPct: ponto.acumuladoPct,
      })),
      marcos,
      axis: { label: "Participação nos votos", unit: "% dos votos", decimals: 0 },
    },
  };

  const topVotos = concentracao.pontos.slice(0, MAX_LINHAS_RANKING);

  return {
    id: "territorio-concentracao-resumido",
    title: "Território e concentração",
    subtitle:
      "A leitura principal do território e o quanto do resultado veio de poucas cidades.",
    /* SEM quebra de folha forçada: o conteúdo flui e o renderizador só quebra
       ANTES de um gráfico que não caiba inteiro. */
    startsNewPage: false,
    blocks: [
      { kind: "grafico", chart: distribuicao },
      { kind: "grafico", chart: pareto },
      {
        kind: "cartoes",
        colunas: 3,
        items: [
          {
            label: "Nos 5 maiores",
            value: pct(concentracao.top5Pct),
            note: "dos votos do pleito",
          },
          {
            label: "Nos 10 maiores",
            value: pct(concentracao.top10Pct),
            note: "dos votos do pleito",
          },
          {
            label: "Nos 20 maiores",
            value: pct(concentracao.top20Pct),
            note: "dos votos do pleito",
          },
        ],
      },
      {
        kind: "tabela",
        table: tabelaRanking({
          id: "resumido-ranking-votos",
          title: "Maiores votações em números absolutos",
          subtitle:
            "Volume: onde saiu mais voto, independentemente do tamanho da cidade.",
          columns: [
            { header: "Posição", format: "numero" },
            { header: "Município", format: "texto" },
            { header: "Votos", format: "inteiro" },
            { header: "% dos votos da candidatura", format: "percentual", decimals: 2 },
            { header: "% acumulado", format: "percentual", decimals: 2 },
          ],
          rows: topVotos.map((ponto) => [
            ponto.posicao,
            ponto.nome,
            ponto.votos,
            ponto.participacaoPct,
            ponto.acumuladoPct,
          ]),
          notes: [
            "Muito voto absoluto costuma acompanhar cidade grande: desempenho relativo é a leitura de cima, não esta.",
            "Os rankings de desempenho relativo e de competitividade estão na versão completa.",
          ],
          source: fonteEleitoral,
          totalDisponivel: total,
        }),
      },
      { kind: "paragrafo", text: concentracao.criterio, tone: "suave" },
    ],
  };
}

/**
 * Os capítulos escolhidos em blocos compactos (gráfico, leitura, limitação),
 * numa seção só com um subtítulo por indicador: cada um ocupa pouco mais de
 * meia página, então dois dividem a folha.
 */
function secaoCruzamentosResumida(input: {
  selecionados: readonly IndicatorAnalysis[];
  reportDataset: ReportDataset;
  criterio: string;
}): ReportSection {
  const { selecionados, reportDataset } = input;
  const blocks: ReportBlock[] = [
    { kind: "paragrafo", text: input.criterio, tone: "suave" },
  ];

  for (const item of selecionados) {
    const indicator = item.indicator;
    const metric = indicator.metric;
    const pares = paresDoIndicador(reportDataset, indicator);
    const disponibilidade = reportDataset.indicadores.find(
      (candidato) => candidato.id === indicator.id,
    );
    const semValor = disponibilidade?.semValor ?? item.correlacao.semPar;

    // O cabeçalho carrega a classificação; sem ela, repetiria o título do
    // gráfico logo abaixo.
    blocks.push({
      kind: "subtitulo",
      text: `${metric.label} — ${item.classificacao.label}${item.destaque ? " · selecionado na tela" : ""}`,
    });
    blocks.push({
      kind: "grafico",
      chart: {
        id: `resumido-dispersao-${indicator.id}`,
        title: `Percentual dos válidos por ${metric.label.toLowerCase()}`,
        subtitle:
          `Um ponto por município · ${contarMunicipios(item.correlacao.n)} no cruzamento · ` +
          `${indicator.logScale ? "eixo do indicador em escala logarítmica" : "eixo do indicador em escala linear"} · ` +
          `indicador de ${metric.referenceYear}, votação de ${reportDataset.electionYear}`,
        legend: [
          { label: "município (tamanho do ponto = eleitorado)", kind: "ponto", step: 0 },
          { label: "reta de tendência (mínimos quadrados)", kind: "linha", step: 2 },
        ],
        description:
          "Cada ponto é um município: a horizontal é o valor do indicador, a vertical é o percentual dos válidos e o tamanho é o eleitorado. " +
          "A reta é a tendência do conjunto, não uma previsão para nenhum município.",
        semDado: {
          count: semValor,
          label: `municípios com percentual dos válidos apurado, mas sem valor de ${metric.label.toLowerCase()}`,
        },
        source: fonteDoIndicador(indicator),
        plotHeight: 46,
        spec: {
          kind: "dispersao",
          points: pontosDaDispersao(pares),
          tendencia: !item.correlacao.amostraInsuficiente,
          x: {
            label: metric.label,
            unit: metric.unit,
            scale: indicator.logScale ? "log10" : "linear",
            decimals: metric.valueFormat === "integer" ? 0 : 1,
          },
          y: { label: "Percentual dos válidos", unit: "%", decimals: 1 },
        },
      },
    });
    blocks.push({ kind: "paragrafo", text: item.interpretacao });
    blocks.push({
      kind: "aviso",
      title: "Limitação metodológica",
      text: indicator.limitation,
    });
  }

  return {
    id: "cruzamentos-resumido",
    title: "Cruzamentos com capítulo próprio",
    subtitle:
      "Um gráfico, uma leitura e a limitação de cada indicador escolhido pela régua declarada abaixo.",
    startsNewPage: false,
    blocks,
  };
}

/** A tabela dos vinte, com a nota que diz quais ganharam capítulo. */
function secaoComparativaResumida(input: {
  analysis: ReportAnalysis;
  reportDataset: ReportDataset;
  selecionados: readonly IndicatorAnalysis[];
}): ReportSection {
  const { analysis, reportDataset, selecionados } = input;
  const base = tabelaComparativa(analysis, reportDataset);
  const foraDoCapitulo = analysis.indicadores.length - selecionados.length;
  const nomes = selecionados
    .map((item) => item.indicator.metric.label)
    .join(", ");
  const tabela: ReportTable = {
    ...base,
    subtitle: `${base.subtitle} · a tabela é a mesma da versão completa, com todas as linhas`,
    notes: [
      ...(base.notes ?? []),
      selecionados.length === 0
        ? "Nenhum indicador ganhou capítulo próprio nesta versão."
        : `Ganharam capítulo próprio nesta versão resumida: ${nomes}.`,
      foraDoCapitulo <= 0
        ? "Todos os indicadores analisados têm capítulo nesta versão."
        : `Os outros ${formatInteger(foraDoCapitulo)} indicadores analisados aparecem nesta tabela e têm capítulo inteiro na versão completa do relatório.`,
    ],
  };
  return {
    id: "resumo-comparativo",
    title: "Resumo comparativo",
    subtitle:
      "Uma linha por indicador analisado, na mesma régua — inclusive os que não ganharam capítulo nesta versão.",
    // Folha nova para a tabela caber INTEIRA: partida ao meio, ela deixa de
    // provar que nenhum indicador sumiu.
    startsNewPage: true,
    blocks: [{ kind: "tabela", table: tabela }],
  };
}

/** A metodologia enxuta: convenções, critério de seleção e o aviso de escopo. */
function secaoMetodologiaResumida(input: {
  contest: CandidateContest;
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  selecionados: readonly IndicatorAnalysis[];
  criterio: string;
  aviso: { title: string; text: string };
  fonteEleitoral: ReportSource;
}): ReportSection {
  const { contest, reportDataset, analysis, selecionados } = input;
  const unicos = fontesUnicas(
    input.fonteEleitoral,
    reportDataset.indicadores.map((item) => item.indicator),
  );

  const blocks: ReportBlock[] = [
    { kind: "aviso", title: input.aviso.title, text: input.aviso.text },
    {
      kind: "campos",
      colunas: 3,
      items: [
        {
          label: "Unidade territorial",
          value: `Município (código IBGE) · ${ESTADO.nome} (${ESTADO.uf})`,
        },
        {
          label: "Eleição",
          value: `${reportDataset.electionYear} · ${getOfficeLabel(contest)} · ${reportDataset.round}º turno`,
        },
        {
          label: "Métrica eleitoral principal",
          value:
            "Percentual dos votos válidos do município que foram da candidatura",
        },
        {
          label: "Municípios com voto apurado",
          value: inteiro(reportDataset.municipios.length),
        },
        {
          label: "Municípios no universo analítico",
          value: `${formatInteger(reportDataset.analiticos.length)} (com denominador apurado)`,
        },
        {
          label: "Municípios excluídos da análise",
          value: `${formatInteger(analysis.municipiosExcluidos)} (sem total de válidos apurado)`,
        },
        {
          label: "Indicadores analisados",
          value: `${formatInteger(analysis.indicadores.length)} de ${formatInteger(reportDataset.indicadores.length)} do catálogo`,
        },
        {
          label: "Indicadores com capítulo próprio",
          value: `${formatInteger(selecionados.length)} de ${formatInteger(analysis.indicadores.length)} analisados`,
        },
      ],
    },
    { kind: "subtitulo", text: "Critério de seleção dos capítulos" },
    { kind: "paragrafo", text: input.criterio },
    { kind: "subtitulo", text: "Método de correlação" },
    {
      kind: "paragrafo",
      text:
        analysis.indicadores[0]?.classificacao.criterio ??
        "Sem indicador com dado suficiente neste recorte, nenhum coeficiente foi calculado.",
    },
    { kind: "subtitulo", text: "Tratamento de dados ausentes" },
    {
      kind: "lista",
      items: [
        "Município sem total de votos válidos apurado fica fora de toda correlação e continua contado no total de votos e na curva de concentração; município sem valor de um indicador fica fora daquele cruzamento e é contado na legenda de sem-dado do gráfico.",
        analysis.notaExclusoes ||
          "Nenhum município do recorte ficou fora da análise por falta de denominador.",
      ],
    },
    { kind: "subtitulo", text: "Limitações" },
    { kind: "lista", items: analysis.ressalvas },
    { kind: "subtitulo", text: "Convenções deste documento" },
    { kind: "lista", items: CONVENCOES },
  ];

  if (analysis.omissoes.length > 0) {
    blocks.push({ kind: "subtitulo", text: "Cruzamentos não realizados" });
    blocks.push({
      kind: "lista",
      items: analysis.omissoes.map(
        (omissao) => `${omissao.title}: ${omissao.reason}`,
      ),
    });
  }

  if (unicos.length > 0) {
    blocks.push({ kind: "subtitulo", text: "Fontes, com endereço clicável" });
    blocks.push({ kind: "links", items: unicos });
  }

  /* Tabela longa fecha a seção, como na completa: a metodologia não cabe em
     uma página e a última folha terminaria em quatro linhas de link. */
  blocks.push({ kind: "subtitulo", text: "Indicadores incluídos e declarados" });
  blocks.push({ kind: "tabela", table: tabelaCatalogoIndicadores(reportDataset) });

  return {
    id: "metodologia",
    title: "Metodologia e fontes",
    subtitle:
      "Como cada número desta versão foi obtido, o que ela recortou e o que ela não permite afirmar.",
    startsNewPage: true,
    blocks,
  };
}

/**
 * As seções da VERSÃO RESUMIDA, na ordem em que são lidas. Mesmos dados e
 * mesmas regras; o que fica de fora é declarado na capa, na tabela comparativa
 * e na metodologia, com a régua escrita e o ponteiro para a versão completa.
 * Como na completa, o `activeViewFilter` já chegou resolvido em
 * `analysis.indicadores`: ocupa a primeira vaga de capítulo e não altera o
 * universo de municípios, a tabela de indicadores nem o título.
 */
export function buildContestSummarySections(input: {
  contest: CandidateContest;
  reportDataset: ReportDataset;
  analysis: ReportAnalysis;
  generatedAt: Date;
  fonteEleitoral: ReportSource;
}): ReportSection[] {
  const { reportDataset, analysis } = input;
  const territorial = !reportDataset.municipal && reportDataset.municipios.length > 1;
  const selecionados = territorial
    ? selecionarIndicadoresResumidos(analysis.indicadores)
    : [];
  // Quantos passariam na régua sem o teto: contagem publicada no documento.
  const elegiveis = territorial
    ? selecionarIndicadoresResumidos(
        analysis.indicadores,
        analysis.indicadores.length,
      ).filter((item) => !item.destaque).length
    : 0;
  const criterio = criterioDosCapitulos({
    selecionados,
    elegiveis,
    analisados: analysis.indicadores.length,
    temDestaque: selecionados.some((item) => item.destaque),
  });
  const escopo = {
    selecionados,
    analisados: analysis.indicadores.length,
    catalogo: reportDataset.indicadores.length,
  };
  const avisoDaCapa = avisoDeEscopoResumido({ ...escopo, detalhado: false });
  const avisoDaMetodologia = avisoDeEscopoResumido({ ...escopo, detalhado: true });

  const secoes: ReportSection[] = [
    secaoCapa({
      contest: input.contest,
      reportDataset,
      analysis,
      generatedAt: input.generatedAt,
      fonteEleitoral: input.fonteEleitoral,
      avisoDeVersao: avisoDaCapa,
    }),
  ];

  if (territorial) {
    secoes.push(
      secaoTerritorioResumida({
        reportDataset,
        analysis,
        fonteEleitoral: input.fonteEleitoral,
      }),
    );
    if (selecionados.length > 0) {
      secoes.push(
        secaoCruzamentosResumida({ selecionados, reportDataset, criterio }),
      );
    }
    if (analysis.indicadores.length > 0) {
      secoes.push(
        secaoComparativaResumida({ analysis, reportDataset, selecionados }),
      );
    }
  }

  secoes.push(
    secaoMetodologiaResumida({
      contest: input.contest,
      reportDataset,
      analysis,
      selecionados,
      criterio,
      aviso: avisoDaMetodologia,
      fonteEleitoral: input.fonteEleitoral,
    }),
  );
  return secoes;
}
