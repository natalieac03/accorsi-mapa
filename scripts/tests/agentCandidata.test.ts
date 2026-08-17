import assert from "node:assert/strict";
import test from "node:test";
import type { ContextoAgente } from "../../src/types/agent.ts";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
} from "../../src/types/candidate.ts";
import type { ElectionDataset } from "../../src/types/elections.ts";
import type { MunicipalityProfile } from "../../src/types/electorate.ts";
import type { PartySpectrumRegistry } from "../../src/types/spectrum.ts";
import type { PartySpectrumIndex } from "../../src/utils/spectrum.ts";
import {
  executarFerramenta,
  FERRAMENTAS_AGENTE,
  NOMES_FERRAMENTAS_IMPLEMENTADAS,
  resolverPleitoDaCandidata,
} from "../../src/utils/agentTools.ts";

/**
 * Ferramenta `votacao_da_candidata` — a que faltava.
 *
 * O defeito que originou este arquivo: perguntaram ao agente quais os três
 * bairros que mais votam na candidata em Goiânia; o dado estava na tela, mas
 * nenhuma ferramenta lia a trajetória dela. Sem ferramenta, o modelo INVENTOU
 * uma explicação ("os dados por bairro ainda não foram gerados"). Por isso os
 * testes daqui cobrem, com igual peso, o caminho feliz e o texto do motivo
 * quando não há dado — a mentira nasceu no motivo, não no número.
 *
 * Tudo é payload SINTÉTICO inline: nenhum destes testes é pulado, porque nada
 * aqui depende dos snapshots de src/data (que nesta instalação ainda são
 * placeholders). Os números não são de eleição nenhuma — são inventados de
 * propósito, para o teste falar só sobre o comportamento do motor.
 */

const GOIANIA = "5208707";
const ANAPOLIS = "5201108";
const APARECIDA = "5201405";
const RIO_VERDE = "5218805";

function perfil(
  ibgeCode: string,
  name: string,
  electorate: number,
): MunicipalityProfile {
  return {
    ibgeCode,
    tseCode: "",
    name,
    electorate,
    stateSharePct: 0,
    stateRank: 0,
    zoneCount: 0,
    biometrics: 0,
    biometricsPct: 0,
    registeredDisability: 0,
    socialName: 0,
    topAgeGroup: { label: "", electorate: 0, percentage: 0 },
    gender: { female: 0, male: 0, notInformed: 0 },
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
    literacy: null,
  };
}

function municipio(
  nome: string,
  votos: number,
  overrides: Partial<CandidateMunicipio> = {},
): CandidateMunicipio {
  return {
    nome,
    votos,
    validos: votos * 10,
    percentualValidos: 10,
    votosDoPartido: votos * 2,
    percentualDoPartido: 50,
    posicaoNoMunicipio: 2,
    candidaturasComVoto: 40,
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
      sqCandidato: "900001",
      nomeCompleto: "CANDIDATA SINTETICA DE TESTE",
      nomeUrna: "SINTETICA",
      partido: "PT",
      numero: "1313",
      situacaoCandidatura: "APTO",
      resultado: "ELEITO",
    },
    votosNoEstado: 0,
    posicaoNoEstado: 3,
    candidaturasNoPleito: 500,
    municipiosComVoto: 0,
    concentracaoPercentual: { top5: 70, top10: 85, top20: 95 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios: {},
    locais: null,
    bairros: null,
    ...overrides,
  };
}

/** Vereadora 2020 em Goiânia — o pleito mais antigo COM recorte de bairros. */
const CONTEST_2020 = contest("2020-13-1", 2020, {
  officeCode: 13,
  officeName: "Vereador",
  votosNoEstado: 4000,
  municipiosComVoto: 1,
  temRecorteSubmunicipal: true,
  municipios: { [GOIANIA]: municipio("Goiânia", 4000) },
  bairros: {
    [GOIANIA]: { "SETOR BUENO": 400, "SETOR CENTRAL": 500, CAMPINAS: 90 },
  },
});

