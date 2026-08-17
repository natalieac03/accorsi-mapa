/**
 * Gerador de EXEMPLOS dos arquivos de exportação, para inspeção humana.
 *
 * Roda com:
 *   node --experimental-strip-types scripts/dev/gerar-exemplos-export.ts
 *
 * Os dados são SINTÉTICOS e inline — não lê `src/data`, que nesta instalação
 * ainda é placeholder. Depois de escrever os arquivos, relê o .xlsx com o
 * próprio exceljs e confere célula a célula (ausência vazia, formato, painel
 * congelado, autofiltro); do PDF, confere a contagem de páginas. A extração de
 * texto acentuado fica por conta do `pdftotext`, chamado por fora.
 *
 * Não faz parte do `npm test` de propósito: escreve arquivos em disco.
 */

import { mkdir, writeFile } from "node:fs/promises";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
  StatsIndicatorSource,
} from "../../src/types/candidate.ts";
import type { MunicipalityProfile } from "../../src/types/electorate.ts";
import { buildAnalysisModel } from "../../src/utils/analysis.ts";
import { buildAnalysisReport } from "../../src/utils/reportLayers.ts";
import { buildTrajectory } from "../../src/utils/candidate.ts";
import {
  buildCareerOverview,
  buildGrowthModel,
} from "../../src/utils/candidateStats.ts";
import { buildReportDataset } from "../../src/utils/reportDataset.ts";
import { buildWorkbookBuffer } from "../../src/utils/exportExcel.ts";
import { buildPdfBuffer, renderReportPdf } from "../../src/utils/exportPdf.ts";
import { buildReportFilename } from "../../src/utils/reportModel.ts";
import {
  buildContestReport,
  buildGrowthReport,
  buildTrajectoryReport,
} from "../../src/utils/reportStats.ts";

const DESTINO = "/tmp/exemplos";
const AGORA = new Date("2026-08-17T17:32:00Z");

/* Municípios reais de Goiás com números inventados: o que se verifica aqui é
   a acentuação e a formatação, não a apuração. */
const CIDADES: Array<[string, string, number]> = [
  ["5208707", "Goiânia", 41250],
  ["5201405", "Anápolis", 12480],
  ["5212501", "Luziânia", 4310],
  ["5201108", "Aparecida de Goiânia", 9875],
  ["5218805", "Rio Verde", 3640],
  ["5205109", "Catalão", 2115],
  ["5222005", "Trindade", 1980],
  ["5208004", "Formosa", 1755],
  ["5209101", "Goiás", 640],
  ["5218003", "Quirinópolis", 512],
  ["5204508", "Ceres", 388],
  ["5219209", "Santo Antônio do Descoberto", 275],
];

function municipio(
  nome: string,
  votos: number,
  overrides: Partial<CandidateMunicipio> = {},
): CandidateMunicipio {
  return {
    nome,
    votos,
    validos: votos * 8,
    percentualValidos: Math.round((votos / (votos * 8)) * 10000) / 100,
    votosDoPartido: votos * 2,
    percentualDoPartido: 50,
    posicaoNoMunicipio: 2,
    candidaturasComVoto: 148,
    ...overrides,
  };
}

