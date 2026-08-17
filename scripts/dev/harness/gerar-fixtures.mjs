/**
 * Gera os JSONs SINTÉTICOS do harness visual (scripts/dev/harness/fixtures).
 *
 * Uso: node scripts/dev/harness/gerar-fixtures.mjs
 *
 * Estes dados NÃO são reais e NUNCA entram no bundle de produção: o
 * vite.config.ts do harness troca os snapshots por eles APENAS quando o
 * servidor de desenvolvimento do harness roda. O build de produção
 * (npm run build na raiz) não conhece este diretório.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, "fixtures");

// Gerador determinístico (LCG) para os screenshots serem reprodutíveis.
let semente = 42;
function aleatorio() {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
}

const nomes = [
  ["5208707", "Goiânia", 1050000],
  ["5201405", "Aparecida de Goiânia", 380000],
  ["5201108", "Anápolis", 270000],
  ["5218805", "Rio Verde", 160000],
  ["5212501", "Luziânia", 130000],
  ["5201801", "Águas Lindas de Goiás", 120000],
  ["5221403", "Trindade", 90000],
  ["5219738", "Senador Canedo", 85000],
  ["5205109", "Catalão", 80000],
  ["5213103", "Jataí", 75000],
  ["5209101", "Goianésia", 45000],
  ["5219308", "Santo Antônio do Descoberto", 44000],
  ["5208608", "Goianira", 40000],
  ["5215306", "Novo Gama", 68000],
  ["5216809", "Planaltina", 60000],
  ["5218003", "Quirinópolis", 32000],
  ["5220454", "São Luís de Montes Belos", 22000],
  ["5221601", "Uruaçu", 26000],
  ["5218508", "Rialma", 8000],
  ["5220108", "São Domingos", 7500],
  ["5204904", "Ceres", 15000],
  ["5211909", "Itumbiara", 72000],
  ["5215009", "Niquelândia", 30000],
  ["5217302", "Piracanjuba", 18000],
  ["5219002", "Rubiataba", 13000],
  ["5203302", "Bela Vista de Goiás", 20000],
  ["5210000", "Inhumas", 38000],
  ["5212303", "Jussara", 14000],
  ["5205802", "Cidade Ocidental", 42000],
  ["5221007", "Três Ranchos", 2200],
  ["5200258", "Águas de São João", 3400],
  ["5219100", "Sanclerlândia", 5600],
  ["5217609", "Pirenópolis", 17000],
  ["5213509", "Itaberaí", 28000],
  ["5220280", "São João d'Aliança", 9200],
  ["5204656", "Campos Verdes", 3800],
];

// --- eleitorado + gênero (fonte dos indicadores) ---------------------------
const municipiosEleitorado = {};
for (const [ibge, nome, eleitorado] of nomes) {
  const proporcaoFeminina = 0.47 + aleatorio() * 0.08;
  const female = Math.round(eleitorado * proporcaoFeminina);
  const male = eleitorado - female - Math.round(eleitorado * 0.002);
  municipiosEleitorado[ibge] = {
    name: nome,
    electorate: eleitorado,
    gender: { female, male, notInformed: eleitorado - female - male },
  };
}

writeFileSync(
  join(destino, "electorate-go.json"),
  JSON.stringify(
    {
      metadata: {
        state: "GO",
        status: "sintetico-harness",
        year: 2026,
        source: "FIXTURE SINTÉTICA — apenas harness visual",
      },
      municipalities: municipiosEleitorado,
    },
    null,
    1,
  ),
);

// Estrutura etária e alfabetização: metadados válidos, sem municípios — o
// indicador padrão da janela (mulheres no eleitorado) não depende deles.
for (const nome of ["age-structure-go.json", "literacy-go.json"]) {
  writeFileSync(
    join(destino, nome),
    JSON.stringify(
      {
        metadata: { state: "GO", status: "sintetico-harness" },
        municipalities: {},
      },
      null,
      1,
    ),
  );
}

// --- trajetória da candidata ----------------------------------------------
function candidatura(resultado) {
  return {
    sqCandidato: "000000000000",
    nomeCompleto: "ADRIANA ACCORSI (FIXTURE)",
    nomeUrna: "Adriana Accorsi",
    partido: "PT",
    numero: "1313",
    situacaoCandidatura: "APTO",
    resultado,
  };
}

function pleitoEstadual(ano, votoBase) {
  const municipios = {};
  let total = 0;
  for (const [ibge, nome, eleitorado] of nomes) {
    const validos = Math.round(eleitorado * (0.6 + aleatorio() * 0.2));
    const proporcaoFeminina =
      municipiosEleitorado[ibge].gender.female / eleitorado;
    // Correlação de brinquedo: % dela cresce com a proporção de mulheres.
    const pct =
      Math.max(
        0.4,
        (proporcaoFeminina - 0.44) * 90 + (aleatorio() - 0.5) * 2.4,
      ) * (votoBase / 90000);
    const votos = Math.max(12, Math.round((validos * pct) / 100));
    total += votos;
    municipios[ibge] = {
      nome,
      votos,
      validos,
      percentualValidos: Math.round((votos / validos) * 10000) / 100,
      votosDoPartido: null,
      percentualDoPartido: null,
      posicaoNoMunicipio: null,
      candidaturasComVoto: 320,
    };
  }
  return {
    id: `${ano}-${ano === 2018 ? 7 : 6}-1`,
    electionYear: ano,
    officeCode: ano === 2018 ? 7 : 6,
    officeName: ano === 2018 ? "Deputada Estadual" : "Deputada Federal",
    round: 1,
    candidatura: candidatura("ELEITA"),
    votosNoEstado: total,
    posicaoNoEstado: 4,
    candidaturasNoPleito: 320,
    municipiosComVoto: nomes.length,
    concentracaoPercentual: { top5: 62.4, top10: 74.9, top20: 88.2 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios,
    locais: null,
    bairros: null,
  };
}

/* Bairros sintéticos de Goiânia: o suficiente para a visão Geral ter recorte
   para comparar. "Setor Sul" some de 2020 DE PROPÓSITO — é o caso de ausência
   (null), que a linha do gráfico precisa mostrar como buraco em vez de zero. */