/** Deputada federal 2022 — sem recorte submunicipal, e com um município sem %. */
const CONTEST_2022 = contest("2022-6-1", 2022, {
  votosNoEstado: 9000,
  municipiosComVoto: 3,
  municipios: {
    [GOIANIA]: municipio("Goiânia", 6000),
    [ANAPOLIS]: municipio("Anápolis", 2000, { percentualValidos: 20 }),
    // Sem denominador apurado: fica FORA do ranking por % dos válidos, e
    // jamais aparece com 0%.
    [RIO_VERDE]: municipio("Rio Verde", 1000, {
      validos: 0,
      percentualValidos: null,
      percentualDoPartido: null,
      votosDoPartido: null,
      posicaoNoMunicipio: null,
    }),
  },
});

/** Prefeita 2024 em Goiânia — o pleito mais recente, com bairros. */
const CONTEST_2024 = contest("2024-11-1", 2024, {
  officeCode: 11,
  officeName: "Prefeito",
  votosNoEstado: 2000,
  municipiosComVoto: 1,
  votosSemLocalDeVotacao: 7,
  temRecorteSubmunicipal: true,
  candidatura: {
    sqCandidato: "900002",
    nomeCompleto: "CANDIDATA SINTETICA DE TESTE",
    nomeUrna: "SINTETICA",
    partido: "PT",
    numero: "13",
    situacaoCandidatura: "APTO",
    resultado: "NAO ELEITO",
  },
  municipios: { [GOIANIA]: municipio("Goiânia", 2000) },
  bairros: {
    [GOIANIA]: {
      "SETOR BUENO": 900,
      "SETOR CENTRAL": 700,
      "JARDIM AMERICA": 500,
      CAMPINAS: 120,
    },
  },
});

const TRAJETORIA: CandidateDataset = {
  metadata: {
    schemaVersion: 1,
    state: "GO",
    slug: "candidata-sintetica",
    nomeConsultado: "CANDIDATA SINTETICA DE TESTE",
    pleitos: 3,
    anos: [2020, 2022, 2024],
    cargos: ["Vereador", "Deputado Federal", "Prefeito"],
    source: "TSE — payload sintético de teste",
    sourceUrl: "https://dadosabertos.tse.jus.br/",
  },
  contests: [CONTEST_2024, CONTEST_2022, CONTEST_2020],
};

