/**
 * Gerador dos RELATÓRIOS EM PDF para inspeção humana.
 *
 * Roda com:
 *   node --experimental-strip-types scripts/dev/gerar-relatorios-pdf.ts
 *
 * Escreve em /tmp/relatorios três documentos do MESMO pleito, mudando apenas o
 * que estava selecionado na tela quando o relatório foi pedido:
 *
 *   1. sem filtro nenhum;
 *   2. com "Mulheres no cadastro" em destaque;
 *   3. com "Penetração eleitoral" em destaque;
 *
 * e um quarto com o anexo municipal LIGADO, para conferir a opção que sai
 * desligada por padrão. Depois compara os três: as seções de indicador têm de
 * ser as mesmas, o universo de municípios idêntico e o título igual — só a
 * ordem e o capítulo em destaque podem mudar.
 *
 * Os dados são SINTÉTICOS e inline, gerados por um LCG com semente fixa: o
 * arquivo sai idêntico a cada execução, o que torna a inspeção visual
 * comparável entre rodadas. Nenhum número aqui é apuração de ninguém.
 */

import { mkdir, writeFile } from "node:fs/promises";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
  StatsIndicatorSource,
} from "../../src/types/candidate.ts";
import type { AnalysisMetricId } from "../../src/types/analysis.ts";
import type { ReportVariant } from "../../src/utils/reportModel.ts";
import { buildReportDataset } from "../../src/utils/reportDataset.ts";
import { buildPdfBuffer, renderReportPdf } from "../../src/utils/exportPdf.ts";
import { buildWorkbookBuffer } from "../../src/utils/exportExcel.ts";
import { buildReportFilename } from "../../src/utils/reportModel.ts";
import { buildContestReport } from "../../src/utils/reportStats.ts";

/* A pasta de saída pode vir no argumento, para gerar duas rodadas lado a lado
   sem uma sobrescrever a outra. */
const DESTINO = process.argv[2] ?? "/tmp/relatorios";
const AGORA = new Date("2026-08-17T17:32:00Z");

/* Gerador determinístico: mesma semente, mesmo arquivo, toda execução. */
let semente = 20260817;
function aleatorio() {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
}

/** Municípios de Goiás — nomes reais, números inventados. */
const NOMES = [
  "Goiânia", "Aparecida de Goiânia", "Anápolis", "Rio Verde", "Luziânia",
  "Águas Lindas de Goiás", "Valparaíso de Goiás", "Trindade", "Formosa",
  "Novo Gama", "Itumbiara", "Senador Canedo", "Catalão", "Jataí",
  "Planaltina", "Caldas Novas", "Santo Antônio do Descoberto", "Goianésia",
  "Cidade Ocidental", "Mineiros", "Cristalina", "Inhumas", "Quirinópolis",
  "Porangatu", "Jaraguá", "Morrinhos", "Ceres", "Goiatuba", "Uruaçu",
  "Iporá", "Nerópolis", "Bom Jesus de Goiás", "Pires do Rio", "Itaberaí",
  "Silvânia", "Palmeiras de Goiás", "São Luís de Montes Belos", "Goiás",
  "Piracanjuba", "Rubiataba", "Anicuns", "Acreúna", "Cachoeira Alta",
  "Campos Belos", "Alexânia", "Padre Bernardo", "Posse", "Itapuranga",
  "Nova Crixás", "Buriti Alegre", "Aruanã", "Bela Vista de Goiás",
  "Hidrolândia", "Aragarças", "Baliza", "Britânia", "Cabeceiras",
  "Caiapônia", "Campinorte", "Carmo do Rio Verde", "Cezarina",
  "Corumbaíba", "Cromínia", "Damolândia", "Edealina", "Faina",
  "Firminópolis", "Guapó", "Ipameri", "Israelândia",
];

type Cidade = {
  ibge: string;
  nome: string;
  eleitorado: number;
  votos: number;
  validos: number;
  posicao: number | null;
  /** Alguns municípios entram sem alfabetização/socioeconômico apurado. */
  temLiteracia: boolean;
  temSocioeconomico: boolean;
  temIdade: boolean;
};

