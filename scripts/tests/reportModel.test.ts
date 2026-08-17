import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
  CandidateRankingRow,
  ScatterModel,
} from "../../src/types/candidate.ts";
import { buildGrowthModel } from "../../src/utils/candidateStats.ts";
import { buildCareerOverview } from "../../src/utils/candidateStats.ts";
import { buildTrajectory } from "../../src/utils/candidate.ts";
import { getStatsIndicator } from "../../src/utils/candidateStats.ts";
import { toPdfText, getPdfColumns } from "../../src/utils/exportPdf.ts";
import {
  buildCoverBlocks,
  buildReportFilename,
  buildWorkbookPlan,
  computeColumnWidths,
  formatGeneratedAt,
  formatReportCell,
  getExcelNumberFormat,
  hasExportableContent,
  resolveSheetNames,
  sanitizeSheetName,
  type ReportColumn,
  type ReportDocument,
  type ReportTable,
} from "../../src/utils/reportModel.ts";
import {
  buildContestReport,
  buildGrowthReport,
  buildRankingTable,
  buildScatterTable,
  buildTrajectoryReport,
} from "../../src/utils/reportStats.ts";

/**
 * Payloads SINTÉTICOS inline, espelhando o shape de
 * `process_candidato_foco.py`. Nada aqui depende dos snapshots de `src/data`:
 * nesta instalação eles são placeholders, e a camada de relatório precisa ser
 * verificável antes de qualquer `gerar_dados.sh`. NENHUM teste é pulado.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 * 1. valor ausente nunca vira zero em nenhuma saída — numa planilha isso é
 *    pior que na tela, porque a coluna soma;
 * 2. número e percentual saem em pt-BR, com as casas declaradas;
 * 3. conjunto pendente não vira aba: sai declarado como não gerado;
 * 4. nome de arquivo, nome de aba e recorte batem com o que estava na tela.
 */

const AGORA = new Date("2026-08-17T17:32:00Z");

function municipio(
  nome: string,
  votos: number,
  overrides: Partial<CandidateMunicipio> = {},
): CandidateMunicipio {
  return {
    nome,
    votos,
    validos: votos * 4,
    percentualValidos: 25,
    votosDoPartido: votos * 2,
    percentualDoPartido: 50,
    posicaoNoMunicipio: 3,
    candidaturasComVoto: 12,
    ...overrides,
  };
}

function contest(
  id: string,
  electionYear: number,
  overrides: Partial<CandidateContest> = {},
): CandidateContest {
  return {
    id,
    electionYear,
    officeCode: 6,
    officeName: "Deputado Federal",
    round: 1,
    candidatura: {
      sqCandidato: "1",
      nomeCompleto: "ADRIANA ACCORSI",
      nomeUrna: "Dra. Adriana Accorsi",
      partido: "PT",
      numero: "1313",
      situacaoCandidatura: "Deferido",
      resultado: "Eleita por QP",
    },
    votosNoEstado: 96000,
    posicaoNoEstado: 4,
    candidaturasNoPleito: 627,
    municipiosComVoto: 3,
    concentracaoPercentual: { top5: 71.5, top10: 82.25, top20: 90 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios: {
      "5208707": municipio("Goiânia", 40000),
      "5201405": municipio("Anápolis", 12000),
      "5212501": municipio("Luziânia", 4000),
    },
    locais: null,
    bairros: null,
    ...overrides,
  };
}

function dataset(): CandidateDataset {
  return {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "adriana-accorsi",
      pleitos: 2,
      anos: [2018, 2022],
      cargos: ["Deputado Federal"],
      source: "TSE · Resultados por município",
      sourceUrl: "https://dadosabertos.tse.jus.br/",
    },
    contests: [
      contest("2018-6-1", 2018, { votosNoEstado: 60000 }),
      contest("2022-6-1", 2022),
    ],
  };
}

function datasetPendente(): CandidateDataset {
  return {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "adriana-accorsi",
      status: "pendente",
      pleitos: 0,
      anos: [],
      cargos: [],
    },
    contests: [],
  };
}

/* -------------------------------------------------------------------------
 * 1. Ausência nunca vira zero
 * ------------------------------------------------------------------------- */