const TRAJETORIA_PENDENTE: CandidateDataset = {
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

/**
 * Contexto montado à mão. A ferramenta só lê `municipios`, `indiceEleitorado` e
 * `trajetoriaCandidata`; os demais campos pertencem às outras ferramentas e
 * entram vazios — daí as conversões, que não escondem nenhum cálculo.
 */
function criarContexto(
  trajetoria: CandidateDataset | null,
  indiceEleitorado: Record<string, number> | null = {
    [GOIANIA]: 1_000_000,
    [ANAPOLIS]: 250_000,
    [APARECIDA]: 400_000,
    [RIO_VERDE]: 150_000,
  },
): ContextoAgente {
  return {
    municipios: [
      perfil(GOIANIA, "Goiânia", 1_000_000),
      perfil(ANAPOLIS, "Anápolis", 250_000),
      perfil(APARECIDA, "Aparecida de Goiânia", 400_000),
      perfil(RIO_VERDE, "Rio Verde", 150_000),
    ],
    eleitoradoEstadual: 1_800_000,
    anoEleitorado: 2026,
    fonteEleitorado: "TSE — payload sintético de teste",
    eleicoes: { metadata: {}, contests: [] } as unknown as ElectionDataset,
    registroPartidos: { metadata: {}, parties: [] } as unknown as PartySpectrumRegistry,
    indicePartidos: {
      registry: {} as PartySpectrumRegistry,
      aliasToCode: new Map(),
      scores: new Map(),
      waves: new Map(),
    } as unknown as PartySpectrumIndex,
    pleitos: [],
    trajetoriaCandidata: trajetoria,
    indiceEleitorado,
    cadastros: [],
    cadastrosMetadados: null,
  };
}

function exigirOk(resposta: Awaited<ReturnType<typeof executarFerramenta>>) {
  assert.equal(
    resposta.ok,
    true,
    resposta.ok ? "" : `esperava ok:true, veio: ${resposta.motivo}`,
  );
  if (!resposta.ok) throw new Error("inalcançável");
  return resposta;
}

function exigirErro(resposta: Awaited<ReturnType<typeof executarFerramenta>>) {
  assert.equal(resposta.ok, false, "esperava ok:false");
  if (resposta.ok) throw new Error("inalcançável");
  return resposta;
}

const chamar = (argumentos: Record<string, unknown>, contexto: ContextoAgente) =>
  executarFerramenta("votacao_da_candidata", argumentos, contexto);

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

test("votacao_da_candidata está declarada no contrato e implementada no despachante", () => {
  assert.ok(
    FERRAMENTAS_AGENTE.some((ferramenta) => ferramenta.name === "votacao_da_candidata"),
    "a tool precisa existir em shared/agent-tools.json (espelhado em backend/data/)",
  );
  assert.ok(NOMES_FERRAMENTAS_IMPLEMENTADAS.includes("votacao_da_candidata"));
});

// ---------------------------------------------------------------------------
// Bairros: a pergunta que originou a ferramenta
// ---------------------------------------------------------------------------

test("bairros de um município saem do mais votado para o menos, no pleito mais recente com recorte", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar({ recorte: "bairros", municipio: "goiania", limite: 3 }, contexto),
  );

  assert.equal(resposta.total, 4, "o total é o de bairros com voto, antes do corte");
  assert.deepEqual(resposta.dados, [
    { posicaoNoMunicipio: 1, bairro: "SETOR BUENO", votos: 900 },
    { posicaoNoMunicipio: 2, bairro: "SETOR CENTRAL", votos: 700 },
    { posicaoNoMunicipio: 3, bairro: "JARDIM AMERICA", votos: 500 },
  ]);
  // Sem pleito pedido, vale o mais recente QUE TEM bairros — não o mais
  // recente da trajetória, que pode não ter recorte submunicipal.
  assert.equal(resposta.resumo?.pleito, "2024 · Prefeito");
  assert.equal(resposta.resumo?.votosNoMunicipio, 2000);
  assert.equal(resposta.fonte.pleito, "2024 · Prefeito");
  assert.equal(resposta.fonte.ano, 2024);
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("LOCAL DE VOTAÇÃO")),
    "a ressalva metodológica do bairro precisa acompanhar o recorte",
  );
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("7 votos dela não têm")),
    "voto sem local de votação identificado precisa ser declarado",
  );
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("truncado")),
    "truncar em silêncio é proibido",
  );
});

test("bairros aceitam pleito por texto livre no feminino e ordem invertida", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar(
      { recorte: "bairros", municipio: "Goiânia", pleito: "2020 vereadora", ordem: "menores" },
      contexto,
    ),
  );
  assert.equal(resposta.resumo?.pleito, "2020 · Vereador");
  // "menores" inverte a leitura, mas a posição continua sendo a do ranking:
  // o 1º da lista é o menos votado, carimbado com a posição 3.
  assert.deepEqual(resposta.dados, [
    { posicaoNoMunicipio: 3, bairro: "CAMPINAS", votos: 90 },
    { posicaoNoMunicipio: 2, bairro: "SETOR BUENO", votos: 400 },
    { posicaoNoMunicipio: 1, bairro: "SETOR CENTRAL", votos: 500 },
  ]);
});

