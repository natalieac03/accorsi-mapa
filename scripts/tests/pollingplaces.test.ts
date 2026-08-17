import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  PollingPlace,
  PollingState,
} from "../../src/types/pollingPlaces.ts";
import type {
  PartySpectrumRegistry,
  SpectrumSourceContest,
} from "../../src/types/spectrum.ts";
import { buildPollingMapExport } from "../../src/utils/mapExport.ts";
import {
  buildPollingModel,
  createPollingCsv,
  getDefaultPollingState,
  getPollingBubbleRadius,
  getPollingContestId,
  getPollingCsvFilename,
  getPollingNeighborhoodKey,
  isPollingPlacesDatasetPending,
  parsePollingPlacesDataset,
  parsePollingVotesDataset,
  sanitizePollingState,
} from "../../src/utils/pollingPlaces.ts";
import { buildPartySpectrumIndex } from "../../src/utils/spectrum.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";

function loadJson<T>(relative: string): T {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
  ) as T;
}

const registry = loadJson<PartySpectrumRegistry>(
  "../../src/data/party-spectrum.json",
);
const index = buildPartySpectrumIndex(registry);

// Notas da onda de 2022 usadas à mão nos cálculos deste arquivo.
const PT_SCORE = 2.68;
const PL_SCORE = 8.8;

// Vereador: cargo em que o índice ideológico continua sendo a métrica da
// camada (muitas siglas na urna). A onda de 2024 é a de 2022 no registro, então
// as notas usadas à mão acima continuam valendo.
const contest: SpectrumSourceContest = {
  id: "parties:2024-13-1",
  electionYear: 2024,
  round: 1,
  officeCode: 13,
  officeName: "Vereador",
  origin: "parties",
  waveYear: 2022,
  stateTotalVotes: 0,
  municipalities: {},
};

function place(overrides: Partial<PollingPlace> & { id: string }): PollingPlace {
  return {
    ibgeCode: "4314902",
    municipalityName: "Porto Alegre",
    zone: 1,
    localCode: 1015,
    name: `Local ${overrides.id}`,
    address: "Rua Exemplo, 100",
    neighborhood: "Centro Histórico",
    neighborhoodKey: "centro historico",
    cep: "90010",
    latitude: -30.03,
    longitude: -51.23,
    sectionCount: 10,
    electorate: 1000,
    ...overrides,
  };
}

// Bairro com dois locais de tamanhos MUITO diferentes: é o caso em que média
// de médias e média ponderada divergem.
const bigPlace = place({
  id: "88013-1-1015",
  name: "Escola Grande",
  electorate: 4000,
  latitude: -30.03,
  longitude: -51.23,
});
// Mesmo bairro escrito com acento e caixa diferentes, e SEM coordenada.
const smallPlace = place({
  id: "88013-1-1023",
  name: "Clube Pequeno",
  neighborhood: "CENTRO HISTÓRICO",
  neighborhoodKey: "  CENTRO  HISTÓRICO ",
  electorate: 400,
  latitude: null,
  longitude: null,
});
// Local sem nenhum voto em partido com nota.
const unscoredPlace = place({
  id: "88013-2-2001",
  name: "Ginásio Sem Nota",
  neighborhood: "Cidade Baixa",
  neighborhoodKey: "cidade baixa",
  zone: 2,
  electorate: 900,
  latitude: -30.04,
  longitude: -51.22,
});
// Outro município, para o filtro e o agregado municipal.
const otherPlace = place({
  id: "87890-3-1001",
  ibgeCode: "4305108",
  municipalityName: "Caxias do Sul",
  name: "Escola Caxias",
  neighborhood: "Centro",
  neighborhoodKey: "centro",
  electorate: 2000,
  latitude: -29.16,
  longitude: -51.17,
});

const places = [bigPlace, smallPlace, unscoredPlace, otherPlace];
const votes: Record<string, Record<string, number>> = {
  [bigPlace.id]: { PT: 900, PL: 100 },
  [smallPlace.id]: { PT: 10, PL: 90 },
  [unscoredPlace.id]: { XPTO: 400 },
  [otherPlace.id]: { PT: 200, PL: 800 },
};

