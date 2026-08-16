import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgeStructureDataset } from "../../src/types/ageStructure.ts";
import type { ContextoAgente, ContratoFerramentas } from "../../src/types/agent.ts";
import type { ElectionDataset } from "../../src/types/elections.ts";
import type { ElectorateDataset } from "../../src/types/electorate.ts";
import type { LiteracyDataset } from "../../src/types/literacy.ts";
import type {
  PollingPlacesDataset,
  PollingVotesDataset,
} from "../../src/types/pollingPlaces.ts";
import type { CampaignRegistrationDataset } from "../../src/types/registrations.ts";
import type { SocioeconomicDataset } from "../../src/types/socioeconomic.ts";
import type { PartySpectrumRegistry } from "../../src/types/spectrum.ts";
import {
  ALL_ANALYSIS_BANDS,
  buildAnalysisModel,
  formatAnalysisMetricValue,
  getAnalysisMetricValue,
} from "../../src/utils/analysis.ts";
import {
  criarContextoAgente,
  executarFerramenta,
  FERRAMENTAS_AGENTE,
  NOMES_FERRAMENTAS_IMPLEMENTADAS,
  resolverPleito,
} from "../../src/utils/agentTools.ts";
import { buildElectionModel } from "../../src/utils/elections.ts";
import { buildPollingModel } from "../../src/utils/pollingPlaces.ts";
import { buildSpectrumModel } from "../../src/utils/spectrum.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";

function loadJson<T>(relative: string): T {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
  ) as T;
}

/** Contexto sobre os dados REAIS de src/data, como os demais testes fazem. */
function criarContexto(extras: Partial<ContextoAgente> = {}): ContextoAgente {
  const contexto = criarContextoAgente({
    eleitorado: loadJson<ElectorateDataset>("../../src/data/electorate-go.json"),
    socioeconomico: loadJson<SocioeconomicDataset>(
      "../../src/data/socioeconomic-go.json",
    ),
    estruturaEtaria: loadJson<AgeStructureDataset>(
      "../../src/data/age-structure-go.json",
    ),
    alfabetizacao: loadJson<LiteracyDataset>("../../src/data/literacy-go.json"),
    eleicoes: loadJson<ElectionDataset>("../../src/data/election-history-go.json"),
    registroPartidos: loadJson<PartySpectrumRegistry>(
      "../../src/data/party-spectrum.json",
    ),
    cadastros: loadJson<CampaignRegistrationDataset>(
      "../../src/data/campaign-registrations-demo.json",
    ),
  });
  return { ...contexto, ...extras };
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

// ---------------------------------------------------------------------------
// Contrato compartilhado com o backend
// ---------------------------------------------------------------------------

test("contrato compartilhado é íntegro e escrito para o modelo", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const contrato = loadJson<ContratoFerramentas>("../../shared/agent-tools.json");
  assert.equal(contrato.schemaVersion, 1);
  assert.ok(contrato.tools.length >= 7);
  const nomes = new Set<string>();
  for (const ferramenta of contrato.tools) {
    assert.match(ferramenta.name, /^[a-z][a-z_]*$/, "nome deve ser snake_case");
    assert.equal(nomes.has(ferramenta.name), false, "nome duplicado");
    nomes.add(ferramenta.name);
    assert.ok(
      ferramenta.description.length >= 80,
      `${ferramenta.name}: descrição precisa dizer ao modelo quando usar e o que devolve`,
    );
    const parametros = ferramenta.parameters;
    assert.equal(parametros.type, "object");
    assert.equal(parametros.additionalProperties, false);
    assert.ok(Array.isArray(parametros.required));
    for (const [chave, propriedade] of Object.entries(
      parametros.properties ?? {},
    )) {
      assert.ok(
        (propriedade.description ?? "").length > 20,
        `${ferramenta.name}.${chave} precisa de descrição em pt-BR`,
      );
    }
    for (const obrigatorio of parametros.required ?? []) {
      assert.ok(
        parametros.properties?.[obrigatorio],
        `${ferramenta.name}: "${obrigatorio}" é obrigatório mas não está declarado`,
      );
    }
  }
});

