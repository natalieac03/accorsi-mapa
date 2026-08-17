import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
} from "../../src/types/candidate.ts";
import type {
  PollingPlace,
  PollingState,
} from "../../src/types/pollingPlaces.ts";
import type {
  PartySpectrumRegistry,
  SpectrumSourceContest,
} from "../../src/types/spectrum.ts";
import { MISSING_DATA_COLOR } from "../../src/utils/electorate.ts";
import { buildPollingMapExport } from "../../src/utils/mapExport.ts";
import {
  buildPollingModel,
  createPollingCsv,
  describePollingLayer,
  describePollingScope,
  formatPollingValue,
  getDefaultPollingState,
  getPollingCandidateAvailability,
  getPollingCsvFilename,
  getPollingMaximumValue,
  getPollingMetric,
  getPollingMetricColors,
  getPollingMetricShortLabel,
  getPollingRangeLabel,
  getPollingValueRatio,
  listPollingCandidateContests,
  POLLING_CANDIDATE_COLORS,
  sanitizePollingState,
} from "../../src/utils/pollingPlaces.ts";
import { buildPollingTable } from "../../src/utils/reportLayers.ts";
import { buildPartySpectrumIndex } from "../../src/utils/spectrum.ts";

/**
 * TERCEIRA MEDIDA DA CAMADA SUBMUNICIPAL: os votos NOMINAIS da candidata em
 * foco, local de votação a local de votação, eleição por eleição.
 *
 * A regra que estes testes existem para travar é a de AUSÊNCIA × ZERO. O ETL
 * só acumula onde ela teve voto, então local ausente do mapa `locais` pode ser
 * duas coisas incompatíveis:
 *
 *   - pleito MUNICIPAL: local na cidade que ela disputou = 0 voto DE VERDADE
 *     (ela estava naquela urna); local em qualquer outra cidade = FORA DA
 *     DISPUTA, valor null, cor de ausente, fora do ranking;
 *   - pleito ESTADUAL/FEDERAL: ela estava na urna no estado inteiro, então
 *     local ausente = 0 de verdade em qualquer cidade.
 *
 * Payload 100% sintético e inline: nunca pulado por falta de snapshot do ETL.
 * O único arquivo real lido é o registro de notas de partido, versionado.
 */
const registry = JSON.parse(
  readFileSync(
    new URL("../../src/data/party-spectrum.json", import.meta.url),
    "utf8",
  ),
) as PartySpectrumRegistry;
const index = buildPartySpectrumIndex(registry);

/** Pleito do ESPECTRO — lista completamente diferente da lista dela. */
const presidente: SpectrumSourceContest = {
  id: "elections:2022-1-1",
  electionYear: 2022,
  round: 1,
  officeCode: 1,
  officeName: "Presidente",
  origin: "candidates",
  waveYear: 2022,
  stateTotalVotes: 0,
  municipalities: {},
};

function place(overrides: Partial<PollingPlace> & { id: string }): PollingPlace {
  return {
    ibgeCode: "5208707",
    municipalityName: "Goiânia",
    zone: 1,
    localCode: 1010,
    name: `Local ${overrides.id}`,
    address: "Rua Exemplo, 100",
    neighborhood: "Setor Central",
    neighborhoodKey: "setor central",
    cep: "74000",
    latitude: -16.68,
    longitude: -49.25,
    sectionCount: 8,
    electorate: 1000,
    ...overrides,
  };
}

