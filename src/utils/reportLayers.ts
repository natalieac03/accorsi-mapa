import type { AnalysisModel } from "../types/analysis";
import type { ElectionModel } from "../types/elections";
import type { PollingModel } from "../types/pollingPlaces";
import type { SpectrumModel } from "../types/spectrum";
import { ESTADO } from "../config/estado.ts";
import { getAnalysisRangeLabel } from "./analysis.ts";
import { formatDecimal, formatInteger, formatPercent } from "./electorate.ts";
import { getPollingMetricLabel } from "./pollingPlaces.ts";
import { getSpectrumContestLabel } from "./spectrum.ts";
import {
  columnFormatFromMetric,
  columnHeaderWithUnit,
  createReportDocument,
  highlightValue,
  slugifyReport,
  type ReportColumn,
  type ReportDocument,
  type ReportImage,
  type ReportTable,
} from "./reportModel.ts";

/**
 * Relatórios das camadas do mapa (análise territorial, espectro, histórico
 * eleitoral e locais de votação).
 *
 * As colunas REAPROVEITAM as dos CSVs de cada motor: mesmos campos, mesma
 * ordem, mesma regra de ausência. Aqui os cabeçalhos são por extenso e as
 * colunas técnicas ficam marcadas como `pdfHidden` (continuam no Excel, saem do
 * documento impresso). O CSV continua existindo em todos esses painéis.
 */

const ATRIBUICAO =
  "Elaborado com dados públicos TSE/IBGE · Malha: IBGE · Plataforma de inteligência eleitoral";

const CANDIDATURA = "Dra. Adriana Accorsi · PT";