const BAIRROS_FIXTURE = {
  2016: { "setor central": 4100, "setor bueno": 3050, "setor sul": 2600, "campinas": 1900 },
  2020: { "setor central": 6300, "setor bueno": 5100, "campinas": 3050 },
  2024: { "setor central": 9400, "setor bueno": 7600, "setor sul": 5200, "campinas": 4100 },
};

function pleitoMunicipal(ano, turno, votos) {
  const validos = Math.round(votos * 2.4);
  return {
    id: `${ano}-11-${turno}`,
    electionYear: ano,
    officeCode: 11,
    officeName: "Prefeita",
    round: turno,
    candidatura: candidatura(turno === 2 ? "NÃO ELEITA" : "2º TURNO"),
    votosNoEstado: votos,
    posicaoNoEstado: 2,
    candidaturasNoPleito: 8,
    municipiosComVoto: 1,
    concentracaoPercentual: { top5: 100, top10: 100, top20: 100 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: true,
    municipios: {
      "5208707": {
        nome: "Goiânia",
        votos,
        validos,
        percentualValidos: Math.round((votos / validos) * 10000) / 100,
        votosDoPartido: null,
        percentualDoPartido: null,
        posicaoNoMunicipio: 2,
        candidaturasComVoto: 8,
      },
    },
    locais: null,
    bairros: BAIRROS_FIXTURE[ano] ? { "5208707": BAIRROS_FIXTURE[ano] } : null,
  };
}

const dataset = {
  metadata: {
    schemaVersion: 1,
    state: "GO",
    slug: "adriana-accorsi",
    nomeConsultado: "FIXTURE SINTÉTICA — apenas harness visual",
    pleitos: 5,
    anos: [2016, 2018, 2020, 2022, 2024],
    cargos: ["Deputada Estadual", "Deputada Federal", "Prefeita"],
    source: "sintético",
  },
  contests: [
    pleitoEstadual(2018, 88000),
    pleitoEstadual(2022, 127000),
    pleitoMunicipal(2016, 1, 46000),
    pleitoMunicipal(2020, 1, 80000),
    pleitoMunicipal(2024, 1, 219000),
  ],
};

writeFileSync(
  join(destino, "adriana-accorsi.json"),
  JSON.stringify(dataset, null, 1),
);

console.log("fixtures sintéticas geradas em", destino);