test("toda tool declarada tem implementação no despachante e vice-versa", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  // Este teste é o que impede a divergência com o backend, que lê o MESMO
  // shared/agent-tools.json: acrescentar uma tool lá sem implementar aqui
  // (ou implementar aqui sem declarar lá) reprova a suíte.
  const contrato = loadJson<ContratoFerramentas>("../../shared/agent-tools.json");
  const declaradas = contrato.tools.map((ferramenta) => ferramenta.name).sort();
  const implementadas = [...NOMES_FERRAMENTAS_IMPLEMENTADAS].sort();
  const carregadas = FERRAMENTAS_AGENTE.map((ferramenta) => ferramenta.name).sort();
  assert.deepEqual(carregadas, declaradas, "o módulo lê o mesmo arquivo do backend");
  assert.deepEqual(implementadas, declaradas);
});

// ---------------------------------------------------------------------------
// Paridade chat ↔ mapa
// ---------------------------------------------------------------------------

test("paridade chat↔mapa: ranking_indicador repete buildAnalysisModel número a número", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  for (const indicador of ["electorate", "gdpPerCapita", "biometrics"] as const) {
    for (const ordem of ["maiores", "menores"] as const) {
      const resposta = exigirOk(
        await executarFerramenta(
          "ranking_indicador",
          { indicador, ordem, limite: 12 },
          contexto,
        ),
      );
      const modelo = buildAnalysisModel(
        contexto.municipios,
        {
          metricId: indicador,
          activeBands: [...ALL_ANALYSIS_BANDS],
          sortDirection: ordem === "menores" ? "asc" : "desc",
        },
        contexto.eleitoradoEstadual,
      );
      assert.equal(resposta.total, modelo.filteredItems.length);
      assert.equal(resposta.dados.length, 12);
      resposta.dados.forEach((linha, indice) => {
        const esperado = modelo.filteredItems[indice];
        const bruto = getAnalysisMetricValue(esperado.municipality, indicador);
        assert.equal(linha.municipio, esperado.municipality.name);
        assert.equal(linha.codigoIbge, esperado.municipality.ibgeCode);
        assert.equal(linha.posicaoRs, esperado.rank);
        assert.equal(linha.faixa, esperado.band + 1);
        // O valor da tool é o valor do mapa, só arredondado para leitura.
        assert.equal(
          linha.valor,
          Math.round((bruto as number) * 100) / 100,
          `${indicador}/${ordem}: valor divergente em ${esperado.municipality.name}`,
        );
        assert.equal(
          linha.valorFormatado,
          formatAnalysisMetricValue(indicador, bruto),
        );
      });
    }
  }
});

test("paridade chat↔mapa: espectro_municipios repete buildSpectrumModel", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const pleito = resolverPleito(contexto.pleitos, "2022 governador 1")!;
  const resposta = exigirOk(
    await executarFerramenta(
      "espectro_municipios",
      { pleito: "2022 governador 1", limite: 8 },
      contexto,
    ),
  );
  const modelo = buildSpectrumModel(
    contexto.pleitos,
    contexto.municipios,
    contexto.indicePartidos,
    {
      contestId: pleito.id,
      metricId: "index",
      comparisonContestId: null,
      bandMode: "absolute",
      activeBands: [...ALL_ANALYSIS_BANDS],
      sortDirection: "desc",
    },
  );
  const arredondar = (valor: number | null) =>
    valor === null ? null : Math.round(valor * 100) / 100;
  assert.equal(resposta.total, modelo.filteredItems.length);
  assert.equal(resposta.resumo?.indiceRs, arredondar(modelo.stateIndex));
  assert.equal(resposta.resumo?.ondaSurvey, modelo.wave.year);
  assert.equal(resposta.fonte.pleito, "2022 · Governador · 1º turno");
  resposta.dados.forEach((linha, indice) => {
    const esperado = modelo.filteredItems[indice];
    assert.equal(linha.municipio, esperado.municipality.name);
    assert.equal(linha.indice, arredondar(esperado.index));
    assert.equal(linha.coberturaPct, arredondar(esperado.coveragePct));
    assert.equal(linha.direitaPct, arredondar(esperado.blockSharePct.right));
    assert.equal(linha.votosComNota, esperado.scoredVotes);
    assert.equal(linha.posicaoRs, esperado.rank);
  });
});