function buildState(overrides: Partial<PollingState> = {}): PollingState {
  return { ...getDefaultPollingState([contest]), ...overrides };
}

function buildModel(overrides: Partial<PollingState> = {}) {
  return buildPollingModel({
    places,
    votes,
    index,
    registry,
    contest,
    state: buildState(overrides),
  });
}

test("índice do local de votação confere com a aritmética feita à mão", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildModel();
  const big = model.units.find((unit) => unit.id === bigPlace.id)!;
  // (900 × 2,68 + 100 × 8,80) / 1000 = 3,292
  assert.ok(Math.abs((big.index as number) - 3.292) < 1e-9);
  assert.equal(big.totalVotes, 1000);
  assert.equal(big.scoredVotes, 1000);
  assert.equal(big.unscoredVotes, 0);
  assert.equal(big.coveragePct, 100);
  assert.equal(big.blockSharePct.left, 90);
  assert.equal(big.blockSharePct.right, 10);
  assert.equal(big.leadingPartyCode, "PT");

  const small = model.units.find((unit) => unit.id === smallPlace.id)!;
  // (10 × 2,68 + 90 × 8,80) / 100 = 8,188
  assert.ok(Math.abs((small.index as number) - 8.188) < 1e-9);
  assert.equal(small.leadingPartyCode, "PL");

  // Votos sem nota ficam fora do numerador E do denominador do índice.
  const unscored = model.units.find((unit) => unit.id === unscoredPlace.id)!;
  assert.equal(unscored.index, null);
  assert.equal(unscored.totalVotes, 400);
  assert.equal(unscored.scoredVotes, 0);
  assert.equal(unscored.unscoredVotes, 400);
  assert.equal(unscored.coveragePct, 0);
});

test("agregação por bairro é média ponderada, não média de médias", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildModel({ viewMode: "neighborhoods" });
  const centro = model.units.find(
    (unit) => unit.id === "4314902|centro historico",
  )!;
  // Votos somados ANTES do índice: PT 910 e PL 190 em 1.100 votos.
  const weighted = (910 * PT_SCORE + 190 * PL_SCORE) / 1100;
  const meanOfMeans = (3.292 + 8.188) / 2;
  assert.ok(Math.abs((centro.index as number) - weighted) < 1e-9);
  assert.ok(Math.abs(weighted - 3.737_090_909_090_909) < 1e-9);
  // A prova: a média das médias daria 5,74 — quase dois pontos acima.
  assert.ok(Math.abs(meanOfMeans - 5.74) < 1e-9);
  assert.ok(Math.abs((centro.index as number) - meanOfMeans) > 1.5);
  assert.equal(centro.totalVotes, 1100);
  assert.equal(centro.scoredVotes, 1100);
  assert.equal(centro.placeCount, 2);
  assert.equal(centro.electorate, 4400);
  assert.equal(centro.sectionCount, 20);

  // O mesmo princípio vale para o agregado municipal e para o resumo.
  const municipality = model.municipalityAggregates.find(
    (item) => item.ibgeCode === "4314902",
  )!;
  const municipalWeighted = (910 * PT_SCORE + 190 * PL_SCORE) / 1100;
  assert.ok(Math.abs((municipality.index as number) - municipalWeighted) < 1e-9);
  assert.equal(municipality.totalVotes, 1500);
  assert.equal(municipality.scoredVotes, 1100);
  assert.equal(municipality.placeCount, 3);
});

test("local sem voto com nota fica sem índice e fora do ranking", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildModel();
  const unscored = model.units.find((unit) => unit.id === unscoredPlace.id)!;
  assert.equal(unscored.index, null);
  assert.equal(unscored.rank, 0);
  assert.equal(model.missingIndexCount, 1);
  assert.ok(!model.filteredUnits.some((unit) => unit.id === unscoredPlace.id));
  assert.ok(model.filteredUnits.every((unit) => unit.index !== null));
  // Sem índice não entra em nenhuma faixa: a soma das faixas ignora o local.
  assert.equal(
    model.bandCounts.reduce((total, count) => total + count, 0),
    model.units.length - 1,
  );
  // A bolha existe (o local tem coordenada), mas com a cor de "sem dado".
  const bubble = model.bubbles.find((item) => item.id === unscoredPlace.id)!;
  assert.equal(bubble.value, null);
  assert.equal(bubble.focused, false);
  assert.equal(bubble.color, "#788382");
});