const CIDADES: Cidade[] = NOMES.map((nome, indice) => {
  // Eleitorado com cauda longa, como um estado real: uma capital, algumas
  // cidades médias e dezenas de municípios pequenos.
  const eleitorado = Math.round(
    900_000 * Math.exp(-indice / 7) + 2_400 + aleatorio() * 6_000,
  );
  const validos = Math.round(eleitorado * (0.74 + aleatorio() * 0.08));
  // A votação acompanha o eleitorado, com desempenho relativo variando entre
  // ~1% e ~9% dos válidos — e o desempenho cresce um pouco onde o eleitorado
  // feminino é maior, para os cruzamentos terem o que mostrar.
  const desempenho = 1.2 + (indice % 11) * 0.55 + aleatorio() * 1.6;
  return {
    ibge: `52${String(1000 + indice * 7).padStart(5, "0")}`,
    nome,
    eleitorado,
    votos: Math.max(1, Math.round((validos * desempenho) / 100)),
    // Um em cada onze municípios sem total de válidos apurado: é o caso que
    // precisa sair do universo analítico contado, e nunca valendo zero.
    validos: indice % 11 === 5 ? 0 : validos,
    posicao: indice % 13 === 7 ? null : 1 + (indice % 9),
    temLiteracia: indice % 9 !== 4,
    temSocioeconomico: indice % 17 !== 3,
    temIdade: indice % 23 !== 6,
  };
});

function municipio(cidade: Cidade): CandidateMunicipio {
  return {
    nome: cidade.nome,
    votos: cidade.votos,
    validos: cidade.validos,
    percentualValidos:
      cidade.validos > 0
        ? Math.round((cidade.votos / cidade.validos) * 10000) / 100
        : null,
    votosDoPartido: Math.round(cidade.votos * 2.4),
    percentualDoPartido:
      cidade.validos > 0
        ? Math.round((cidade.votos * 2.4 * 10000) / cidade.validos) / 100
        : null,
    posicaoNoMunicipio: cidade.validos > 0 ? cidade.posicao : null,
    candidaturasComVoto: 148,
  };
}

const votosNoEstado = CIDADES.reduce((soma, cidade) => soma + cidade.votos, 0);

const contestAtual: CandidateContest = {
  id: "2022-6-1",
  electionYear: 2022,
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
    resultado: "Eleita por QP",
  },
  votosNoEstado,
  posicaoNoEstado: 4,
  candidaturasNoPleito: 627,
  municipiosComVoto: CIDADES.length,
  concentracaoPercentual: { top5: 0, top10: 0, top20: 0 },
  votosSemLocalDeVotacao: 0,
  temRecorteSubmunicipal: false,
  municipios: Object.fromEntries(
    CIDADES.map((cidade) => [cidade.ibge, municipio(cidade)]),
  ),
  locais: null,
  bairros: null,
};

const dataset: CandidateDataset = {
  metadata: {
    schemaVersion: 1,
    state: "GO",
    slug: "adriana-accorsi",
    pleitos: 1,
    anos: [2022],
    cargos: ["Deputado Federal"],
    source: "TSE · Resultados por município (dados abertos)",
    sourceUrl: "https://dadosabertos.tse.jus.br/dataset/resultados",
  },
  contests: [contestAtual],
};