test("paridade chat↔mapa: resultado_eleicao repete buildElectionModel", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = exigirOk(
    await executarFerramenta(
      "resultado_eleicao",
      { candidato: "Lula", pleito: "2022-1-2", limite: 6 },
      contexto,
    ),
  );
  const pleito = contexto.eleicoes.contests.find(
    (contest) => contest.id === "2022-1-2",
  )!;
  const candidato = pleito.candidates.find(
    (item) => item.ballotName.toLocaleLowerCase("pt-BR") === "lula",
  )!;
  const modelo = buildElectionModel(contexto.eleicoes, contexto.municipios, {
    contestId: pleito.id,
    candidateId: candidato.id,
    metricId: "share",
    comparisonContestId: pleito.id,
    comparisonCandidateId: null,
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  });
  assert.ok(modelo);
  assert.equal(resposta.resumo?.votosNoEstado, candidato.stateVotes);
  assert.equal(resposta.resumo?.municipiosVencidos, candidato.municipalitiesWon);
  resposta.dados.forEach((linha, indice) => {
    const esperado = modelo.filteredItems[indice];
    assert.equal(linha.municipio, esperado.municipality.name);
    assert.equal(linha.votos, esperado.votes);
    assert.equal(linha.votosValidosMunicipio, esperado.validVotes);
    assert.equal(linha.participacaoPct, Math.round(esperado.sharePct * 100) / 100);
    assert.equal(linha.liderouMunicipio, esperado.winner);
  });
});

// ---------------------------------------------------------------------------
// Coerência de cada ferramenta
// ---------------------------------------------------------------------------

test("ranking_indicador aceita recorte por município mantendo a posição de Goiás", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = exigirOk(
    await executarFerramenta(
      "ranking_indicador",
      {
        indicador: "electorate",
        municipios: ["Porto Alegre", "4305108", "santa maria"],
        limite: 10,
      },
      contexto,
    ),
  );
  assert.equal(resposta.total, 3);
  assert.deepEqual(
    resposta.dados.map((linha) => linha.municipio),
    ["Porto Alegre", "Caxias do Sul", "Santa Maria"],
  );
  // A posição continua sendo a estadual, não a do recorte.
  assert.equal(resposta.dados[0].posicaoRs, 1);
  assert.equal(resposta.dados[2].posicaoRs, 5);
});

test("perfil_municipio devolve eleitorado, indicadores, espectro e locais", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = exigirOk(
    await executarFerramenta("perfil_municipio", { municipio: "porto alegre" }, contexto),
  );
  assert.equal(resposta.total, 1);
  const perfil = resposta.dados[0] as Record<string, any>;
  const municipio = contexto.municipios.find(
    (item) => item.ibgeCode === "4314902",
  )!;
  assert.equal(perfil.municipio, "Porto Alegre");
  assert.equal(perfil.eleitorado.total, municipio.electorate);
  assert.equal(perfil.eleitorado.posicaoRs, municipio.stateRank);
  assert.equal(perfil.indicadores.length, 20);
  const eleitorado = perfil.indicadores.find(
    (item: { id: string }) => item.id === "electorate",
  );
  assert.equal(eleitorado.valor, municipio.electorate);
  assert.equal(eleitorado.posicaoRs, 1);
  assert.ok(perfil.espectro, "o perfil traz o índice do pleito mais recente");
  assert.equal(typeof perfil.espectro.ondaSurvey, "number");
  // Sem a camada submunicipal gerada, a contagem de locais é null com aviso.
  assert.equal(perfil.locaisVotacao, null);
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("locais de votação")),
    "a pendência dos locais precisa aparecer nos avisos",
  );
});

test("comparar_municipios põe até três municípios lado a lado", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = exigirOk(
    await executarFerramenta(
      "comparar_municipios",
      { municipios: ["Porto Alegre", "Pelotas", "Bagé"] },
      contexto,
    ),
  );
  assert.equal(resposta.total, 3);
  assert.deepEqual(
    resposta.dados.map((linha) => (linha as { municipio: string }).municipio),
    ["Porto Alegre", "Pelotas", "Bagé"],
  );
  for (const linha of resposta.dados as Array<Record<string, any>>) {
    assert.ok(linha.indicadores.length >= 10);
    assert.equal(
      linha.indicadores.find((item: { id: string }) => item.id === "electorate")
        .valor,
      contexto.municipios.find((item) => item.ibgeCode === linha.codigoIbge)!
        .electorate,
    );
  }
});