test("célula nula vira vazio no plano do Excel, nunca 0", () => {
  const table: ReportTable = {
    id: "t",
    title: "Bairros",
    columns: [
      { header: "Bairro", format: "texto" },
      { header: "Votos", format: "inteiro" },
      { header: "Variação", format: "percentual", decimals: 1 },
    ],
    rows: [
      ["Setor Sul", 1200, 12.5],
      ["Campinas", null, null],
      ["Vila Nova", 0, 0],
    ],
    source: { label: "TSE" },
  };
  const plan = buildWorkbookPlan({
    filenameBase: "teste",
    title: "T",
    subtitle: "S",
    scope: "R",
    candidatura: "C",
    estado: "Goiás",
    generatedAt: AGORA,
    highlights: [],
    tables: [table],
    omitted: [],
    images: [],
    attribution: "A",
  });
  const sheet = plan.sheets[1];
  assert.equal(sheet.kind, "dados");
  if (sheet.kind !== "dados") return;
  // A linha ausente segue null no plano — o renderer grava null como célula
  // vazia. Se algum dia isso virar 0, a coluna passa a somar uma mentira.
  assert.deepEqual(sheet.table.rows[1], ["Campinas", null, null]);
  // Zero apurado continua zero: os dois casos NÃO se confundem.
  assert.deepEqual(sheet.table.rows[2], ["Vila Nova", 0, 0]);
});

test("célula nula vira travessão no texto do PDF, nunca 0", () => {
  const coluna: ReportColumn = { header: "Votos", format: "inteiro" };
  assert.equal(formatReportCell(null, coluna), "—");
  assert.equal(formatReportCell(0, coluna), "0");
  assert.equal(formatReportCell("", coluna), "—");
  assert.equal(
    formatReportCell(null, { header: "%", format: "percentual", decimals: 2 }),
    "—",
  );
});

/* -------------------------------------------------------------------------
 * 2. Formatação pt-BR e casas declaradas
 * ------------------------------------------------------------------------- */

test("número e percentual saem em pt-BR com as casas declaradas", () => {
  assert.equal(
    formatReportCell(1234567, { header: "Votos", format: "inteiro" }),
    "1.234.567",
  );
  // Ano nunca leva separador de milhar.
  assert.equal(formatReportCell(2024, { header: "Ano", format: "numero" }), "2024");
  assert.equal(
    formatReportCell(25.456, {
      header: "%",
      format: "percentual",
      decimals: 2,
    }),
    "25,46%",
  );
  assert.equal(
    formatReportCell(25.44, { header: "%", format: "percentual", decimals: 1 }),
    "25,4%",
  );
  assert.equal(
    formatReportCell(7.5, { header: "Índice", format: "decimal", decimals: 2 }),
    "7,50",
  );
});

test("formato numérico do Excel declara as mesmas casas", () => {
  assert.equal(
    getExcelNumberFormat({ header: "a", format: "inteiro" }),
    "[$-416]#,##0",
  );
  assert.equal(getExcelNumberFormat({ header: "a", format: "numero" }), "0");
  assert.equal(
    getExcelNumberFormat({ header: "a", format: "percentual", decimals: 2 }),
    '[$-416]#,##0.00"%"',
  );
  assert.equal(
    getExcelNumberFormat({ header: "a", format: "decimal", decimals: 1 }),
    "[$-416]#,##0.0",
  );
  // Texto não recebe formato numérico: um código IBGE com zero à esquerda não
  // pode ser reinterpretado como número.
  assert.equal(getExcelNumberFormat({ header: "a", format: "texto" }), null);
});

test("data de geração e nome de arquivo usam o fuso de Brasília", () => {
  assert.equal(formatGeneratedAt(AGORA), "17/08/2026 às 14:32 (horário de Brasília)");
  const doc = buildTrajectoryReport({
    dataset: dataset(),
    overview: buildCareerOverview(dataset()),
    trajectory: buildTrajectory(dataset()),
    generatedAt: AGORA,
  });
  assert.equal(
    buildReportFilename(doc, "xlsx"),
    "relatorio-trajetoria-adriana-accorsi-2026-08-17.xlsx",
  );
  assert.equal(
    buildReportFilename(doc, "pdf"),
    "relatorio-trajetoria-adriana-accorsi-2026-08-17.pdf",
  );
});

/* -------------------------------------------------------------------------
 * 3. Nomes de aba
 * ------------------------------------------------------------------------- */

test("nome de aba respeita os limites do Excel e continua único", () => {
  assert.equal(sanitizeSheetName("Municípios 2022 / 1º turno"), "Municípios 2022 1º turno");
  assert.equal(
    sanitizeSheetName(
      "Cruzamento com indicadores municipais e socioeconômicos do Censo",
    ).length,
    31,
  );
  assert.deepEqual(resolveSheetNames(["Trajetória", "Trajetória", "Trajetória"]), [
    "Trajetória",
    "Trajetória (2)",
    "Trajetória (3)",
  ]);
});

/* -------------------------------------------------------------------------
 * 4. Conjunto pendente não vira aba
 * ------------------------------------------------------------------------- */