// Onde ela teve voto no pleito municipal.
const escola = place({
  id: "10010-1-1010",
  name: "Escola Central",
  electorate: 4000,
});
// Local da cidade dela SEM registro de voto: 0 de verdade, ela estava na urna.
const clube = place({
  id: "10010-1-1020",
  name: "Clube Sem Voto Dela",
  neighborhood: "Setor Bueno",
  neighborhoodKey: "setor bueno",
  electorate: 1200,
  latitude: -16.7,
  longitude: -49.27,
});
// Dois locais do mesmo bairro, para conferir a agregação por bairro.
const ginasio = place({
  id: "10010-2-2010",
  name: "Ginásio Oeste",
  neighborhood: "Setor Oeste",
  neighborhoodKey: "setor oeste",
  zone: 2,
  electorate: 900,
  latitude: -16.66,
  longitude: -49.28,
});
const escolaOeste = place({
  id: "10010-2-2020",
  name: "Escola Oeste",
  neighborhood: "Setor Oeste",
  neighborhoodKey: "setor oeste",
  zone: 2,
  electorate: 700,
  latitude: -16.65,
  longitude: -49.29,
});
// Local sem eleitorado cadastrado: existe taxa nenhuma para dividir.
const semEleitorado = place({
  id: "10010-3-3010",
  name: "Posto Sem Eleitorado",
  neighborhood: "Setor Norte",
  neighborhoodKey: "setor norte",
  zone: 3,
  electorate: 0,
  latitude: -16.6,
  longitude: -49.3,
});
// Outra cidade: fora da disputa MUNICIPAL dela, dentro da estadual.
const anapolis = place({
  id: "20020-3-1010",
  ibgeCode: "5201108",
  municipalityName: "Anápolis",
  name: "Escola Anápolis",
  neighborhood: "Centro",
  neighborhoodKey: "centro",
  electorate: 2000,
  latitude: -16.32,
  longitude: -48.95,
});

const places = [escola, clube, ginasio, escolaOeste, semEleitorado, anapolis];

// Votos por sigla do pleito do ESPECTRO: existem em paralelo e não têm nada a
// ver com o voto nominal dela.
const votes: Record<string, Record<string, number>> = {
  [escola.id]: { PT: 700, PL: 300 },
  [clube.id]: { PL: 500 },
  [anapolis.id]: { PT: 100, PL: 900 },
};

function municipio(overrides: Partial<CandidateMunicipio> & { nome: string }) {
  return {
    votos: 0,
    validos: 0,
    percentualValidos: null,
    votosDoPartido: null,
    percentualDoPartido: null,
    posicaoNoMunicipio: null,
    candidaturasComVoto: 0,
    ...overrides,
  } satisfies CandidateMunicipio;
}