test("comparar_municipios recusa quando sobra menos de dois municípios reais", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = await executarFerramenta(
    "comparar_municipios",
    { municipios: ["Porto Alegre", "Xanadu do Sul 123"] },
    contexto,
  );
  assert.equal(resposta.ok, false);
  if (!resposta.ok) assert.match(resposta.motivo, /pelo menos 2/);
});

test("resolverPleito entende identificador e texto livre", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const contexto = criarContexto();
  assert.equal(resolverPleito(contexto.pleitos)!.id, contexto.pleitos[0].id);
  assert.equal(resolverPleito(contexto.pleitos, "2022-3-2")!.round, 2);
  assert.equal(
    resolverPleito(contexto.pleitos, "2022 governador 2º turno")!.officeName,
    "Governador",
  );
  assert.equal(resolverPleito(contexto.pleitos, "1998 prefeito"), null);
});

// ---------------------------------------------------------------------------
// Disciplina de nulos e truncamento
// ---------------------------------------------------------------------------

test("dado ausente continua null e é contado nos avisos, nunca vira zero", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  // O Censo 2022 (estrutura etária e alfabetização) ainda é placeholder: o
  // indicador não pode aparecer como 0 em lugar nenhum.
  const resposta = exigirOk(
    await executarFerramenta(
      "ranking_indicador",
      { indicador: "population16Plus", limite: 5 },
      contexto,
    ),
  );
  assert.equal(resposta.total, 0);
  assert.equal(resposta.dados.length, 0);
  assert.equal(resposta.resumo?.municipiosComDado, 0);
  assert.equal(resposta.resumo?.municipiosSemDado, contexto.municipios.length);
  assert.equal(resposta.resumo?.medianaRs, null);
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("null, nunca zero")),
    "o aviso precisa declarar a ausência de dado",
  );

  const perfil = exigirOk(
    await executarFerramenta("perfil_municipio", { municipio: "Pelotas" }, contexto),
  );
  const indicadores = (perfil.dados[0] as Record<string, any>).indicadores;
  const alfabetizacao = indicadores.find(
    (item: { id: string }) => item.id === "literacyRate15Plus",
  );
  assert.equal(alfabetizacao.valor, null);
  assert.equal(alfabetizacao.valorFormatado, "Sem dado");
  assert.equal(alfabetizacao.posicaoRs, null);
});

test("truncamento é sempre declarado nos avisos", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = exigirOk(
    await executarFerramenta(
      "ranking_indicador",
      { indicador: "electorate", limite: 3 },
      contexto,
    ),
  );
  assert.equal(resposta.dados.length, 3);
  assert.equal(resposta.total, 246);
  const aviso = resposta.avisos.find((item) => item.includes("truncado"));
  assert.ok(aviso, "truncar em silêncio é proibido");
  assert.match(aviso!, /494 ficaram de fora/);

  const completo = exigirOk(
    await executarFerramenta(
      "ranking_indicador",
      { indicador: "electorate", limite: 50 },
      contexto,
    ),
  );
  assert.equal(completo.dados.length, 50);
  assert.ok(completo.avisos.some((item) => item.includes("447 ficaram de fora")));
});

// ---------------------------------------------------------------------------
// Privacidade: k-anonimato
// ---------------------------------------------------------------------------

test("cadastros_agregados suprime todo grupo com menos de 5 cadastros", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  // Bagé tem dois bairros com 4 cadastros cada na base de demonstração.
  const resposta = exigirOk(
    await executarFerramenta(
      "cadastros_agregados",
      { agrupamento: "bairro", municipio: "Bagé" },
      contexto,
    ),
  );
  assert.equal(resposta.dados.length, 0, "nenhum grupo abaixo do limiar é exibido");
  assert.equal(resposta.resumo?.gruposSuprimidos, 2);
  assert.equal(resposta.resumo?.limiarPrivacidade, 5);
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("suprimidos por privacidade")),
    "a supressão precisa ser reportada",
  );

  const todos = exigirOk(
    await executarFerramenta(
      "cadastros_agregados",
      { agrupamento: "bairro", limite: 50 },
      contexto,
    ),
  );
  for (const linha of todos.dados as Array<{ cadastros: number }>) {
    assert.ok(linha.cadastros >= 5, "nenhuma linha pode ficar abaixo do k");
  }
  assert.equal(todos.resumo?.gruposSuprimidos, 5);
  // Nunca registro individual nem dado pessoal: só chaves agregadas.
  const chaves = new Set(todos.dados.flatMap((linha) => Object.keys(linha)));
  assert.deepEqual(
    [...chaves].sort(),
    ["bairro", "cadastros", "codigoIbge", "municipio"],
  );
});