test("dataset pendente não gera aba de dados — sai declarado como não gerado", () => {
  const doc = buildTrajectoryReport({
    dataset: datasetPendente(),
    overview: buildCareerOverview(datasetPendente()),
    trajectory: [],
    generatedAt: AGORA,
  });
  assert.deepEqual(doc.tables, []);
  assert.equal(doc.omitted.length, 1);
  assert.match(doc.omitted[0].reason, /gerar_dados\.sh/);
  assert.equal(hasExportableContent(doc), false);

  const plan = buildWorkbookPlan(doc);
  // Só a capa: nenhuma aba de dados foi inventada para o conjunto pendente.
  assert.equal(plan.sheets.length, 1);
  assert.equal(plan.sheets[0].kind, "capa");
  const capa = buildCoverBlocks(doc);
  const secoes = capa.filter((bloco) => bloco.kind === "secao");
  assert.ok(
    secoes.some((bloco) => bloco.kind === "secao" && bloco.text === "Conjuntos não gerados"),
  );
});

test("pleito municipal declara o ranking e o cruzamento como não gerados", () => {
  const base = dataset();
  const municipal = contest("2024-11-1", 2024, {
    officeCode: 11,
    officeName: "Prefeito",
    votosNoEstado: 168000,
    municipiosComVoto: 1,
    municipios: { "5208707": municipio("Goiânia", 168000) },
  });
  const doc = buildContestReport({
    dataset: base,
    contest: municipal,
    ranking: [],
    rankingMetric: "votos",
    scatter: null,
    generatedAt: AGORA,
  });
  assert.deepEqual(doc.tables, []);
  assert.equal(doc.omitted.length, 2);
  assert.match(doc.omitted[0].reason, /Goiânia/);
  // A régua do cartão é a da cidade, não a do estado.
  assert.equal(doc.highlights[0].label, "Votos em Goiânia");
});

/* -------------------------------------------------------------------------
 * 5. Montagem do modelo a partir do dataset sintético
 * ------------------------------------------------------------------------- */

test("relatório da trajetória monta capa, cartões e a tabela do recorte", () => {
  const base = dataset();
  const doc = buildTrajectoryReport({
    dataset: base,
    overview: buildCareerOverview(base),
    trajectory: buildTrajectory(base),
    generatedAt: AGORA,
  });
  assert.equal(doc.candidatura, "Dra. Adriana Accorsi · PT");
  assert.equal(doc.estado, "Goiás");
  assert.equal(doc.tables.length, 1);

  const tabela = doc.tables[0];
  assert.deepEqual(
    tabela.columns.map((coluna) => coluna.header),
    [
      "Ano",
      "Cargo",
      "Turno",
      "Partido",
      "Resultado",
      "Votos no estado",
      "Municípios com voto",
    ],
  );
  // Ordem cronológica e nenhuma linha de total: votos de eleições diferentes
  // não se somam.
  assert.deepEqual(tabela.rows[0][0], 2018);
  assert.deepEqual(tabela.rows[1][0], 2022);
  assert.equal(tabela.rows.length, 2);

  const capa = buildCoverBlocks(doc);
  const procedencia = capa.find(
    (bloco) =>
      bloco.kind === "tabela" && bloco.headers[0] === "Aba",
  );
  assert.ok(procedencia && procedencia.kind === "tabela");
  if (procedencia.kind !== "tabela") return;
  assert.deepEqual(procedencia.rows[0], [
    "Trajetória",
    "Trajetória",
    "TSE · Resultados por município",
    "Votação nominal por município · 2018, 2022",
    "https://dadosabertos.tse.jus.br/",
  ]);
});

test("ranking mantém ausências vazias e leva as colunas técnicas só ao Excel", () => {
  const rows: CandidateRankingRow[] = [
    {
      ibgeCode: "5208707",
      nome: "Goiânia",
      votos: 40000,
      value: 40000,
      posicaoNoMunicipio: 2,
      eleitorado: 1100000,
    },
    {
      ibgeCode: "5212501",
      nome: "Luziânia",
      votos: 4000,
      value: 4000,
      // Sem colocação apurada e sem eleitorado: as duas células ficam VAZIAS.
      posicaoNoMunicipio: null,
      eleitorado: null,
    },
  ];
  const tabela = buildRankingTable(dataset(), contest("2022-6-1", 2022), "votos", rows);
  assert.deepEqual(tabela.rows[1], [2, "Luziânia", "5212501", 4000, null, null]);
  const colunasPdf = getPdfColumns(tabela).map((coluna) => coluna.header);
  // "Votos absolutos" não repete a coluna de votos; nada de duas "Votos".
  // O código IBGE fica só na planilha: o PDF é documento de leitura.
  assert.deepEqual(colunasPdf, [
    "Posição",
    "Município",
    "Votos",
    "Posição no município",
    "Eleitorado do município",
  ]);

  // Com a métrica de densidade a coluna extra aparece, com as casas declaradas.
  const porMil = buildRankingTable(
    dataset(),
    contest("2022-6-1", 2022),
    "votosPorMilEleitores",
    rows.map((row) => ({ ...row, value: 36.4 })),
  );
  assert.deepEqual(getPdfColumns(porMil).map((coluna) => coluna.header), [
    "Posição",
    "Município",
    "Votos",
    "Votos por 1.000 eleitores",
    "Posição no município",
    "Eleitorado do município",
  ]);
  // As técnicas continuam existindo — no Excel.
  assert.ok(
    tabela.columns.some((coluna) => coluna.header === "Código IBGE" && coluna.pdfHidden),
  );
});