test("pleito sem recorte de bairros diz a verdade e lista os pleitos que têm", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar(
      { recorte: "bairros", municipio: "Goiânia", pleito: "2022 deputada federal" },
      contexto,
    ),
  );
  assert.equal(resposta.total, 0);
  assert.equal(resposta.dados.length, 0);
  assert.equal(resposta.resumo?.temVotoApurado, false);
  const motivo = resposta.avisos.at(-1) as string;
  assert.match(motivo, /não tem recorte por bairros em Goiânia/);
  assert.match(motivo, /2020 · Vereador; 2024 · Prefeito/);
});

test("município sem recorte submunicipal nenhum não vira lista vazia sem explicação", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar({ recorte: "bairros", municipio: "Anápolis" }, contexto),
  );
  assert.equal(resposta.total, 0);
  assert.match(
    resposta.avisos.at(-1) as string,
    /Nenhum pleito da trajetória .* tem recorte por bairros em Anápolis/,
  );
});

test("recorte por bairros sem município recusa em vez de escolher uma cidade sozinho", async () => {
  const resposta = exigirErro(
    await chamar({ recorte: "bairros" }, criarContexto(TRAJETORIA)),
  );
  assert.match(resposta.motivo, /precisa do argumento "municipio"/);
});

// ---------------------------------------------------------------------------
// Municípios: pleito mais recente por padrão
// ---------------------------------------------------------------------------

test("sem pleito informado, o ranking municipal usa o pleito mais recente", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(await chamar({}, contexto));
  assert.equal(resposta.resumo?.pleito, "2024 · Prefeito");
  assert.equal(resposta.resumo?.ano, 2024);
  assert.equal(resposta.resumo?.metrica, "votos");
  assert.deepEqual(
    resposta.dados.map((linha) => (linha as { municipio: string }).municipio),
    ["Goiânia"],
  );
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("eleição municipal")),
    "pleito municipal precisa avisar que a régua é a da cidade",
  );
});

test("ranking municipal de um pleito estadual ordena e carimba a posição", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar({ pleito: "2022-6-1", limite: 10 }, contexto),
  );
  assert.equal(resposta.total, 3);
  assert.deepEqual(
    resposta.dados.map((linha) => [
      (linha as { municipio: string }).municipio,
      (linha as { votos: number }).votos,
      (linha as { posicaoNoRanking: number }).posicaoNoRanking,
    ]),
    [
      ["Goiânia", 6000, 1],
      ["Anápolis", 2000, 2],
      ["Rio Verde", 1000, 3],
    ],
  );
  assert.equal(resposta.resumo?.votosNoPleito, 9000);

  const invertido = exigirOk(
    await chamar({ pleito: "2022-6-1", ordem: "menores" }, contexto),
  );
  assert.deepEqual(
    invertido.dados.map((linha) => (linha as { municipio: string }).municipio),
    ["Rio Verde", "Anápolis", "Goiânia"],
  );
});

test("município sem valor da métrica fica fora do ranking, com aviso, nunca com zero", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar({ pleito: "2022-6-1", metrica: "percentualValidos" }, contexto),
  );
  // Rio Verde não apurou válidos: sem denominador não há percentual.
  assert.equal(resposta.total, 2);
  assert.deepEqual(
    resposta.dados.map((linha) => (linha as { municipio: string }).municipio),
    ["Anápolis", "Goiânia"],
  );
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("null, nunca zero")),
    "a exclusão por ausência de dado precisa ser declarada",
  );
  for (const linha of resposta.dados as Array<{ municipio: string }>) {
    assert.notEqual(linha.municipio, "Rio Verde");
  }
});

test("a métrica por 1.000 eleitores some quando o eleitorado ainda é placeholder", async () => {
  const semEleitorado = criarContexto(TRAJETORIA, null);
  const recusa = exigirErro(
    await chamar({ pleito: "2022-6-1", metrica: "votosPorMilEleitores" }, semEleitorado),
  );
  assert.match(recusa.motivo, /snapshot do eleitorado ainda é placeholder/);
  assert.match(recusa.motivo, /gerar_dados\.sh/);

  const comEleitorado = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar({ pleito: "2022-6-1", metrica: "votosPorMilEleitores" }, comEleitorado),
  );
  // A densidade reordena o ranking: Anápolis (2.000 votos em 250 mil
  // eleitores = 8 por mil) passa à frente de Goiânia (6.000 em 1 milhão = 6
  // por mil), que lidera o voto absoluto.
  assert.deepEqual(
    resposta.dados.map((linha) => [
      (linha as { municipio: string }).municipio,
      (linha as { valor: number }).valor,
    ]),
    [
      ["Anápolis", 8],
      ["Rio Verde", 6.67],
      ["Goiânia", 6],
    ],
  );
});