test("cadastros_agregados por município mantém o limiar e a taxa por 10 mil", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = exigirOk(
    await executarFerramenta("cadastros_agregados", { limite: 50 }, contexto),
  );
  assert.ok(resposta.dados.length > 0);
  for (const linha of resposta.dados as Array<{
    cadastros: number;
    porDezMilEleitores: number;
    eleitorado: number;
  }>) {
    assert.ok(linha.cadastros >= 5);
    assert.equal(
      linha.porDezMilEleitores,
      Math.round((linha.cadastros / linha.eleitorado) * 10_000 * 100) / 100,
    );
  }
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("sintéticos")),
    "a base de demonstração precisa ser declarada",
  );
});

test("o limiar de privacidade nunca cai abaixo de cinco, mesmo pedido pela base", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const base = criarContexto();
  const contexto: ContextoAgente = {
    ...base,
    cadastrosMetadados: {
      ...base.cadastrosMetadados!,
      limiarPrivacidade: 1,
    },
  };
  const resposta = exigirOk(
    await executarFerramenta(
      "cadastros_agregados",
      { agrupamento: "bairro", municipio: "Erechim" },
      contexto,
    ),
  );
  assert.equal(resposta.resumo?.limiarPrivacidade, 5);
  assert.equal(resposta.dados.length, 0);
  assert.equal(resposta.resumo?.gruposSuprimidos, 2);
});

// ---------------------------------------------------------------------------
// Camada submunicipal (assíncrona e sob demanda)
// ---------------------------------------------------------------------------

const LOCAIS_FIXTURE: PollingPlacesDataset = {
  metadata: { schemaVersion: 1, state: "rs", placeCount: 3 },
  places: [
    {
      id: "88013-1-1015",
      ibgeCode: "4314902",
      municipalityName: "Porto Alegre",
      zone: 1,
      localCode: 1015,
      name: "Escola Centro",
      address: "Rua A, 1",
      neighborhood: "Centro Histórico",
      neighborhoodKey: "centro historico",
      cep: "90010",
      latitude: -30.03,
      longitude: -51.23,
      sectionCount: 10,
      electorate: 4000,
    },
    {
      id: "88013-1-1016",
      ibgeCode: "4314902",
      municipalityName: "Porto Alegre",
      zone: 1,
      localCode: 1016,
      name: "Escola Centro II",
      address: "Rua B, 2",
      neighborhood: "Centro Histórico",
      neighborhoodKey: "centro historico",
      cep: "90010",
      latitude: -30.04,
      longitude: -51.24,
      sectionCount: 5,
      electorate: 2000,
    },
    {
      id: "88013-2-2010",
      ibgeCode: "4314902",
      municipalityName: "Porto Alegre",
      zone: 2,
      localCode: 2010,
      name: "Clube Restinga",
      address: "Rua C, 3",
      neighborhood: "Restinga",
      neighborhoodKey: "restinga",
      cep: "91787",
      latitude: -30.15,
      longitude: -51.14,
      sectionCount: 8,
      electorate: 3000,
    },
  ],
};

const VOTOS_FIXTURE: PollingVotesDataset = {
  metadata: { schemaVersion: 1, contestId: "2022-1-1" },
  votes: {
    "88013-1-1015": { PT: 2000, PL: 500 },
    "88013-1-1016": { PT: 800, PL: 400 },
    "88013-2-2010": { PT: 300, PL: 1800 },
  },
};

function contextoComLocais() {
  return criarContexto({
    carregarLocais: async () => LOCAIS_FIXTURE,
    carregarVotosPorLocal: async (idPleito: string) =>
      idPleito === "2022-1-1" ? VOTOS_FIXTURE : null,
  });
}