test("local sem coordenada fica fora das bolhas e dentro do bairro", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildModel();
  assert.ok(model.units.some((unit) => unit.id === smallPlace.id));
  assert.ok(!model.bubbles.some((bubble) => bubble.id === smallPlace.id));
  assert.equal(model.placesWithoutCoordinateCount, 1);
  assert.equal(model.electorateWithoutCoordinate, 400);

  const neighborhoods = buildPollingModel({
    places,
    votes,
    index,
    registry,
    contest,
    state: buildState({ viewMode: "neighborhoods" }),
  });
  const centro = neighborhoods.units.find(
    (unit) => unit.id === "4314902|centro historico",
  )!;
  // O local sem coordenada conta no índice e no eleitorado do bairro…
  assert.equal(centro.placeCount, 2);
  assert.equal(centro.mappedPlaceCount, 1);
  // …e o centroide usa apenas os locais geocodificados.
  assert.equal(centro.latitude, -30.03);
  assert.equal(centro.longitude, -51.23);
  const bubble = neighborhoods.bubbles.find((item) => item.id === centro.id)!;
  assert.equal(bubble.kind, "neighborhood");
  assert.equal(bubble.placeCount, 2);
});

test("chave de bairro casa com acento e caixa diferentes", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(getPollingNeighborhoodKey(bigPlace), "centro historico");
  assert.equal(getPollingNeighborhoodKey(smallPlace), "centro historico");
  // Sem `neighborhoodKey` no arquivo, a chave sai do nome do bairro.
  assert.equal(
    getPollingNeighborhoodKey(
      place({ id: "x", neighborhood: "CENTRO  Histórico", neighborhoodKey: "" }),
    ),
    "centro historico",
  );
  const model = buildModel({ viewMode: "neighborhoods" });
  const ids = model.units.map((unit) => unit.id).sort();
  assert.deepEqual(ids, [
    "4305108|centro",
    "4314902|centro historico",
    "4314902|cidade baixa",
  ]);
  // Grafia de exibição: a mais frequente entre os locais do bairro; no
  // empate, a grafia do local com mais eleitores (a Escola Grande).
  const centro = model.units.find(
    (unit) => unit.id === "4314902|centro historico",
  )!;
  assert.equal(centro.neighborhood, "Centro Histórico");
});

test("filtro por município recorta unidades, bolhas e resumo", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildModel({ municipalityId: "4305108" });
  assert.equal(model.municipalityName, "Caxias do Sul");
  assert.equal(model.units.length, 1);
  assert.equal(model.bubbles.length, 1);
  assert.equal(model.summary.placeCount, 1);
  assert.equal(model.summary.electorate, 2000);
  const expected = (200 * PT_SCORE + 800 * PL_SCORE) / 1000;
  assert.ok(Math.abs((model.summary.index as number) - expected) < 1e-9);
  assert.equal(model.summary.block, "right");
  // O agregado municipal continua cobrindo todos os municípios (é o que o
  // export em PNG desenha), mesmo com o recorte ativo.
  assert.equal(model.municipalityAggregates.length, 2);
  assert.equal(model.availableMunicipalities.length, 2);
});

test("ranking ordena pelo índice e respeita as faixas em foco", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildModel();
  assert.deepEqual(
    model.filteredUnits.map((unit) => unit.id),
    [smallPlace.id, otherPlace.id, bigPlace.id],
  );
  assert.equal(model.units.find((unit) => unit.id === smallPlace.id)!.rank, 1);
  const ascending = buildModel({ sortDirection: "asc" });
  assert.deepEqual(
    ascending.filteredUnits.map((unit) => unit.id),
    [bigPlace.id, otherPlace.id, smallPlace.id],
  );
  // Uma única faixa em foco deixa as demais fora da lista, nunca zeradas.
  const single = buildModel({ activeBands: [0] });
  assert.ok(single.filteredUnits.every((unit) => unit.band === 0));
  assert.equal(single.units.length, model.units.length);
});