function contest(
  id: string,
  ano: number,
  votos: number,
  overrides: Partial<CandidateContest> = {},
): CandidateContest {
  const municipios: Record<string, CandidateMunicipio> = {};
  CIDADES.forEach(([ibge, nome, base], indice) => {
    const votosCidade = Math.round(base * (votos / 96000));
    municipios[ibge] = municipio(
      nome,
      votosCidade,
      // Duas cidades entram SEM denominador apurado, de propósito: é o caso
      // que precisa sair como célula vazia e travessão, nunca como 0.
      indice % 5 === 4
        ? { percentualValidos: null, posicaoNoMunicipio: null, validos: 0 }
        : {},
    );
  });
  return {
    id,
    electionYear: ano,
    officeCode: 6,
    officeName: "Deputado Federal",
    round: 1,
    candidatura: {
      sqCandidato: "520001",
      nomeCompleto: "ADRIANA ACCORSI",
      nomeUrna: "Dra. Adriana Accorsi",
      partido: "PT",
      numero: "1313",
      situacaoCandidatura: "Deferido",
      resultado: ano >= 2022 ? "Eleita por QP" : "Suplente",
    },
    votosNoEstado: votos,
    posicaoNoEstado: ano >= 2022 ? 4 : 11,
    candidaturasNoPleito: 627,
    municipiosComVoto: CIDADES.length,
    concentracaoPercentual: { top5: 71.45, top10: 88.2, top20: 96.7 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios,
    locais: null,
    bairros: null,
    ...overrides,
  };
}

const dataset: CandidateDataset = {
  metadata: {
    schemaVersion: 1,
    state: "GO",
    slug: "adriana-accorsi",
    pleitos: 3,
    anos: [2014, 2018, 2022],
    cargos: ["Deputado Federal"],
    source: "TSE · Resultados por município (dados abertos)",
    sourceUrl: "https://dadosabertos.tse.jus.br/dataset/resultados",
  },
  contests: [
    contest("2014-6-1", 2014, 48200),
    contest("2018-6-1", 2018, 71340),
    contest("2022-6-1", 2022, 96000),
  ],
};

const contestAtual = dataset.contests[2];

/* Snapshot territorial sintético para o relatório do pleito: é ele que faz o
   PDF sair com os cruzamentos de TODOS os indicadores com dado, e não só com
   o que estivesse selecionado numa tela. Duas cidades entram sem
   alfabetização apurada — o caso que precisa ficar de fora, nunca virar 0. */
const fonteIndicadores: StatsIndicatorSource = {
  electorate: {
    metadata: {},
    municipalities: Object.fromEntries(
      CIDADES.map(([ibge, nome], indice) => {
        const eleitorado = 12000 + indice * 5400;
        return [
          ibge,
          {
            name: nome,
            electorate: eleitorado,
            gender: {
              female: Math.round(eleitorado * (0.49 + indice * 0.003)),
              male: Math.round(eleitorado * 0.47),
              notInformed: 0,
            },
          },
        ];
      }),
    ),
  },
  age: { metadata: {}, municipalities: {} },
  literacy: {
    metadata: {},
    municipalities: Object.fromEntries(
      CIDADES.filter((_, indice) => indice % 6 !== 5).map(
        ([ibge], indice) => {
          const populacao = 12000 + indice * 5400;
          return [
            ibge,
            {
              literate15Plus: Math.round(populacao * (0.88 + indice * 0.007)),
              population15Plus: populacao,
              literacyRate: Math.round((88 + indice * 0.7) * 10) / 10,
            },
          ];
        },
      ),
    ),
  },
};

const reportDataset = buildReportDataset({
  contest: contestAtual,
  source: fonteIndicadores,
});

/* Camada de análise territorial: perfis sintéticos passando pelo MOTOR real
   (buildAnalysisModel), para o exemplo provar também o caminho dos painéis do
   mapa — e não só o da janela de Estatísticas. Dois municípios entram sem
   alfabetização apurada: é o caso que precisa sair de fora do quintil, nunca
   com zero. */
function perfil(
  ibge: string,
  nome: string,
  eleitorado: number,
  taxa: number | null,
): MunicipalityProfile {
  return {
    ibgeCode: ibge,
    tseCode: ibge.slice(0, 5),
    name: nome,
    electorate: eleitorado,
    stateSharePct: 0,
    stateRank: 0,
    zoneCount: 3,
    biometrics: eleitorado,
    biometricsPct: 100,
    registeredDisability: 0,
    socialName: 0,
    topAgeGroup: { label: "35 a 39 anos", electorate: 0, percentage: 0 },
    gender: {
      female: Math.round(eleitorado * 0.52),
      male: Math.round(eleitorado * 0.48),
      notInformed: 0,
    },
    socioeconomic: {
      populationEstimate: null,
      censusPopulation: null,
      populationDensity: null,
      gdpPerCapita: null,
      schoolAttendance: null,
      occupiedPopulation: null,
      formalAverageSalary: null,
      adequateSanitation: null,
      lowIncomePopulation: null,
    },
    age: null,
    literacy:
      taxa === null
        ? null
        : {
            literate15Plus: Math.round(eleitorado * (taxa / 100)),
            population15Plus: eleitorado,
            literacyRate: taxa,
          },
  };
}

const perfis = CIDADES.map(([ibge, nome], indice) =>
  perfil(
    ibge,
    nome,
    18000 + indice * 7300,
    indice % 6 === 5 ? null : Math.round((88 + indice * 0.7) * 10) / 10,
  ),
);

const analysisModel = buildAnalysisModel(
  perfis,
  {
    metricId: "literacyRate15Plus",
    activeBands: [0, 1, 2, 3, 4],
    sortDirection: "desc",
  },
  perfis.reduce((soma, item) => soma + item.electorate, 0),
);

const relatorios = [
  buildTrajectoryReport({
    dataset,
    overview: buildCareerOverview(dataset),
    trajectory: buildTrajectory(dataset),
    generatedAt: AGORA,
  }),
  buildContestReport({
    dataset,
    contest: contestAtual,
    reportDataset,
    // O destaque é o único efeito do que estava selecionado na tela.
    activeViewFilter: { featuredIndicatorId: "female" },
    generatedAt: AGORA,
  }),
  buildGrowthReport({
    dataset,
    grupo: "federaisEstaduais",
    model: buildGrowthModel(dataset, "federaisEstaduais", [
      "ibge:5208707",
      "ibge:5212501",
    ])!,
    generatedAt: AGORA,
  }),
  buildAnalysisReport({
    model: analysisModel,
    municipalityCount: CIDADES.length,
    generatedAt: AGORA,
  }),
];

await mkdir(DESTINO, { recursive: true });

for (const relatorio of relatorios) {
  const nomeXlsx = buildReportFilename(relatorio, "xlsx");
  const nomePdf = buildReportFilename(relatorio, "pdf");
  await writeFile(
    `${DESTINO}/${nomeXlsx}`,
    Buffer.from(await buildWorkbookBuffer(relatorio)),
  );
  const doc = await renderReportPdf(relatorio);
  await writeFile(
    `${DESTINO}/${nomePdf}`,
    Buffer.from(await buildPdfBuffer(relatorio)),
  );
  console.log(
    `${nomeXlsx} · ${nomePdf} (${doc.getNumberOfPages()} páginas, ${relatorio.tables.length} tabela(s))`,
  );
}

/* ----------------------------------------------------------------------- */
/* Conferência: reler o .xlsx principal e provar o que importa.             */
/* ----------------------------------------------------------------------- */

const principal = relatorios[1];
const mod = (await import("exceljs")) as unknown as {
  default?: { Workbook: new () => import("exceljs").Workbook };
  Workbook: new () => import("exceljs").Workbook;
};
const Excel = mod.default ?? mod;
const workbook = new Excel.Workbook();
await workbook.xlsx.readFile(`${DESTINO}/${buildReportFilename(principal, "xlsx")}`);

console.log("\nabas:", workbook.worksheets.map((sheet) => sheet.name).join(" | "));
for (const sheet of workbook.worksheets.slice(1)) {
  const cabecalho = sheet.getRow(1);
  console.log(
    `\naba "${sheet.name}": ${sheet.rowCount - 1} linhas · congelado=${JSON.stringify(
      sheet.views[0],
    )} · autofiltro=${JSON.stringify(sheet.autoFilter)}`,
  );
  console.log(
    "  cabeçalho:",
    (cabecalho.values as unknown[]).slice(1).join(" | "),
  );
  console.log(
    "  fundo do cabeçalho:",
    JSON.stringify(cabecalho.getCell(1).fill),
    "negrito:",
    cabecalho.getCell(1).font?.bold,
  );
  console.log(
    "  larguras:",
    sheet.columns.map((coluna) => coluna.width).join(", "),
  );
  for (let linha = 2; linha <= Math.min(sheet.rowCount, 8); linha += 1) {
    const row = sheet.getRow(linha);
    const celulas = (row.values as unknown[])
      .slice(1, sheet.columnCount + 1)
      .map((valor, indice) => {
        const cell = row.getCell(indice + 1);
        const formato = cell.numFmt ? ` [${cell.numFmt}]` : "";
        return valor === null || valor === undefined
          ? "(vazio)"
          : `${String(valor)}${formato}`;
      });
    console.log(`  linha ${linha}:`, celulas.join(" | "));
  }
}