test("espectro_submunicipal avisa quando a camada ainda não foi gerada", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = exigirOk(
    await executarFerramenta(
      "espectro_submunicipal",
      { municipio: "Porto Alegre" },
      contexto,
    ),
  );
  assert.equal(resposta.dados.length, 0);
  assert.equal(resposta.total, 0);
  assert.equal(resposta.resumo?.dadosDisponiveis, false);
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("ainda não foi gerada")),
    "a pendência precisa virar aviso, nunca erro",
  );
});

test("espectro_submunicipal avisa quando faltam os votos do pleito", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = contextoComLocais();
  const resposta = exigirOk(
    await executarFerramenta(
      "espectro_submunicipal",
      { municipio: "Porto Alegre", pleito: "2022 governador 2" },
      contexto,
    ),
  );
  assert.equal(resposta.dados.length, 0);
  assert.ok(
    resposta.avisos.some((aviso) => aviso.includes("ainda não foram gerados")),
  );
});

test("espectro_submunicipal repete buildPollingModel por bairro e por local", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = contextoComLocais();
  const pleito = contexto.pleitos.find((item) => item.id === "elections:2022-1-1")!;

  const bairros = exigirOk(
    await executarFerramenta(
      "espectro_submunicipal",
      { municipio: "4314902", unidade: "bairro", pleito: "2022-1-1" },
      contexto,
    ),
  );
  const modelo = buildPollingModel({
    places: LOCAIS_FIXTURE.places,
    votes: VOTOS_FIXTURE.votes,
    index: contexto.indicePartidos,
    registry: contexto.registroPartidos,
    contest: pleito,
    state: {
      contestId: pleito.id,
      viewMode: "neighborhoods",
      municipalityId: "4314902",
      activeBands: [...ALL_ANALYSIS_BANDS],
      sortDirection: "desc",
    },
  });
  assert.equal(bairros.total, 2);
  assert.deepEqual(
    bairros.dados.map((linha) => (linha as { nome: string }).nome),
    modelo.filteredUnits.map((unidade) => unidade.name),
  );
  // Restinga (PL dominante) vem primeiro na ordem "maiores" = mais à direita.
  assert.equal((bairros.dados[0] as { nome: string }).nome, "Restinga");
  assert.equal(
    (bairros.dados[0] as { indice: number }).indice,
    Math.round((modelo.filteredUnits[0].index as number) * 100) / 100,
  );
  assert.equal((bairros.dados[0] as { eleitores: number }).eleitores, 3000);
  assert.equal((bairros.dados[0] as { votosTotais: number }).votosTotais, 2100);
  assert.equal(
    bairros.resumo?.indiceDoMunicipio,
    Math.round((modelo.summary.index as number) * 100) / 100,
  );
  assert.ok(
    bairros.avisos.some((aviso) => aviso.includes("LOCAL onde se vota")),
    "a ressalva metodológica precisa acompanhar o recorte",
  );

  const locais = exigirOk(
    await executarFerramenta(
      "espectro_submunicipal",
      {
        municipio: "Porto Alegre",
        unidade: "local",
        pleito: "2022-1-1",
        ordem: "menores",
      },
      contexto,
    ),
  );
  assert.equal(locais.total, 3);
  // "menores" = mais à esquerda primeiro: a escola com mais PT lidera.
  assert.equal((locais.dados[0] as { nome: string }).nome, "Escola Centro");
  assert.equal((locais.dados[0] as { zonaEleitoral: number }).zonaEleitoral, 1);
  assert.ok(
    (locais.dados[0] as { indice: number }).indice <
      (locais.dados[2] as { indice: number }).indice,
  );
});

test("perfil_municipio conta os locais de votação quando a camada existe", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = contextoComLocais();
  const resposta = exigirOk(
    await executarFerramenta("perfil_municipio", { municipio: "Porto Alegre" }, contexto),
  );
  const locais = (resposta.dados[0] as Record<string, any>).locaisVotacao;
  assert.equal(locais.total, 3);
  assert.equal(locais.bairros, 2);
  assert.equal(locais.eleitoradoNosLocais, 9000);
  assert.equal(locais.secoes, 23);
});

// ---------------------------------------------------------------------------
// Despachante: argumento inválido nunca lança
// ---------------------------------------------------------------------------