// ---------------------------------------------------------------------------
// Município citado sem pleito: um destaque por universo de disputa
// ---------------------------------------------------------------------------

test("município citado sem pleito devolve a eleição mais recente de cada universo", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(await chamar({ municipio: "Goiânia" }, contexto));
  assert.equal(resposta.total, 2);
  assert.deepEqual(
    resposta.dados.map((linha) => [
      (linha as { pleitoId: string }).pleitoId,
      (linha as { universo: string }).universo,
      (linha as { votos: number }).votos,
    ]),
    [
      ["2024-11-1", "municipal", 2000],
      ["2022-6-1", "estadual/federal", 6000],
    ],
  );
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("não se somam")),
    "prefeitura e cadeira não se somam — a resposta precisa dizer isso",
  );
});

test("município sem voto apurado dela responde ausência explícita, e não zero", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const semPleito = exigirOk(
    await chamar({ municipio: "Aparecida de Goiânia" }, contexto),
  );
  assert.equal(semPleito.total, 0);
  assert.equal(semPleito.dados.length, 0);
  assert.equal(semPleito.resumo?.temVotoApurado, false);
  const motivo = semPleito.avisos.at(-1) as string;
  assert.match(motivo, /Não há votação .* apurada em Aparecida de Goiânia/);
  assert.match(motivo, /não é "zero voto"/);

  const comPleito = exigirOk(
    await chamar({ municipio: "Rio Verde", pleito: "2024-11-1" }, contexto),
  );
  assert.equal(comPleito.total, 0);
  assert.equal(comPleito.resumo?.temVotoApurado, false);
  assert.match(comPleito.avisos.at(-1) as string, /não tem votação apurada em Rio Verde/);
});

test("município com voto mas sem denominador reporta os votos em vez de sumir", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(
    await chamar(
      { municipio: "Rio Verde", pleito: "2022-6-1", metrica: "percentualValidos" },
      contexto,
    ),
  );
  assert.equal(resposta.total, 0);
  assert.match(
    resposta.avisos.at(-1) as string,
    /Rio Verde tem 1000 votos apurados .* é null ali \(falta o denominador\)/,
  );
});

// ---------------------------------------------------------------------------
// Trajetória
// ---------------------------------------------------------------------------

test("a trajetória sai em ordem cronológica, com cargo, ano, turno e resultado", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const resposta = exigirOk(await chamar({ recorte: "trajetoria" }, contexto));
  assert.equal(resposta.total, 3);
  assert.deepEqual(
    resposta.dados.map((linha) => [
      (linha as { ano: number }).ano,
      (linha as { cargo: string }).cargo,
      (linha as { turno: number }).turno,
      (linha as { votos: number }).votos,
      (linha as { resultado: string }).resultado,
    ]),
    [
      [2020, "Vereador", 1, 4000, "Eleita"],
      [2022, "Deputado Federal", 1, 9000, "Eleita"],
      [2024, "Prefeito", 1, 2000, "Não eleita"],
    ],
  );
  assert.equal(
    (resposta.dados[2] as { temRecorteDeBairros: boolean }).temRecorteDeBairros,
    true,
  );
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("não se somam")),
    "somar votos de eleições diferentes é proibido, e a resposta avisa",
  );
  assert.equal(resposta.fonte.ano, 2024);
});

// ---------------------------------------------------------------------------
// Indisponibilidade: o motivo precisa ser VERDADEIRO e específico
// ---------------------------------------------------------------------------