test("área da bolha é proporcional ao eleitorado (raio pela raiz quadrada)", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const big = getPollingBubbleRadius(10_000, 10_000, 5, 34);
  const quarter = getPollingBubbleRadius(2_500, 10_000, 5, 34);
  assert.ok(Math.abs(big - 34) < 1e-9);
  // Um quarto do eleitorado => metade do raio => um quarto da área.
  assert.ok(Math.abs(quarter - 17) < 1e-9);
  assert.ok(Math.abs(big ** 2 / quarter ** 2 - 4) < 1e-9);
  // Piso de legibilidade e ausência de eleitorado não geram raio inválido.
  assert.equal(getPollingBubbleRadius(1, 10_000, 5, 34), 5);
  assert.equal(getPollingBubbleRadius(0, 10_000, 5, 34), 5);
  assert.equal(getPollingBubbleRadius(100, 0, 5, 34), 5);
});

test("teto de bolhas tira do desenho as menores, nunca do índice", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildPollingModel({
    places,
    votes,
    index,
    registry,
    contest,
    state: buildState(),
    maxBubbles: 1,
  });
  // Três locais têm coordenada; só a maior por eleitorado é desenhada.
  assert.equal(model.bubbles.length, 1);
  assert.equal(model.bubbles[0].id, bigPlace.id);
  assert.equal(model.hiddenBubbleCount, 2);
  // Ranking, resumo e faixas seguem sobre TODAS as unidades do recorte.
  assert.equal(model.units.length, 4);
  assert.equal(model.filteredUnits.length, 3);
  assert.equal(buildModel().hiddenBubbleCount, 0);
});

test("identificador do arquivo de votos vem do pleito do espectro", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(getPollingContestId(contest), "2024-13-1");
  assert.equal(
    getPollingContestId({ ...contest, id: "parties:2024-11-1" }),
    "2024-11-1",
  );
  assert.equal(getPollingContestId({ ...contest, id: "2018-3-2" }), "2018-3-2");
});

test("estado é saneado e o padrão é locais de votação", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const fallback = getDefaultPollingState([contest]);
  assert.equal(fallback.viewMode, "places");
  assert.equal(fallback.contestId, contest.id);
  assert.equal(fallback.municipalityId, null);
  assert.deepEqual(sanitizePollingState(null, [contest]), fallback);
  assert.deepEqual(sanitizePollingState("lixo", [contest]), fallback);
  const sanitized = sanitizePollingState(
    {
      contestId: "pleito:inexistente",
      viewMode: "bairros",
      municipalityId: "43",
      activeBands: [1, 9, "x"],
      sortDirection: "asc",
    },
    [contest],
  );
  assert.equal(sanitized.contestId, contest.id);
  assert.equal(sanitized.viewMode, "places");
  assert.equal(sanitized.municipalityId, null);
  assert.deepEqual(sanitized.activeBands, [1]);
  assert.equal(sanitized.sortDirection, "asc");
  assert.equal(
    sanitizePollingState({ viewMode: "neighborhoods" }, [contest]).viewMode,
    "neighborhoods",
  );
});

test("ausência dos arquivos não quebra a camada", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(parsePollingPlacesDataset(null), null);
  assert.equal(parsePollingPlacesDataset(undefined), null);
  assert.equal(parsePollingPlacesDataset({ places: "não é lista" }), null);
  assert.equal(parsePollingVotesDataset(null), null);
  assert.equal(parsePollingVotesDataset({ votes: [] }), null);

  // Placeholder versionado no repositório: válido, vazio e marcado pendente.
  const placeholder = parsePollingPlacesDataset(
    loadJson("../../src/data/polling/places-go.json"),
  );
  assert.ok(placeholder);
  assert.equal(placeholder.places.length, 0);
  assert.equal(placeholder.metadata.status, "pendente");
  assert.equal(isPollingPlacesDatasetPending(placeholder), true);
  assert.equal(isPollingPlacesDatasetPending(null), true);

  // Sem locais e sem votos o modelo existe, zerado e sem índice — nunca joga.
  const empty = buildPollingModel({
    places: [],
    votes: null,
    index,
    registry,
    contest,
    state: buildState(),
  });
  assert.equal(empty.units.length, 0);
  assert.equal(empty.bubbles.length, 0);
  assert.equal(empty.summary.index, null);
  assert.equal(empty.summary.block, null);
  assert.equal(empty.missingIndexCount, 0);
  assert.equal(empty.waveYear, 2022);
  assert.deepEqual(empty.bandCounts, [0, 0, 0, 0, 0]);
  assert.equal(createPollingCsv(empty).trim().split("\n").length, 1);

  // Locais presentes e votos ausentes: todo local fica SEM índice, não zero.
  const withoutVotes = buildPollingModel({
    places,
    votes: null,
    index,
    registry,
    contest,
    state: buildState(),
  });
  assert.equal(withoutVotes.units.length, 4);
  assert.ok(withoutVotes.units.every((unit) => unit.index === null));
  assert.equal(withoutVotes.missingIndexCount, 4);
  assert.equal(withoutVotes.filteredUnits.length, 0);
  assert.equal(withoutVotes.summary.index, null);
});