test("argumento inválido devolve ok:false sem lançar", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const casos: Array<[string, unknown, RegExp]> = [
    ["ranking_indicador", {}, /indicador é obrigatório/],
    ["ranking_indicador", { indicador: "pib" }, /aceita apenas/],
    ["ranking_indicador", { indicador: "electorate", limite: 0 }, /no mínimo 1/],
    ["ranking_indicador", { indicador: "electorate", limite: 500 }, /no máximo 50/],
    ["ranking_indicador", { indicador: "electorate", limite: 3.5 }, /inteiro/],
    ["ranking_indicador", { indicador: "electorate", municipios: "Pelotas" }, /lista/],
    ["ranking_indicador", { indicador: "electorate", top: 3 }, /não é um argumento aceito/],
    ["perfil_municipio", { municipio: 42 }, /texto/],
    ["comparar_municipios", { municipios: ["Pelotas"] }, /pelo menos 2 item/],
    ["comparar_municipios", { municipios: ["a", "b", "c", "d"] }, /no máximo 3 item/],
    ["espectro_submunicipal", { unidade: "quadra" }, /obrigatório|aceita apenas/],
    ["cadastros_agregados", { agrupamento: "cep" }, /aceita apenas/],
    ["ferramenta_inexistente", {}, /Ferramenta desconhecida/],
  ];
  for (const [nome, argumentos, esperado] of casos) {
    const resposta = await executarFerramenta(nome, argumentos, contexto);
    assert.equal(resposta.ok, false, `${nome} deveria recusar ${JSON.stringify(argumentos)}`);
    if (!resposta.ok) assert.match(resposta.motivo, esperado);
  }
});

test("argumentos ausentes, nulos ou de tipo errado não derrubam o despachante", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const semArgumentos = await executarFerramenta(
    "espectro_municipios",
    undefined,
    contexto,
  );
  assert.equal(semArgumentos.ok, true, "tool sem argumento obrigatório aceita vazio");
  const listaComoArgumento = await executarFerramenta(
    "espectro_municipios",
    ["2022"],
    contexto,
  );
  assert.equal(listaComoArgumento.ok, false);
  const nulo = await executarFerramenta("perfil_municipio", null, contexto);
  assert.equal(nulo.ok, false);
  if (!nulo.ok) assert.match(nulo.motivo, /obrigatório/);
});

test("município desconhecido devolve ok:false com motivo legível", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = criarContexto();
  const resposta = await executarFerramenta(
    "perfil_municipio",
    { municipio: "Xanadu do Sul 123" },
    contexto,
  );
  assert.equal(resposta.ok, false);
  if (!resposta.ok) assert.match(resposta.motivo, /não encontrado/);

  const candidato = await executarFerramenta(
    "resultado_eleicao",
    { candidato: "Ninguém Nunca Existiu" },
    contexto,
  );
  assert.equal(candidato.ok, false);
  if (!candidato.ok) assert.match(candidato.motivo, /não encontrado/);
});

test("toda resposta ok traz fonte com recorte temporal e lista de avisos", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, async () => {
  const contexto = contextoComLocais();
  const chamadas: Array<[string, Record<string, unknown>]> = [
    ["ranking_indicador", { indicador: "gdpPerCapita", limite: 2 }],
    ["perfil_municipio", { municipio: "Canoas" }],
    ["espectro_municipios", { limite: 2 }],
    ["espectro_submunicipal", { municipio: "Porto Alegre", pleito: "2022-1-1" }],
    ["resultado_eleicao", { candidato: "13", limite: 2 }],
    ["comparar_municipios", { municipios: ["Canoas", "Gravataí"] }],
    ["cadastros_agregados", { limite: 2 }],
  ];
  for (const [nome, argumentos] of chamadas) {
    const resposta = exigirOk(await executarFerramenta(nome, argumentos, contexto));
    assert.ok(resposta.fonte.descricao.length > 10, `${nome}: fonte sem descrição`);
    assert.ok(
      resposta.fonte.ano !== undefined ||
        resposta.fonte.pleito !== undefined ||
        resposta.fonte.ondaSurvey !== undefined,
      `${nome}: fonte sem recorte temporal`,
    );
    assert.ok(Array.isArray(resposta.avisos));
    assert.ok(resposta.dados.length <= 50, `${nome}: estourou o teto de linhas`);
    assert.ok(resposta.total >= resposta.dados.length);
  }
});