const fonteIndicadores: StatsIndicatorSource = {
  electorate: {
    metadata: {},
    municipalities: Object.fromEntries(
      CIDADES.map((cidade, indice) => [
        cidade.ibge,
        {
          name: cidade.nome,
          electorate: cidade.eleitorado,
          zoneCount: 1 + Math.floor(cidade.eleitorado / 90_000),
          biometricsPct: Math.round((88 + aleatorio() * 11) * 10) / 10,
          registeredDisability: Math.round(cidade.eleitorado * 0.004),
          socialName: indice % 5,
          gender: {
            female: Math.round(
              cidade.eleitorado * (0.485 + (indice % 11) * 0.006),
            ),
            male: Math.round(cidade.eleitorado * 0.48),
            notInformed: 2,
          },
        },
      ]),
    ),
  },
  age: {
    metadata: {},
    municipalities: Object.fromEntries(
      CIDADES.filter((cidade) => cidade.temIdade).map((cidade, indice) => {
        const populacao16 = Math.round(cidade.eleitorado * (0.86 + aleatorio() * 0.2));
        return [
          cidade.ibge,
          {
            populationTotal: Math.round(populacao16 * 1.32),
            population16Plus: populacao16,
            bands: {
              a16to17: Math.round(populacao16 * 0.035),
              a18to24: Math.round(populacao16 * (0.11 + (indice % 7) * 0.004)),
              a25to39: Math.round(populacao16 * 0.31),
              a40to59: Math.round(populacao16 * 0.34),
              a60plus: Math.round(populacao16 * (0.16 + (indice % 9) * 0.005)),
            },
          },
        ];
      }),
    ),
  },
  literacy: {
    metadata: {},
    municipalities: Object.fromEntries(
      CIDADES.filter((cidade) => cidade.temLiteracia).map((cidade, indice) => {
        const populacao15 = Math.round(cidade.eleitorado * 1.05);
        const taxa = Math.round((86 + (indice % 13) * 0.9 + aleatorio()) * 10) / 10;
        return [
          cidade.ibge,
          {
            literate15Plus: Math.round(populacao15 * (taxa / 100)),
            population15Plus: populacao15,
            literacyRate: taxa,
          },
        ];
      }),
    ),
  },
  socioeconomic: {
    metadata: {},
    municipalities: Object.fromEntries(
      CIDADES.filter((cidade) => cidade.temSocioeconomico).map(
        (cidade, indice) => {
          const populacao = Math.round(cidade.eleitorado * 1.28);
          return [
            cidade.ibge,
            {
              values: {
                populationEstimate: populacao,
                censusPopulation: Math.round(populacao * 0.97),
                populationDensity:
                  Math.round((0.9 + (indice % 19) * 12 + aleatorio() * 30) * 10) / 10,
                gdpPerCapita:
                  Math.round(11_000 + (indice % 23) * 4_800 + aleatorio() * 9_000),
                schoolAttendance:
                  Math.round((95.2 + (indice % 8) * 0.5 + aleatorio()) * 10) / 10,
                occupiedPopulation:
                  Math.round((18 + (indice % 15) * 1.4) * 10) / 10,
                formalAverageSalary:
                  Math.round((1.5 + (indice % 17) * 0.14 + aleatorio() * 0.3) * 100) / 100,
                adequateSanitation:
                  Math.round((12 + (indice % 21) * 4 + aleatorio() * 6) * 10) / 10,
                lowIncomePopulation:
                  Math.round((16 + (indice % 25) * 1.8 + aleatorio() * 4) * 10) / 10,
              },
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

type Variante = {
  arquivo: string;
  rotulo: string;
  featured: AnalysisMetricId | null;
  anexo: boolean;
  versao: ReportVariant;
};

const VARIANTES: Variante[] = [
  { arquivo: "1-sem-filtro", rotulo: "sem filtro", featured: null, anexo: false, versao: "completo" },
  { arquivo: "2-mulheres", rotulo: "filtro: Mulheres", featured: "female", anexo: false, versao: "completo" },
  {
    arquivo: "3-penetracao",
    rotulo: "filtro: Penetração eleitoral",
    featured: "electoralPenetration",
    anexo: false,
    versao: "completo",
  },
  {
    arquivo: "4-sem-filtro-com-anexo",
    rotulo: "sem filtro · anexo municipal LIGADO",
    featured: null,
    anexo: true,
    versao: "completo",
  },
  /* As mesmas três seleções na VERSÃO RESUMIDA — o mesmo recorte, o mesmo
     dado, o mesmo dia: é a comparação que a inspeção visual precisa. */
  {
    arquivo: "5-resumido-sem-filtro",
    rotulo: "RESUMIDO · sem filtro",
    featured: null,
    anexo: false,
    versao: "resumido",
  },
  {
    arquivo: "6-resumido-mulheres",
    rotulo: "RESUMIDO · filtro: Mulheres",
    featured: "female",
    anexo: false,
    versao: "resumido",
  },
  {
    arquivo: "7-resumido-penetracao",
    rotulo: "RESUMIDO · filtro: Penetração eleitoral",
    featured: "electoralPenetration",
    anexo: false,
    versao: "resumido",
  },
];

await mkdir(DESTINO, { recursive: true });

const gerados: Array<{
  variante: Variante;
  secoes: string[];
  indicadores: string[];
  titulo: string;
  municipios: number;
  analiticos: number;
  paginas: number;
  caminho: string;
}> = [];

for (const variante of VARIANTES) {
  const relatorio = buildContestReport({
    dataset,
    contest: contestAtual,
    reportDataset,
    activeViewFilter: variante.featured
      ? { featuredIndicatorId: variante.featured }
      : null,
    generatedAt: AGORA,
    variante: variante.versao,
  });
  const caminho = `${DESTINO}/${variante.arquivo}.pdf`;
  const doc = await renderReportPdf(relatorio, {
    incluirAnexoMunicipal: variante.anexo,
  });
  await writeFile(
    caminho,
    Buffer.from(
      await buildPdfBuffer(relatorio, { incluirAnexoMunicipal: variante.anexo }),
    ),
  );
  const secoes = (relatorio.sections ?? []).map((secao) => secao.id);
  gerados.push({
    variante,
    secoes,
    indicadores: secoes.filter((id) => id.startsWith("indicador-")),
    titulo: relatorio.title,
    municipios: reportDataset.municipios.length,
    analiticos: reportDataset.analiticos.length,
    paginas: doc.getNumberOfPages(),
    caminho,
  });
  console.log(
    `${caminho} · ${doc.getNumberOfPages()} páginas · ${secoes.length} seções · ${variante.rotulo}`,
  );
}

/* A pasta de trabalho do mesmo recorte, para conferir que o Excel continua
   íntegro depois da reestruturação do PDF. */
const paraExcel = buildContestReport({
  dataset,
  contest: contestAtual,
  reportDataset,
  activeViewFilter: { featuredIndicatorId: "female" },
  generatedAt: AGORA,
});
await writeFile(
  `${DESTINO}/${buildReportFilename(paraExcel, "xlsx")}`,
  Buffer.from(await buildWorkbookBuffer(paraExcel)),
);

/* ----------------------------------------------------------------------- */
/* Conferência entre as variantes                                          */
/* ----------------------------------------------------------------------- */

const completos = gerados.filter((item) => item.variante.versao === "completo");
const resumidos = gerados.filter((item) => item.variante.versao === "resumido");
const [semFiltro, mulheres, penetracao] = completos;

console.log("\n--- conferência ---");
console.log("título igual em todos:", new Set(gerados.map((g) => g.titulo)).size === 1);
console.log("título:", semFiltro.titulo);
console.log(
  "mesmo conjunto de seções de indicador:",
  [mulheres, penetracao].every(
    (item) =>
      JSON.stringify([...item.indicadores].sort()) ===
      JSON.stringify([...semFiltro.indicadores].sort()),
  ),
  `(${semFiltro.indicadores.length} indicadores)`,
);
console.log(
  "universo municipal idêntico:",
  new Set(gerados.map((g) => `${g.municipios}/${g.analiticos}`)).size === 1,
  `(${semFiltro.municipios} municípios, ${semFiltro.analiticos} analíticos)`,
);
console.log("primeira seção de indicador — sem filtro:", semFiltro.indicadores[0]);
console.log("primeira seção de indicador — mulheres:", mulheres.indicadores[0]);
console.log("primeira seção de indicador — penetração:", penetracao.indicadores[0]);
console.log(
  "páginas:",
  gerados.map((g) => `${g.variante.arquivo}=${g.paginas}`).join(" · "),
);
console.log("\nseções (completo, sem filtro):", semFiltro.secoes.join(" | "));

console.log("\n--- versão resumida ---");
console.log(
  "resumida sempre com MENOS páginas e MENOS seções que a completa:",
  resumidos.every(
    (curto) =>
      curto.paginas < semFiltro.paginas && curto.secoes.length < semFiltro.secoes.length,
  ),
);
console.log(
  "mesmo título das completas:",
  new Set([...completos, ...resumidos].map((g) => g.titulo)).size === 1,
);
console.log(
  "páginas da resumida:",
  resumidos.map((g) => `${g.variante.arquivo}=${g.paginas}`).join(" · "),
);
console.log("seções (resumido, sem filtro):", resumidos[0].secoes.join(" | "));