function base(input: {
  filenameBase: string;
  title: string;
  subtitle: string;
  scope: string;
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  return createReportDocument({
    ...input,
    candidatura: CANDIDATURA,
    estado: ESTADO.nome,
    attribution: ATRIBUICAO,
    images: input.images ?? [],
  });
}

/* -------------------------------------------------------------------------
 * Análise territorial
 * ------------------------------------------------------------------------- */

export function buildAnalysisTable(model: AnalysisModel): ReportTable {
  const { metric } = model;
  const columns: ReportColumn[] = [
    { header: "Posição", format: "numero" },
    { header: "Município", format: "texto" },
    { header: "Código IBGE", format: "texto", pdfHidden: true },
    { header: "Código TSE", format: "texto", pdfHidden: true },
    {
      header: columnHeaderWithUnit(metric.label, metric.unit),
      ...columnFormatFromMetric(metric.valueFormat),
    },
    { header: "Faixa (quintil)", format: "numero" },
    { header: "Intervalo da faixa", format: "texto" },
    { header: "Eleitorado 2026", format: "inteiro" },
  ];
  return {
    id: "analise",
    title: `Análise · ${metric.shortLabel}`,
    subtitle: `${metric.sourceLabel} · ano de referência ${metric.referenceYear} · faixas por quintis`,
    columns,
    rows: model.filteredItems.map((item) => [
      item.rank,
      item.municipality.name,
      item.municipality.ibgeCode,
      item.municipality.tseCode,
      item.value,
      item.band + 1,
      getAnalysisRangeLabel(metric.id, model.thresholds, item.band),
      item.municipality.electorate,
    ]),
    notes: [
      metric.description,
      "Quintis comparam somente municípios com dado no mesmo ano de referência. Municípios sem valor oficial ficam fora da tabela e são contados na capa — nunca entram com zero.",
      "Faixa e posição descrevem o indicador escolhido; não representam voto nem desempenho eleitoral.",
    ],
    source: {
      label: metric.sourceLabel,
      detail: `Indicador ${metric.sourceIndicatorId} · ano ${metric.referenceYear}`,
      url: metric.sourceUrl,
    },
  };
}

export function buildAnalysisReport(input: {
  model: AnalysisModel;
  municipalityCount: number;
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  const { model } = input;
  const doc = base({
    filenameBase: `relatorio-analise-${slugifyReport(model.metric.shortLabel)}-${model.metric.referenceYear}`,
    title: "Análise territorial",
    subtitle: model.metric.label,
    scope: `${ESTADO.nome} · ${formatInteger(model.filteredItems.length)} de ${formatInteger(model.allItems.length)} municípios em foco`,
    generatedAt: input.generatedAt,
    images: input.images,
  });
  return {
    ...doc,
    highlights: [
      {
        label: "Municípios em foco",
        value: `${formatInteger(model.filteredItems.length)} / ${formatInteger(model.allItems.length)}`,
        note: "faixas selecionadas na tela",
      },
      {
        label: "Eleitorado reunido",
        value: formatInteger(model.focusedElectorate),
        note: `${formatPercent(model.focusedElectoratePct)} do eleitorado de ${ESTADO.nome}`,
      },
      {
        label: "Mediana estadual",
        value: `${formatDecimal(model.median)} ${model.metric.unit}`.trim(),
        note: `${model.metric.shortLabel} · ${model.metric.referenceYear}`,
      },
      {
        label: "Sem dado oficial",
        value: formatInteger(model.missingMunicipalityCount),
        note: `de ${formatInteger(input.municipalityCount)} municípios — aparecem em cinza no mapa e fora da tabela`,
      },
    ],
    tables: [buildAnalysisTable(model)],
  };
}

/* -------------------------------------------------------------------------
 * Espectro ideológico
 * ------------------------------------------------------------------------- */

export function buildSpectrumTable(model: SpectrumModel): ReportTable {
  const comparisonContest =
    model.metricId === "shift" ? model.comparisonContest : null;
  const columns: ReportColumn[] = [
    { header: "Posição", format: "numero" },
    { header: "Município", format: "texto" },
    { header: "Código IBGE", format: "texto", pdfHidden: true },
    { header: "Código TSE", format: "texto", pdfHidden: true },
    { header: "Índice ideológico (0–10)", format: "decimal", decimals: 2 },
    ...(comparisonContest
      ? ([
          {
            header: `Índice ${comparisonContest.electionYear}`,
            format: "decimal",
            decimals: 2,
          },
          {
            header: "Deslocamento (pontos)",
            format: "decimal",
            decimals: 2,
          },
        ] satisfies ReportColumn[])
      : []),
    { header: "Esquerda", format: "percentual", decimals: 1 },
    { header: "Centro", format: "percentual", decimals: 1 },
    { header: "Direita", format: "percentual", decimals: 1 },
    { header: "Votos apurados", format: "inteiro" },
    { header: "Votos com nota", format: "inteiro", pdfHidden: true },
    { header: "Votos sem nota", format: "inteiro", pdfHidden: true },
    { header: "Cobertura", format: "percentual", decimals: 1 },
    { header: "Partido mais votado", format: "texto" },
  ];
  return {
    id: "espectro",
    title: `Espectro ${model.contest.electionYear}`,
    subtitle: `${getSpectrumContestLabel(model.contest)} · onda ${model.wave.year} do survey · ${model.metricLabel}`,
    columns,
    rows: model.filteredItems.map((item) => [
      item.rank,
      item.municipality.name,
      item.municipality.ibgeCode,
      item.municipality.tseCode,
      // Índice ausente = nenhum voto do município caiu em partido com nota.
      // Vazio, jamais 0: na escala 0–10, 0 significaria "extrema esquerda".
      item.index,
      ...(comparisonContest ? [item.comparisonIndex, item.shift] : []),
      item.blockSharePct.left,
      item.blockSharePct.center,
      item.blockSharePct.right,
      item.totalVotes,
      item.scoredVotes,
      item.unscoredVotes,
      item.coveragePct,
      item.leadingPartyCode,
    ]),
    notes: [
      "O índice é a média das notas ideológicas dos partidos votados, ponderada pelos votos de cada partido no município — mede o voto, não a opinião de quem votou.",
      "Índice vazio significa que nenhum voto do município caiu em partido com nota no survey. Na escala 0–10, escrever 0 ali significaria “extrema esquerda”: por isso a célula fica vazia.",
      `Cobertura é a fatia dos votos apurados que caiu em partido com nota. Municípios sem índice no recorte: ${formatInteger(model.missingMunicipalityCount)}.`,
    ],
    source: {
      label: `TSE · votação por município + ${model.wave.institution} · notas ideológicas`,
      detail: `${getSpectrumContestLabel(model.contest)} · onda ${model.wave.year} · ${model.wave.citation}`,
      url: model.wave.url,
    },
  };
}

export function buildSpectrumReport(input: {
  model: SpectrumModel;
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  const { model } = input;
  const comparisonContest =
    model.metricId === "shift" ? model.comparisonContest : null;
  const doc = base({
    filenameBase: `relatorio-espectro-${model.contest.electionYear}-${slugifyReport(model.contest.officeName)}-${model.contest.round}t`,
    title: "Espectro ideológico",
    subtitle: model.metricLabel,
    scope: comparisonContest
      ? `${getSpectrumContestLabel(comparisonContest)} → ${getSpectrumContestLabel(model.contest)}`
      : getSpectrumContestLabel(model.contest),
    generatedAt: input.generatedAt,
    images: input.images,
  });
  return {
    ...doc,
    highlights: [
      {
        label: `Índice de ${ESTADO.nome}`,
        value: highlightValue(model.stateIndex, formatDecimal),
        note: `escala 0–10 · onda ${model.wave.year} do survey`,
      },
      ...(comparisonContest
        ? [
            {
              label: "Deslocamento estadual",
              value: highlightValue(
                model.stateShift,
                (valor) => `${valor > 0 ? "+" : ""}${formatDecimal(valor)}`,
              ),
              note: `pontos da escala 0–10 desde ${comparisonContest.electionYear} · positivo = para a direita`,
            },
          ]
        : []),
      {
        label: "Municípios em foco",
        value: `${formatInteger(model.filteredItems.length)} / ${formatInteger(model.allItems.length)}`,
        note: `${formatInteger(model.missingMunicipalityCount)} sem índice no recorte`,
      },
      {
        label: "Cobertura estadual",
        value: formatPercent(model.stateCoveragePct),
        note: `${formatInteger(model.stateScoredVotes)} de ${formatInteger(model.stateTotalVotes)} votos apurados caíram em partido com nota`,
      },
    ],
    tables: [buildSpectrumTable(model)],
  };
}

/* -------------------------------------------------------------------------
 * Histórico eleitoral
 * ------------------------------------------------------------------------- */

export function buildElectionTable(model: ElectionModel): ReportTable {
  const comparison = model.comparisonCandidate;
  const columns: ReportColumn[] = [
    { header: "Posição", format: "numero" },
    { header: "Município", format: "texto" },
    { header: "Código IBGE", format: "texto", pdfHidden: true },
    { header: "Código TSE", format: "texto", pdfHidden: true },
    { header: "Votos", format: "inteiro" },
    { header: "Votos válidos do município", format: "inteiro", pdfHidden: true },
    { header: "% dos válidos", format: "percentual", decimals: 2 },
    ...(comparison
      ? ([
          {
            header: `Votos ${model.comparisonContest.electionYear}`,
            format: "inteiro",
          },
          {
            header: `% dos válidos ${model.comparisonContest.electionYear}`,
            format: "percentual",
            decimals: 2,
          },
          { header: "Diferença (p.p.)", format: "decimal", decimals: 2 },
        ] satisfies ReportColumn[])
      : []),
    { header: "Liderou o município", format: "texto" },
  ];
  const contestLabel = `${model.contest.electionYear} · ${model.contest.officeName} · ${model.contest.round}º turno`;
  return {
    id: "historico",
    title: `Histórico ${model.contest.electionYear}`,
    subtitle: `${contestLabel} · ${model.candidate.ballotName}${model.candidate.party ? ` (${model.candidate.party})` : ""}`,
    columns,
    rows: model.filteredItems.map((item) => [
      item.rank,
      item.municipality.name,
      item.municipality.ibgeCode,
      item.municipality.tseCode,
      item.votes,
      item.validVotes,
      item.sharePct,
      ...(comparison
        ? [
            item.comparisonVotes,
            item.comparisonSharePct,
            item.sharePct - item.comparisonSharePct,
          ]
        : []),
      item.winner ? "sim" : "não",
    ]),
    notes: [
      "Percentual sobre os votos válidos apurados no município, no mesmo pleito e turno.",
      ...(comparison
        ? [
            `Comparação com ${comparison.ballotName}${comparison.party ? ` (${comparison.party})` : ""} em ${model.comparisonContest.electionYear}: a diferença está em pontos percentuais, não em variação relativa.`,
          ]
        : []),
    ],
    source: {
      label: "TSE · Resultados por município",
      detail: `${contestLabel} · votação nominal`,
      url: "https://dadosabertos.tse.jus.br/dataset/resultados",
    },
  };
}

export function buildElectionReport(input: {
  model: ElectionModel;
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  const { model } = input;
  const contestLabel = `${model.contest.electionYear} · ${model.contest.officeName} · ${model.contest.round}º turno`;
  const doc = base({
    filenameBase: `relatorio-historico-${model.contest.electionYear}-${slugifyReport(model.contest.officeName)}-${model.contest.round}t-${slugifyReport(model.candidate.ballotName)}`,
    title: "Histórico eleitoral",
    subtitle: model.candidate.party
      ? `${model.candidate.ballotName} (${model.candidate.party})`
      : model.candidate.ballotName,
    scope: contestLabel,
    generatedAt: input.generatedAt,
    images: input.images,
  });
  return {
    ...doc,
    highlights: [
      {
        label: `Votos em ${ESTADO.nome}`,
        value: formatInteger(model.stateVotes),
        note: `${formatPercent(model.stateSharePct)} dos válidos do cargo`,
      },
      {
        label: "Municípios em que liderou",
        value: formatInteger(model.municipalitiesWon),
        note: `de ${formatInteger(model.allItems.length)} municípios apurados`,
      },
      {
        label: "Melhor município",
        value: model.bestMunicipality.municipality.name,
        note: `${formatPercent(model.bestMunicipality.sharePct)} dos válidos · ${formatInteger(model.bestMunicipality.votes)} votos`,
      },
      {
        label: "Municípios em foco",
        value: `${formatInteger(model.filteredItems.length)} / ${formatInteger(model.allItems.length)}`,
        note: "faixas selecionadas na tela",
      },
    ],
    tables: [buildElectionTable(model)],
  };
}

/* -------------------------------------------------------------------------
 * Locais de votação
 * ------------------------------------------------------------------------- */

export function buildPollingTable(model: PollingModel): ReportTable {
  const bairros = model.viewMode === "neighborhoods";
  const porPartido = model.metric === "votoPartido";
  const porCandidata = model.metric === "votosCandidata";
  const nomeCandidata = model.candidate?.nomeUrna ?? "candidata";
  const rotuloMedida = getPollingMetricLabel(model.metric, model.partyCode, {
    rate: model.candidateRate,
    nome: model.candidate?.nomeUrna,
  });
  const columns: ReportColumn[] = [
    { header: "Posição", format: "numero" },
    { header: "Município", format: "texto" },
    { header: "Código IBGE", format: "texto", pdfHidden: true },
    ...(bairros
      ? ([
          { header: "Bairro", format: "texto" },
          { header: "Locais agregados", format: "inteiro" },
        ] satisfies ReportColumn[])
      : ([
          { header: "Local de votação", format: "texto" },
          { header: "Bairro", format: "texto" },
          { header: "Endereço", format: "texto", pdfHidden: true },
          { header: "Zona", format: "numero", pdfHidden: true },
        ] satisfies ReportColumn[])),
    { header: "Seções", format: "inteiro", pdfHidden: true },
    { header: "Eleitorado", format: "inteiro" },
    ...(porCandidata
      ? ([
          { header: `Votos de ${nomeCandidata}`, format: "inteiro" },
          {
            header: "Votos por 1.000 eleitores",
            format: "decimal",
            decimals: 2,
          },
          { header: "Estava na urna", format: "texto", pdfHidden: true },
        ] satisfies ReportColumn[])
      : porPartido
        ? ([
            { header: `Votos ${model.partyCode || "da sigla"}`, format: "inteiro" },
            {
              header: `% ${model.partyCode || "da sigla"}`,
              format: "percentual",
              decimals: 1,
            },
          ] satisfies ReportColumn[])
        : ([
            { header: "Índice ideológico (0–10)", format: "decimal", decimals: 2 },
            { header: "Esquerda", format: "percentual", decimals: 1 },
            { header: "Centro", format: "percentual", decimals: 1 },
            { header: "Direita", format: "percentual", decimals: 1 },
            { header: "Cobertura", format: "percentual", decimals: 1 },
          ] satisfies ReportColumn[])),
    // Numa tabela de voto dela, "votos apurados" (total da urna, de todas as
    // candidaturas) e "partido mais votado" respondem outra pergunta.
    ...(porCandidata
      ? []
      : ([
          { header: "Votos apurados", format: "inteiro" },
          { header: "Partido mais votado", format: "texto" },
        ] satisfies ReportColumn[])),
  ];
  const escopo = model.municipalityName ?? ESTADO.nome;
  return {
    id: "locais",
    title: bairros ? `Bairros ${model.contestId}` : `Locais ${model.contestId}`,
    subtitle: `${model.contestLabel} · ${escopo} · ${rotuloMedida}`,
    columns,
    rows: model.filteredUnits.map((unit) => [
      unit.rank,
      unit.municipalityName,
      unit.ibgeCode,
      ...(bairros
        ? [unit.neighborhood, unit.placeCount]
        : [unit.name, unit.neighborhood, unit.address, unit.zone]),
      unit.sectionCount,
      unit.electorate,
      ...(porCandidata
        ? // Célula vazia = ela não era candidata ali; 0 é zero DE VERDADE.
          [
            unit.candidateVotes,
            unit.candidateVotesPerThousand,
            unit.candidateInScope ? "Sim" : "Não",
          ]
        : porPartido
          ? // partyVotes 0 com voto apurado é zero DE VERDADE; sem
            // denominador o que sai vazio é o percentual.
            [unit.partyVotes, unit.partySharePct]
          : [
              unit.index,
              unit.blockSharePct.left,
              unit.blockSharePct.center,
              unit.blockSharePct.right,
              unit.coveragePct,
            ]),
      ...(porCandidata ? [] : [unit.totalVotes, unit.leadingPartyCode]),
    ]),
    notes: [
      "A medida é do LOCAL ONDE SE VOTA, não do bairro onde se mora: quem vota numa escola pode morar em outro bairro.",
      porCandidata
        ? `Célula de votos vazia significa que ${nomeCandidata} não era candidata naquele local (pleito municipal, outra cidade): valor ausente, fora do ranking. Zero votos com ela na urna é zero de verdade.`
        : porPartido
          ? "Percentual vazio significa unidade sem voto apurado (sem denominador). Zero votos da sigla com votos apurados é zero de verdade."
          : "Índice vazio significa que nenhum voto da unidade caiu em partido com nota no survey — jamais é zero.",
      `${formatInteger(model.missingValueCount)} unidades do recorte ficaram fora por não terem valor na métrica ativa.`,
      ...(porCandidata && model.candidate
        ? [
            `${formatInteger(model.candidate.unmatchedPlaceCount)} locais com voto dela neste pleito não existem no cadastro de locais (${formatInteger(model.candidate.unmatchedVotes)} votos): ficam fora do mapa e desta tabela, e estão declarados aqui em vez de descartados em silêncio.`,
          ]
        : []),
    ],
    source: {
      label: porCandidata
        ? "TSE · Votação nominal por seção da candidata + cadastro de locais de votação"
        : "TSE · Boletins de urna por seção + cadastro de locais de votação",
      detail: `${model.contestLabel}${model.metric === "indice" ? ` · onda ${model.waveYear} do survey` : ""} · ${escopo}`,
      url: "https://dadosabertos.tse.jus.br/dataset/resultados",
    },
  };
}

export function buildPollingReport(input: {
  model: PollingModel;
  generatedAt: Date;
  images?: ReportImage[];
}): ReportDocument {
  const { model } = input;
  const escopo = model.municipalityName ?? ESTADO.nome;
  const modo = model.viewMode === "neighborhoods" ? "bairros" : "locais";
  const porCandidata = model.metric === "votosCandidata";
  const nomeCandidata = model.candidate?.nomeUrna ?? "candidata";
  const medida = porCandidata
    ? model.candidateRate
      ? "votos-candidata-por-mil"
      : "votos-candidata"
    : model.metric === "votoPartido" && model.partyCode
      ? `voto-${slugifyReport(model.partyCode)}`
      : "indice";
  const doc = base({
    filenameBase: `relatorio-${modo}-${medida}-${slugifyReport(escopo)}-${model.contestId || "pleito"}`,
    title:
      model.viewMode === "neighborhoods"
        ? "Bairros por local de votação"
        : "Locais de votação",
    subtitle: getPollingMetricLabel(model.metric, model.partyCode, {
      rate: model.candidateRate,
      nome: model.candidate?.nomeUrna,
    }),
    scope: `${model.contestLabel} · ${escopo}`,
    generatedAt: input.generatedAt,
    images: input.images,
  });
  return {
    ...doc,
    highlights: [
      porCandidata
        ? {
            label: `Votos de ${nomeCandidata} no recorte`,
            value: highlightValue(model.summary.candidateVotes, formatInteger),
            note:
              model.summary.candidateVotesPerThousand === null
                ? `${model.contestLabel} · votos nominais somados dos locais do recorte`
                : `${formatDecimal(model.summary.candidateVotesPerThousand)} por 1.000 eleitores · ${formatInteger(model.summary.candidateUnitsWithVotes)} unidades com voto dela`,
          }
        : {
            label:
              model.metric === "votoPartido"
                ? `% do ${model.partyCode || "partido"} no recorte`
                : "Índice do recorte",
            value:
              model.metric === "votoPartido"
                ? highlightValue(model.summary.partySharePct, formatPercent)
                : highlightValue(model.summary.index, formatDecimal),
            note:
              model.metric === "votoPartido"
                ? `${formatInteger(model.summary.partyVotes)} votos da sigla sobre ${formatInteger(model.summary.totalVotes)} apurados`
                : `escala 0–10 · onda ${model.waveYear} do survey`,
          },
      {
        label: "Locais de votação",
        value: formatInteger(model.summary.placeCount),
        note: `${formatInteger(model.summary.mappedPlaceCount)} com coordenada · ${formatInteger(model.summary.neighborhoodCount)} bairros`,
      },
      {
        label: "Eleitorado do recorte",
        value: formatInteger(model.summary.electorate),
        note: `${formatInteger(model.electorateWithoutCoordinate)} em locais sem coordenada`,
      },
      porCandidata && model.candidate
        ? {
            // Quanto do voto dela ficou fora por não haver o local no cadastro.
            label: "Locais dela fora do cadastro",
            value: formatInteger(model.candidate.unmatchedPlaceCount),
            note: `${formatInteger(model.candidate.unmatchedVotes)} votos dela sem local no cadastro · ${formatInteger(model.candidate.matchedPlaceCount)} de ${formatInteger(model.candidate.placesInContest)} locais casaram`,
          }
        : {
            label: "Unidades na tabela",
            value: formatInteger(model.filteredUnits.length),
            note: `${formatInteger(model.missingValueCount)} sem valor na métrica ativa ficaram fora`,
          },
    ],
    tables: [buildPollingTable(model)],
  };
}