test("leitura defensiva descarta registros fora do contrato", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const dataset = parsePollingPlacesDataset({
    metadata: { schemaVersion: 1, placeCount: 3, status: "ok" },
    places: [
      { id: "1-1-1", ibgeCode: "4314902", latitude: -30, longitude: -51 },
      { id: "sem-ibge", ibgeCode: "43" },
      { ibgeCode: "4314902" },
      "lixo",
    ],
  });
  assert.ok(dataset);
  assert.equal(dataset.places.length, 1);
  assert.equal(dataset.places[0].electorate, 0);
  assert.equal(dataset.places[0].neighborhood, "Bairro não informado");

  // Coordenada inválida vira null, jamais 0 (0,0 fica no Golfo da Guiné).
  const broken = parsePollingPlacesDataset({
    metadata: { schemaVersion: 1, placeCount: 1 },
    places: [
      {
        id: "2-2-2",
        ibgeCode: "4314902",
        latitude: "-30,03",
        longitude: null,
      },
    ],
  });
  assert.equal(broken?.places[0].latitude, null);
  assert.equal(broken?.places[0].longitude, null);

  const votesDataset = parsePollingVotesDataset({
    metadata: { contestId: "2022-1-1" },
    votes: { "1-1-1": { PT: 10, PL: "x" }, quebrado: 5 },
  });
  assert.deepEqual(votesDataset?.votes, { "1-1-1": { PT: 10 } });
  assert.equal(votesDataset?.metadata.contestId, "2022-1-1");
});

test("CSV traz uma linha por unidade em foco e índice vazio quando null", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const csv = createPollingCsv(buildModel());
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 4);
  // trim() já removeu o BOM que createCsv escreve no início do arquivo.
  assert.ok(lines[0].startsWith('"pleito";"onda_survey";"codigo_ibge"'));
  assert.ok(lines[0].includes("indice_ideologico"));
  assert.ok(lines.some((line) => line.includes("Escola Grande")));
  // O local sem índice não entra no CSV do recorte em foco.
  assert.ok(!csv.includes("Ginásio Sem Nota"));
  assert.equal(
    getPollingCsvFilename(buildModel()),
    "locais-votacao-rs-2024-13-1.csv",
  );
  assert.equal(
    getPollingCsvFilename(buildModel({ viewMode: "neighborhoods", municipalityId: "4314902" })),
    "bairros-votacao-4314902-2024-13-1.csv",
  );
  const neighborhoodCsv = createPollingCsv(
    buildModel({ viewMode: "neighborhoods" }),
  );
  assert.ok(neighborhoodCsv.split("\n")[0].includes("locais_agregados"));
});

test("export em PNG pinta o município pelo agregado dos seus locais", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const model = buildModel();
  const data = buildPollingMapExport(model);
  const portoAlegre = data.styleById.get("4314902")!;
  const weighted = (910 * PT_SCORE + 190 * PL_SCORE) / 1100;
  assert.equal(portoAlegre.name, "Porto Alegre");
  assert.ok(portoAlegre.valueLabel.startsWith("3,7"));
  assert.ok(Math.abs(weighted - 3.737_090_909_090_909) < 1e-9);
  assert.ok(data.subtitle.includes("agregado por município"));
  assert.equal(data.legend.length, 5);
  assert.equal(data.filename.endsWith(".png"), true);
});