test("cruzamento conta as exclusões e carrega o aviso da falácia ecológica", () => {
  const scatter: ScatterModel = {
    indicator: getStatsIndicator("female"),
    points: [
      {
        ibgeCode: "5208707",
        nome: "Goiânia",
        x: 52.4,
        indicadorValor: 52.4,
        y: 12.35,
        votos: 40000,
      },
    ],
    semIndicador: 3,
    semPercentual: 2,
    pearson: null,
    amostraInsuficiente: true,
  };
  const tabela = buildScatterTable(contest("2022-6-1", 2022), scatter);
  assert.equal(tabela.rows.length, 1);
  assert.deepEqual(tabela.rows[0], ["Goiânia", "5208707", 40000, 12.35, 52.4]);
  const notas = (tabela.notes ?? []).join(" ");
  assert.match(notas, /5 municípios ficaram fora/);
  assert.match(notas, /não prova que as mulheres votaram mais nela/);
  assert.match(notas, /amostra|mínimo/i);
});

test("crescimento deixa vazio o pleito sem apuração do recorte", () => {
  const base = dataset();
  base.contests[0].bairros = null;
  const model = buildGrowthModel(base, "federaisEstaduais", ["ibge:5212501"]);
  assert.ok(model);
  if (!model) return;
  const doc = buildGrowthReport({
    dataset: base,
    grupo: "federaisEstaduais",
    model,
    generatedAt: AGORA,
  });
  const tabela = doc.tables[0];
  const colunaVotos = tabela.columns.findIndex(
    (coluna) => coluna.header === "Votos",
  );
  const colunaVariacao = tabela.columns.findIndex((coluna) =>
    coluna.header.startsWith("Variação"),
  );
  // Primeira linha de cada série não tem pleito anterior: variação VAZIA, não 0.
  assert.equal(tabela.rows[0][colunaVariacao], null);
  assert.equal(typeof tabela.rows[0][colunaVotos], "number");
  assert.equal(
    buildReportFilename(doc, "xlsx"),
    "relatorio-crescimento-adriana-accorsi-federais-estaduais-2026-08-17.xlsx",
  );
});

/* -------------------------------------------------------------------------
 * 6. Larguras e texto do PDF
 * ------------------------------------------------------------------------- */

test("largura da coluna acompanha o conteúdo já formatado", () => {
  const table: ReportTable = {
    id: "t",
    title: "T",
    columns: [
      { header: "UF", format: "texto" },
      { header: "Votos", format: "inteiro" },
    ],
    rows: [["Aparecida de Goiânia", 1234567]],
    source: { label: "TSE" },
  };
  const [largaUf, largaVotos] = computeColumnWidths(table);
  // "Aparecida de Goiânia" (20) + folga; "1.234.567" (9) fica no piso.
  assert.ok(largaUf >= 22, `esperava >= 22, veio ${largaUf}`);
  assert.equal(largaVotos, 11);
});

test("texto do PDF preserva a acentuação e transcreve o que a fonte não tem", () => {
  assert.equal(
    toPdfText("Goiânia · Anápolis · Luziânia — eleição, índice, ação"),
    "Goiânia · Anápolis · Luziânia — eleição, índice, ação",
  );
  // A seta não existe em cp1252 e sairia como lixo no PDF.
  assert.equal(toPdfText("2016 → 2020"), "2016 -> 2020");
  assert.equal(toPdfText("índice 0–10 “aspas”"), "índice 0–10 “aspas”");
});

/* -------------------------------------------------------------------------
 * 7. Documento vazio não vira arquivo
 * ------------------------------------------------------------------------- */

test("documento sem nenhuma linha não é exportável", () => {
  const doc: ReportDocument = {
    filenameBase: "vazio",
    title: "T",
    subtitle: "S",
    scope: "R",
    candidatura: "C",
    estado: "Goiás",
    generatedAt: AGORA,
    highlights: [],
    tables: [
      {
        id: "t",
        title: "T",
        columns: [{ header: "A", format: "texto" }],
        rows: [],
        source: { label: "TSE" },
      },
    ],
    omitted: [],
    images: [],
    attribution: "A",
  };
  assert.equal(hasExportableContent(doc), false);
});