function contest(
  overrides: Partial<CandidateContest> & { id: string },
): CandidateContest {
  return {
    electionYear: 2020,
    officeCode: 11,
    officeName: "Prefeito",
    round: 1,
    candidatura: {
      sqCandidato: "1",
      nomeCompleto: "Adriana Accorsi",
      nomeUrna: "Adriana Accorsi",
      partido: "PT",
      numero: "13",
      situacaoCandidatura: "APTO",
      resultado: "NAO ELEITO",
    },
    votosNoEstado: 0,
    posicaoNoEstado: null,
    candidaturasNoPleito: 0,
    municipiosComVoto: 1,
    concentracaoPercentual: { top5: 100, top10: 100, top20: 100 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: true,
    municipios: {},
    locais: null,
    bairros: null,
    ...overrides,
  };
}

/**
 * Pleito MUNICIPAL (Prefeita, cargo 11): ela estava na urna de Goiânia e de
 * mais nenhuma cidade. O mapa `locais` traz um id que NÃO existe no cadastro
 * de locais — o caso real de renumeração de seções entre eleições.
 */
const prefeita2020 = contest({
  id: "2020-11-1",
  electionYear: 2020,
  officeCode: 11,
  officeName: "Prefeito",
  votosNoEstado: 900,
  votosSemLocalDeVotacao: 0,
  municipios: { "5208707": municipio({ nome: "Goiânia", votos: 900 }) },
  locais: {
    [escola.id]: 500,
    [ginasio.id]: 300,
    "99999-9-9999": 100,
  },
});

/** Pleito ESTADUAL (Deputada Estadual, cargo 7): urna no estado inteiro. */
const deputada2018 = contest({
  id: "2018-7-1",
  electionYear: 2018,
  officeCode: 7,
  officeName: "Deputado Estadual",
  votosNoEstado: 600,
  votosSemLocalDeVotacao: 60,
  municipiosComVoto: 2,
  municipios: {
    "5208707": municipio({ nome: "Goiânia", votos: 420 }),
    "5201108": municipio({ nome: "Anápolis", votos: 120 }),
  },
  locais: {
    [escola.id]: 300,
    [ginasio.id]: 50,
    [escolaOeste.id]: 70,
    [anapolis.id]: 120,
  },
});

/** Ano sem cadastro de locais publicado: `locais` null, não vira mapa. */
const vereadora2016 = contest({
  id: "2016-13-1",
  electionYear: 2016,
  officeCode: 13,
  officeName: "Vereador",
  votosNoEstado: 4000,
  municipios: { "5208707": municipio({ nome: "Goiânia", votos: 4000 }) },
  temRecorteSubmunicipal: false,
  locais: null,
});

const candidata: CandidateDataset = {
  metadata: {
    schemaVersion: 1,
    state: "GO",
    slug: "adriana-accorsi",
    pleitos: 3,
    anos: [2016, 2018, 2020],
    cargos: ["Vereador", "Deputado Estadual", "Prefeito"],
  },
  contests: [prefeita2020, deputada2018, vereadora2016],
};

function buildState(overrides: Partial<PollingState> = {}): PollingState {
  return {
    ...getDefaultPollingState([presidente]),
    contestId: presidente.id,
    ...overrides,
  };
}

function buildModel(
  overrides: Partial<PollingState> = {},
  dataset: CandidateDataset | null = candidata,
) {
  return buildPollingModel({
    places,
    votes,
    index,
    registry,
    contest: presidente,
    candidate: dataset,
    state: buildState(overrides),
  });
}

const unidade = (model: ReturnType<typeof buildModel>, id: string) =>
  model.units.find((item) => item.id === id)!;

test("cada medida tem a SUA lista de pleitos, e a dela só traz anos com locais", () => {
  // A escolha do pleito dela é o que liga a medida.
  assert.equal(getPollingMetric(null), "indice");
  assert.equal(getPollingMetric("PT"), "votoPartido");
  assert.equal(getPollingMetric(null, "2020-11-1"), "votosCandidata");
  // O pleito dela tem precedência: a sigla não muda mais a medida.
  assert.equal(getPollingMetric("PT", "2020-11-1"), "votosCandidata");

  // 2016 tem `locais: null` (o TSE não publicou cadastro naquele ano) e por
  // isso não é oferecido: pleito sem recorte nunca vira mapa vazio.
  assert.deepEqual(
    listPollingCandidateContests(candidata).map((option) => option.id),
    ["2020-11-1", "2018-7-1"],
  );
  assert.deepEqual(
    listPollingCandidateContests(candidata).map((option) => option.label),
    ["2020 · Prefeita", "2018 · Deputada Estadual"],
  );
  assert.deepEqual(
    listPollingCandidateContests(candidata).map((option) => [
      option.municipal,
      option.placeCount,
      option.votes,
    ]),
    [
      [true, 3, 900],
      [false, 4, 600],
    ],
  );

  // Trocar de medida troca a lista de pleitos E o pleito rotulado no modelo.
  const comIndice = buildModel();
  assert.equal(comIndice.metric, "indice");
  assert.equal(comIndice.contestId, "2022-1-1");
  assert.equal(comIndice.candidate, null);
  // Os pleitos dela continuam listados mesmo fora da medida: é de lá que o
  // alternador tira a terceira opção.
  assert.equal(comIndice.candidateOptions.length, 2);

  const comCandidata = buildModel({ candidateContestId: "2018-7-1" });
  assert.equal(comCandidata.metric, "votosCandidata");
  assert.equal(comCandidata.contestId, "2018-7-1");
  assert.equal(comCandidata.contestLabel, "2018 · Deputada Estadual");
  assert.equal(comCandidata.candidate?.nomeUrna, "Adriana Accorsi");
  // Nenhum dos ids do espectro casa com os dela — a lista é outra mesmo.
  assert.ok(
    !comCandidata.candidateOptions.some((option) => option.id === "2022-1-1"),
  );

  // Pleito dela que não existe (ou perdeu o recorte) cede lugar ao mais
  // recente com locais, em vez de deixar o mapa inteiro sem valor.
  assert.equal(
    buildModel({ candidateContestId: "2016-13-1" }).contestId,
    "2020-11-1",
  );
});

test("pleito municipal: local de outra cidade é null e fica fora do ranking", () => {
  const model = buildModel({ candidateContestId: "2020-11-1" });
  assert.equal(model.candidate?.municipal, true);
  assert.deepEqual(model.candidate?.scopeIbgeCodes, ["5208707"]);
  assert.equal(model.candidate?.scopeLabel, "Goiânia");

  const fora = unidade(model, anapolis.id);
  // Ela NÃO era candidata em Anápolis: ausência, jamais zero.
  assert.equal(fora.candidateVotes, null);
  assert.equal(fora.candidateVotesPerThousand, null);
  assert.equal(fora.candidateInScope, false);
  assert.equal(fora.value, null);
  assert.equal(fora.rank, 0);
  assert.ok(!model.filteredUnits.some((item) => item.id === anapolis.id));
  assert.equal(model.missingValueCount, 1);
  assert.equal(model.summary.candidateUnitsOutOfScope, 1);

  // A bolha existe (o local tem coordenada) com a cor de dado ausente, e o
  // texto diz o motivo certo — não "sem voto".
  const bolha = model.bubbles.find((item) => item.id === anapolis.id)!;
  assert.equal(bolha.value, null);
  assert.equal(bolha.color, MISSING_DATA_COLOR);
  assert.equal(bolha.candidateInScope, false);
  assert.equal(
    formatPollingValue(model.metric, null, { inScope: false }),
    "Fora da disputa",
  );
  assert.notEqual(
    formatPollingValue(model.metric, null, { inScope: false }),
    formatPollingValue(model.metric, 0),
  );

  // O agregado municipal (o que pinta o polígono e o PNG) segue a mesma regra.
  const anapolisAgregado = model.municipalityAggregates.find(
    (item) => item.ibgeCode === "5201108",
  )!;
  assert.equal(anapolisAgregado.candidateVotes, null);
  assert.equal(anapolisAgregado.value, null);
  const goianiaAgregado = model.municipalityAggregates.find(
    (item) => item.ibgeCode === "5208707",
  )!;
  // 500 + 300 + 0 + 0 + 0 — o local não casado (100 votos) não entra.
  assert.equal(goianiaAgregado.candidateVotes, 800);

  // E o texto da tela fala de disputa, não de índice nem de sigla.
  const texto = describePollingLayer(model);
  assert.ok(texto.includes("Adriana Accorsi"));
  assert.ok(texto.includes("fora da disputa"));
  assert.ok(!texto.includes("índice ideológico"));
  assert.ok(!texto.includes("sigla"));
});

test("pleito municipal: local na cidade dela sem registro é 0 DE VERDADE", () => {
  const model = buildModel({ candidateContestId: "2020-11-1" });
  const semVoto = unidade(model, clube.id);
  // Ela estava na urna deste local e não teve voto ali: zero medido.
  assert.equal(semVoto.candidateInScope, true);
  assert.equal(semVoto.candidateVotes, 0);
  assert.equal(semVoto.candidateVotesPerThousand, 0);
  assert.equal(semVoto.value, 0);
  assert.ok(semVoto.rank > 0);
  assert.ok(model.filteredUnits.some((item) => item.id === clube.id));
  assert.equal(formatPollingValue(model.metric, 0), "0");

  // A bolha do zero é pintada pela faixa mais clara da rampa; a do "fora da
  // disputa", pelo cinza de ausência. As duas nunca se confundem.
  const bolhaZero = model.bubbles.find((item) => item.id === clube.id)!;
  assert.equal(bolhaZero.color, POLLING_CANDIDATE_COLORS[0]);
  assert.notEqual(bolhaZero.color, MISSING_DATA_COLOR);

  // Os locais com voto dela: 500 e 300.
  assert.equal(unidade(model, escola.id).candidateVotes, 500);
  assert.equal(unidade(model, ginasio.id).candidateVotes, 300);
  assert.equal(model.summary.candidateVotes, 800);
  assert.equal(model.summary.candidateUnitsWithVotes, 2);
});

test("pleito estadual: local ausente do mapa dela é 0, em qualquer cidade", () => {
  const model = buildModel({ candidateContestId: "2018-7-1" });
  assert.equal(model.candidate?.municipal, false);
  assert.equal(model.candidate?.scopeIbgeCodes, null);
  assert.equal(model.candidate?.scopeLabel, "Goiás");

  // Ela estava na urna do estado inteiro: nenhuma unidade fica "fora".
  assert.equal(model.summary.candidateUnitsOutOfScope, 0);
  assert.equal(model.missingValueCount, 0);
  assert.ok(model.units.every((item) => item.candidateInScope));
  // Anápolis agora tem voto dela, e o local sem registro é zero de verdade.
  assert.equal(unidade(model, anapolis.id).candidateVotes, 120);
  assert.equal(unidade(model, clube.id).candidateVotes, 0);
  assert.equal(unidade(model, clube.id).value, 0);
  assert.equal(model.summary.candidateVotes, 540);
});

test("locais do mapa dela ausentes do cadastro são contados e declarados", () => {
  const model = buildModel({ candidateContestId: "2020-11-1" });
  const info = model.candidate!;
  // 3 locais no pleito dela, 2 casaram com o cadastro, 1 não.
  assert.equal(info.placesInContest, 3);
  assert.equal(info.matchedPlaceCount, 2);
  assert.equal(info.matchedVotes, 800);
  assert.equal(info.unmatchedPlaceCount, 1);
  assert.equal(info.unmatchedVotes, 100);
  assert.equal(info.votesInContest, 900);
  // O local não casado NÃO vira unidade, nem bolha, nem soma do mapa.
  assert.ok(!model.units.some((item) => item.id === "99999-9-9999"));
  assert.equal(info.matchedVotes + info.unmatchedVotes, info.votesInContest);

  // A contagem é ESTADUAL mesmo com filtro de município: sem cadastro não há
  // como saber a que cidade o local não casado pertencia.
  const comFiltro = buildModel({
    candidateContestId: "2020-11-1",
    municipalityId: "5208707",
  });
  assert.equal(comFiltro.candidate?.unmatchedPlaceCount, 1);
  assert.equal(comFiltro.candidate?.unmatchedVotes, 100);

  // Pleito sem local perdido reporta zero — o número é medido, não fixo.
  const estadual = buildModel({ candidateContestId: "2018-7-1" });
  assert.equal(estadual.candidate?.unmatchedPlaceCount, 0);
  assert.equal(estadual.candidate?.unmatchedVotes, 0);
  assert.equal(estadual.candidate?.votesWithoutPlace, 60);

  // O relatório declara a perda em nota, em vez de calar.
  const tabela = buildPollingTable(model);
  assert.ok(
    tabela.notes?.some(
      (nota) => nota.includes("não existem no cadastro") && nota.includes("100"),
    ),
  );
});

test("bairro soma os locais certos, e só os que estão na disputa", () => {
  const model = buildModel({
    candidateContestId: "2018-7-1",
    viewMode: "neighborhoods",
  });
  // Setor Oeste = Ginásio (50) + Escola Oeste (70).
  const oeste = unidade(model, "5208707|setor oeste");
  assert.equal(oeste.placeCount, 2);
  assert.equal(oeste.candidateVotes, 120);
  assert.equal(oeste.value, 120);
  // 120 votos sobre 1.600 eleitores = 75 por mil.
  assert.equal(oeste.candidateVotesPerThousand, 75);

  // Num pleito municipal o bairro da outra cidade fica FORA (null), e o bairro
  // dela sem voto nenhum é zero de verdade.
  const municipal = buildModel({
    candidateContestId: "2020-11-1",
    viewMode: "neighborhoods",
  });
  const centroAnapolis = unidade(municipal, "5201108|centro");
  assert.equal(centroAnapolis.candidateVotes, null);
  assert.equal(centroAnapolis.candidateInScope, false);
  assert.equal(centroAnapolis.value, null);
  const bueno = unidade(municipal, "5208707|setor bueno");
  assert.equal(bueno.candidateVotes, 0);
  assert.equal(bueno.candidateInScope, true);
  // Setor Oeste no municipal: 300 do ginásio + 0 da escola do mesmo bairro.
  assert.equal(unidade(municipal, "5208707|setor oeste").candidateVotes, 300);
});

test("votos por 1.000 eleitores: sem eleitorado é null, nunca 0", () => {
  const model = buildModel({ candidateContestId: "2020-11-1" });
  // Local sem eleitorado cadastrado: 0 voto dela é zero de verdade, mas a TAXA
  // não existe — não há denominador.
  const semBase = unidade(model, semEleitorado.id);
  assert.equal(semBase.candidateInScope, true);
  assert.equal(semBase.candidateVotes, 0);
  assert.equal(semBase.candidateVotesPerThousand, null);
  // 500 / 4.000 × 1.000 = 125; 300 / 900 × 1.000 = 333,33.
  assert.equal(unidade(model, escola.id).candidateVotesPerThousand, 125);
  assert.equal(unidade(model, ginasio.id).candidateVotesPerThousand, 333.33);

  // Na escala por mil, a unidade sem eleitorado sai do ranking — e o texto da
  // ausência é o dela, não o de "fora da disputa".
  const porMil = buildModel({
    candidateContestId: "2020-11-1",
    candidateRate: true,
  });
  assert.equal(porMil.candidateRate, true);
  assert.equal(unidade(porMil, semEleitorado.id).value, null);
  assert.equal(unidade(porMil, escola.id).value, 125);
  assert.equal(unidade(porMil, ginasio.id).value, 333.33);
  assert.equal(unidade(porMil, clube.id).value, 0);
  // Sem eleitorado + fora da disputa = 2 unidades sem valor.
  assert.equal(porMil.missingValueCount, 2);
  assert.equal(
    formatPollingValue(porMil.metric, null, { rate: true, inScope: true }),
    "Sem eleitorado no local",
  );
  assert.equal(
    formatPollingValue(porMil.metric, null, { rate: true, inScope: false }),
    "Fora da disputa",
  );

  // A escala troca a ordem do ranking: o ginásio é menor em voto absoluto e
  // maior em densidade que a escola.
  assert.deepEqual(
    model.filteredUnits.slice(0, 2).map((item) => item.id),
    [escola.id, ginasio.id],
  );
  assert.deepEqual(
    porMil.filteredUnits.slice(0, 2).map((item) => item.id),
    [ginasio.id, escola.id],
  );
  // O denominador do resumo é o eleitorado dos locais em que ela ESTAVA na
  // urna (6.800 em Goiânia), nunca o do estado inteiro: 800 / 6.800 × 1.000.
  assert.equal(model.summary.candidateVotesPerThousand, 117.65);
  const estadual = buildModel({ candidateContestId: "2018-7-1" });
  // No pleito estadual a urna é o estado: 540 / 8.800 × 1.000.
  assert.equal(estadual.summary.candidateVotesPerThousand, 61.36);
});

test("cor, faixas e rótulos da medida são os dela — nada de índice ou sigla", () => {
  const model = buildModel({ candidateContestId: "2020-11-1" });
  // Rampa sequencial vermelha da campanha, com #c1121f no meio.
  assert.equal(getPollingMetricColors(model.metric), POLLING_CANDIDATE_COLORS);
  assert.equal(POLLING_CANDIDATE_COLORS[2], "#c1121f");
  assert.equal(POLLING_CANDIDATE_COLORS.length, 5);

  // Faixas por quantil do recorte: valores [0, 0, 0, 300, 500].
  assert.deepEqual(model.thresholds, [0, 0, 0, 300]);
  assert.equal(unidade(model, escola.id).band, 4);
  assert.equal(unidade(model, ginasio.id).band, 3);
  assert.equal(unidade(model, clube.id).band, 0);
  assert.equal(
    getPollingRangeLabel(model.metric, model.thresholds, 4),
    "Acima de 300",
  );
  assert.equal(
    getPollingRangeLabel(model.metric, model.thresholds, 4, { rate: true }),
    "Acima de 300,0",
  );

  // Rótulo curto da medida: quem, e em que escala.
  assert.equal(
    getPollingMetricShortLabel(model.metric, model.partyCode, {
      nome: "Adriana Accorsi",
    }),
    "votos de Adriana Accorsi",
  );
  assert.equal(
    getPollingMetricShortLabel(model.metric, model.partyCode, {
      nome: "Adriana Accorsi",
      rate: true,
    }),
    "votos de Adriana Accorsi por mil eleitores",
  );

  // Barrinha do ranking: sem teto fixo, é relativa ao maior valor do recorte.
  assert.equal(getPollingMaximumValue(model), 500);
  assert.equal(getPollingValueRatio(model.metric, 250, 500), 0.5);
  assert.equal(getPollingValueRatio(model.metric, 500, 0), 0);
  assert.equal(getPollingValueRatio(model.metric, null, 500), 0);

  // O resumo em prosa fala do voto dela, e diz "fora da disputa" quando o
  // recorte inteiro está fora.
  const resumo = describePollingScope(model);
  assert.ok(resumo.includes("Adriana Accorsi"));
  assert.ok(resumo.includes("800"));
  assert.ok(!resumo.includes("índice"));
  const foraDaCidade = buildModel({
    candidateContestId: "2020-11-1",
    municipalityId: "5201108",
  });
  assert.equal(foraDaCidade.summary.candidateVotes, null);
  assert.ok(describePollingScope(foraDaCidade).includes("não era candidata"));
  assert.equal(foraDaCidade.filteredUnits.length, 0);
});

test("CSV, PNG e relatório saem coerentes com o voto dela", () => {
  const model = buildModel({ candidateContestId: "2020-11-1" });
  const csv = createPollingCsv(model);
  const cabecalho = csv.trim().split("\n")[0];
  // Nenhuma coluna de índice, de bloco ou de sigla sobra nesta exportação.
  assert.ok(!cabecalho.includes("indice_ideologico"));
  assert.ok(!cabecalho.includes("percentual_da_sigla"));
  assert.ok(!cabecalho.includes("onda_survey"));
  assert.ok(cabecalho.includes('"candidata"'));
  assert.ok(
    cabecalho.includes(
      '"votos_da_candidata";"votos_por_mil_eleitores";"na_disputa"',
    ),
  );
  const linhas = csv.trim().split("\n");
  // Zero de verdade sai escrito; ausência sairia como célula vazia — e a
  // unidade fora da disputa nem chega ao arquivo.
  assert.ok(linhas.some((linha) => linha.includes('"0";"0";"sim"')));
  assert.ok(!csv.includes("Escola Anápolis"));
  assert.equal(
    getPollingCsvFilename(model),
    "locais-votos-candidata-go-2020-11-1.csv",
  );
  assert.equal(
    getPollingCsvFilename(
      buildModel({ candidateContestId: "2020-11-1", candidateRate: true }),
    ),
    "locais-votos-candidata-por-mil-go-2020-11-1.csv",
  );

  const png = buildPollingMapExport(model);
  assert.ok(png.title.includes("votos de Adriana Accorsi"));
  assert.ok(!png.title.includes("ideológico"));
  assert.ok(!png.subtitle.includes("onda"));
  assert.ok(png.filename.startsWith("locais-votos-candidata-"));
  assert.deepEqual(
    png.legend.slice(0, 5).map((item) => item.color),
    [...POLLING_CANDIDATE_COLORS],
  );
  assert.ok(
    png.legend.some((item) => item.label.includes("Fora da disputa")),
  );
  // Goiânia tem valor; Anápolis fica com o rótulo de ausência da medida.
  assert.equal(png.styleById.get("5208707")!.valueLabel, "800");
  assert.equal(png.styleById.get("5201108")!.valueLabel, "Fora da disputa");

  const tabela = buildPollingTable(model);
  const colunas = tabela.columns.map((coluna) => coluna.header);
  assert.ok(colunas.includes("Votos de Adriana Accorsi"));
  assert.ok(colunas.includes("Votos por 1.000 eleitores"));
  assert.ok(!colunas.includes("Índice ideológico (0–10)"));
  assert.ok(!colunas.includes("Partido mais votado"));
  assert.ok(tabela.subtitle.includes("votos de Adriana Accorsi por local"));
});

test("sem trajetória gerada a medida não é oferecida, e nada é sintetizado", () => {
  const pendente: CandidateDataset = {
    metadata: { ...candidata.metadata, status: "pendente" },
    contests: [],
  };
  assert.equal(getPollingCandidateAvailability(pendente), "pendente");
  assert.equal(getPollingCandidateAvailability(null), "pendente");
  assert.deepEqual(listPollingCandidateContests(pendente), []);

  // Mesmo com um pleito dela guardado no estado, a medida não liga: cai para o
  // índice, sem inventar zero em local nenhum.
  const model = buildModel({ candidateContestId: "2020-11-1" }, pendente);
  assert.equal(model.candidateAvailability, "pendente");
  assert.equal(model.metric, "indice");
  assert.equal(model.candidate, null);
  assert.deepEqual(model.candidateOptions, []);
  assert.ok(model.units.every((item) => item.candidateVotes === null));

  // Trajetória gerada, mas nenhum pleito com cadastro de locais: a razão é
  // outra e a interface precisa poder dizer qual é.
  const semRecorte: CandidateDataset = {
    metadata: candidata.metadata,
    contests: [vereadora2016],
  };
  assert.equal(getPollingCandidateAvailability(semRecorte), "sem-recorte");
  assert.equal(
    buildModel({ candidateContestId: "2016-13-1" }, semRecorte).metric,
    "indice",
  );

  // Sem candidata alguma o modelo segue inteiro nas outras duas medidas.
  const semCandidata = buildModel({ partyCode: "PT" }, null);
  assert.equal(semCandidata.metric, "votoPartido");
  assert.equal(semCandidata.candidateAvailability, "pendente");
});

test("o estado guarda o pleito dela e descarta lixo", () => {
  assert.equal(getDefaultPollingState([presidente]).candidateContestId, null);
  assert.equal(getDefaultPollingState([presidente]).candidateRate, false);
  assert.equal(
    sanitizePollingState({ candidateContestId: "2018-7-1" }, [presidente])
      .candidateContestId,
    "2018-7-1",
  );
  assert.equal(
    sanitizePollingState({ candidateContestId: "<script>" }, [presidente])
      .candidateContestId,
    null,
  );
  assert.equal(
    sanitizePollingState({ candidateContestId: 2018 }, [presidente])
      .candidateContestId,
    null,
  );
  assert.equal(
    sanitizePollingState({ candidateRate: "sim" }, [presidente]).candidateRate,
    false,
  );
  assert.equal(
    sanitizePollingState({ candidateRate: true }, [presidente]).candidateRate,
    true,
  );
});

/* ------------------------------------------------------------------------
 * Zero à esquerda no código do município — a armadilha silenciosa
 * ------------------------------------------------------------------------ */

test("id de local dela casa com o cadastro mesmo com zero à esquerda", async () => {
  const { canonicalPlaceId } = await import(
    "../../src/utils/pollingPlaces.ts"
  );

  // process_candidato_foco.py grava sem o zero; process_tse_sections.py grava
  // com. Goiânia é 09373 — sem canonicalizar, estes dois seriam locais
  // diferentes e a camada mostraria zero voto em todo o mapa.
  assert.equal(canonicalPlaceId("9373-1-1015"), "09373-1-1015");
  assert.equal(canonicalPlaceId("09373-1-1015"), "09373-1-1015");
  assert.equal(
    canonicalPlaceId("9373-1-1015"),
    canonicalPlaceId("09373-1-1015"),
  );

  // Código que já tem cinco dígitos não é alterado.
  assert.equal(canonicalPlaceId("93971-2-1020"), "93971-2-1020");
  // Id fora do formato esperado passa intacto, em vez de virar outra coisa.
  assert.equal(canonicalPlaceId("5208707|setor central"), "5208707|setor central");
  assert.equal(canonicalPlaceId("abc-1-2"), "abc-1-2");
});