test("trajetória pendente devolve ok:false com o motivo real e o comando que gera", async () => {
  const resposta = exigirErro(
    await chamar({ recorte: "bairros", municipio: "Goiânia" }, criarContexto(TRAJETORIA_PENDENTE)),
  );
  assert.match(resposta.motivo, /ainda não foi gerada nesta instalação/);
  assert.match(resposta.motivo, /gerar_dados\.sh/);
  assert.match(resposta.motivo, /src\/data\/candidato/);
  // O motivo NUNCA pode afirmar que o dado não existe: ele existe no TSE, o
  // que falta é o processamento local. Foi essa troca que produziu a resposta
  // falsa que originou a ferramenta.
  assert.match(resposta.motivo, /O dado existe no TSE/);
});

test("contexto sem a trajetória não é confundido com trajetória pendente", async () => {
  const resposta = exigirErro(await chamar({}, criarContexto(null)));
  assert.match(resposta.motivo, /não foi entregue a esta sessão/);
  assert.match(resposta.motivo, /não ausência do dado no TSE/);
});

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

test("argumento inválido devolve ok:false sem lançar", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const casos: Array<[Record<string, unknown>, RegExp]> = [
    [{ recorte: "quadra" }, /aceita apenas/],
    [{ metrica: "votos_por_bairro" }, /aceita apenas/],
    [{ limite: 0 }, /no mínimo 1/],
    [{ limite: 99 }, /no máximo 50/],
    [{ municipio: 42 }, /texto/],
    [{ cidade: "Goiânia" }, /não é um argumento aceito/],
    [{ municipio: "Xanadu de Goiás 123" }, /não encontrado/],
    [{ pleito: "1998 prefeita" }, /Pleito não encontrado/],
  ];
  for (const [argumentos, esperado] of casos) {
    const resposta = await chamar(argumentos, contexto);
    assert.equal(resposta.ok, false, `deveria recusar ${JSON.stringify(argumentos)}`);
    if (!resposta.ok) assert.match(resposta.motivo, esperado);
  }
});

test("resolverPleitoDaCandidata entende id, ano, cargo no feminino e vazio", () => {
  const contests = TRAJETORIA.contests;
  assert.equal(resolverPleitoDaCandidata(contests)!.id, "2024-11-1");
  assert.equal(resolverPleitoDaCandidata(contests, "2022-6-1")!.electionYear, 2022);
  assert.equal(resolverPleitoDaCandidata(contests, "2024 prefeita")!.id, "2024-11-1");
  assert.equal(resolverPleitoDaCandidata(contests, "vereadora")!.id, "2020-13-1");
  assert.equal(resolverPleitoDaCandidata(contests, "2016 prefeita"), null);
  assert.equal(resolverPleitoDaCandidata([], "2024"), null);
});

test("toda resposta ok traz fonte com recorte temporal, avisos e teto de linhas", async () => {
  const contexto = criarContexto(TRAJETORIA);
  const chamadas: Array<Record<string, unknown>> = [
    {},
    { recorte: "trajetoria" },
    { recorte: "bairros", municipio: "Goiânia" },
    { municipio: "Goiânia" },
    { municipio: "Aparecida de Goiânia" },
    { pleito: "2022-6-1", metrica: "percentualPartido" },
  ];
  for (const argumentos of chamadas) {
    const resposta = exigirOk(await chamar(argumentos, contexto));
    assert.equal(resposta.tipo, "votacao_da_candidata");
    assert.ok(resposta.fonte.descricao.length > 10);
    assert.ok(
      resposta.fonte.ano !== undefined || resposta.fonte.pleito !== undefined,
      `${JSON.stringify(argumentos)}: fonte sem recorte temporal`,
    );
    assert.ok(Array.isArray(resposta.avisos));
    assert.ok(resposta.dados.length <= 50);
    assert.ok(resposta.total >= resposta.dados.length);
  }
});
