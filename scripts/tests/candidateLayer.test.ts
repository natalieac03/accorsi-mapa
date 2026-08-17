import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateLayerMunicipio,
  CandidateLayerState,
  CandidateMunicipio,
  ElectorateIndex,
} from "../../src/types/candidate.ts";
import type { MunicipalityProfile } from "../../src/types/electorate.ts";
import {
  buildAnalysisModel,
  getDefaultAnalysisState,
} from "../../src/utils/analysis.ts";
import {
  buildCandidateLayerModel,
  CANDIDATE_LAYER_COLORS,
  describeCandidateLayer,
  describeCandidateLayerItem,
  getCandidateLayerRangeLabel,
  getDefaultCandidateLayerState,
  sanitizeCandidateLayerState,
} from "../../src/utils/candidateLayer.ts";
import { POLLING_CANDIDATE_COLORS } from "../../src/utils/pollingPlaces.ts";

/**
 * Camada "candidato" — o coroplético do desempenho DELA.
 *
 * Payload SINTÉTICO e inline, no shape de `process_candidato_foco.py`: os
 * snapshots de `src/data` desta instalação são placeholders, e as regras de
 * ausência precisam ser verificáveis antes de qualquer `gerar_dados.sh`.
 *
 * O que estes testes existem para travar:
 *
 * - pleito MUNICIPAL: só a cidade da disputa é pintada; os outros municípios
 *   ficam fora da escala com votos NULL — nunca zero;
 * - pleito ESTADUAL: município ausente do pleito é zero voto APURADO (dado),
 *   mas sem eleitorado a taxa é null (ausência). São coisas diferentes;
 * - trocar métrica ou pleito recalcula faixas e ranking;
 * - trajetória pendente não oferece a camada;
 * - a camada não mexe no que as outras abas pintam.
 */

const ALFA = "5200001";
const BETA = "5200002";
const GAMA = "5200003";
const DELTA = "5200004";

const MUNICIPIOS: CandidateLayerMunicipio[] = [
  { ibgeCode: ALFA, name: "Cidade Alfa" },
  { ibgeCode: BETA, name: "Cidade Beta" },
  { ibgeCode: GAMA, name: "Cidade Gama" },
  { ibgeCode: DELTA, name: "Cidade Delta" },
];

/** Delta fica FORA do índice: município sem eleitorado apurado. */
const ELEITORADO: ElectorateIndex = {
  [ALFA]: 10_000,
  [BETA]: 1_000,
  [GAMA]: 2_000,
};

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
    posicaoNoMunicipio: 1,
    candidaturasComVoto: 10,
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
      nomeCompleto: "CANDIDATA SINTETICA",
      nomeUrna: "SINTETICA",
      partido: "PT",
      numero: "1313",
      situacaoCandidatura: "APTO",
      resultado: "ELEITO",
    },
    votosNoEstado: 1250,
    posicaoNoEstado: 3,
    candidaturasNoPleito: 20,
    municipiosComVoto: 2,
    concentracaoPercentual: { top5: 100, top10: 100, top20: 100 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios: {},
    locais: null,
    bairros: null,
    ...overrides,
  };
}

/**
 * Estadual: ela estava na urna do estado inteiro. Alfa e Beta apuraram voto;
 * Gama e Delta não aparecem no arquivo — zero voto apurado.
 * Por votos absolutos Alfa lidera; por 1.000 eleitores, Beta (250/mil) passa
 * na frente de Alfa (100/mil). É o par que prova que trocar a métrica muda a
 * leitura do mapa, não só o número.
 */
const estadual2022 = contest("2022-6-1", 2022, {
  municipios: {
    [ALFA]: municipio("Cidade Alfa", 1000, {
      validos: 5000,
      percentualValidos: 20,
    }),
    [BETA]: municipio("Cidade Beta", 250, {
      validos: 1000,
      percentualValidos: 25,
    }),
  },
});

const estadual2018 = contest("2018-7-1", 2018, {
  officeCode: 7,
  officeName: "Deputado Estadual",
  votosNoEstado: 900,
  municipios: {
    [ALFA]: municipio("Cidade Alfa", 300, { validos: 3000, percentualValidos: 10 }),
    [GAMA]: municipio("Cidade Gama", 600, { validos: 2400, percentualValidos: 25 }),
  },
});

/** Municipal: prefeita em Cidade Beta. As outras cidades não tinham o nome dela na urna. */
const municipal2020 = contest("2020-11-1", 2020, {
  officeCode: 11,
  officeName: "Prefeito",
  votosNoEstado: 8000,
  municipiosComVoto: 1,
  municipios: {
    [BETA]: municipio("Cidade Beta", 8000, {
      validos: 20_000,
      percentualValidos: 40,
    }),
  },
});

const dataset: CandidateDataset = {
  metadata: {
    schemaVersion: 1,
    state: "GO",
    slug: "sintetica",
    pleitos: 3,
    anos: [2018, 2020, 2022],
    cargos: ["Deputado Estadual", "Prefeito", "Deputado Federal"],
  },
  contests: [estadual2022, municipal2020, estadual2018],
};

function state(overrides: Partial<CandidateLayerState> = {}): CandidateLayerState {
  return {
    contestId: estadual2022.id,
    metricId: "votosPorMilEleitores",
    activeBands: [0, 1, 2, 3, 4],
    ...overrides,
  };
}

function build(
  overrides: Partial<CandidateLayerState> = {},
  electorateIndex: ElectorateIndex = ELEITORADO,
) {
  return buildCandidateLayerModel({
    dataset,
    municipios: MUNICIPIOS,
    electorateIndex,
    state: state(overrides),
  });
}

function item(model: ReturnType<typeof build>, ibgeCode: string) {
  const encontrado = model?.allItems.find((row) => row.ibgeCode === ibgeCode);
  assert.ok(encontrado, `município ${ibgeCode} ausente do modelo`);
  return encontrado;
}

test("pleito municipal: só a cidade da disputa é pintada; o resto fica fora da escala e NUNCA zero", () => {
  const model = build({ contestId: municipal2020.id });
  assert.ok(model);
  assert.equal(model.escopoMunicipal?.ibgeCode, BETA);

  const cidade = item(model, BETA);
  assert.equal(cidade.status, "medido");
  assert.equal(cidade.votos, 8000);
  assert.notEqual(cidade.band, null);
  assert.equal(cidade.value, 8000);

  for (const ibge of [ALFA, GAMA, DELTA]) {
    const fora = item(model, ibge);
    assert.equal(fora.status, "foraDaDisputa");
    // A distinção que o mapa inteiro depende: ausência, não zero.
    assert.equal(fora.votos, null);
    assert.notEqual(fora.votos, 0);
    assert.equal(fora.value, null);
    assert.equal(fora.band, null, "fora da disputa não pode receber faixa");
    assert.equal(fora.rank, null);
  }

  assert.equal(model.foraDaDisputaCount, 3);
  assert.equal(model.medidosCount, 1);
  // Com um valor só não existe distribuição: nada de quintis inventados.
  assert.equal(model.escalaPorQuantil, false);
  assert.deepEqual(model.thresholds, []);
});

test("pleito municipal: faixa herdada de outro pleito não apaga a cidade da disputa", () => {
  const model = build({ contestId: municipal2020.id, activeBands: [4] });
  assert.ok(model);
  // Sem escala, filtrar faixa não faz sentido — todas ficam ativas para a
  // única cidade pintada continuar visível.
  assert.deepEqual(model.activeBands, [0, 1, 2, 3, 4]);
  assert.ok(model.activeBands.includes(item(model, BETA).band as number));
});

test("pleito municipal com mais de uma cidade no arquivo: as demais seguem fora da disputa", () => {
  // Anomalia possível no dado (duas cidades num pleito de prefeita). A régua
  // continua sendo o cargo: quem não aparece no pleito não teve o nome dela na
  // urna — nunca vira zero voto só porque o escopo de cidade única não se
  // aplicou.
  const duasCidades = contest("2020-11-2", 2020, {
    officeCode: 11,
    officeName: "Prefeito",
    municipios: {
      [BETA]: municipio("Cidade Beta", 8000),
      [GAMA]: municipio("Cidade Gama", 4000),
    },
  });
  const model = buildCandidateLayerModel({
    dataset: { ...dataset, contests: [duasCidades] },
    municipios: MUNICIPIOS,
    electorateIndex: ELEITORADO,
    state: state({ contestId: duasCidades.id, metricId: "votos" }),
  });
  assert.ok(model);
  assert.equal(model.escopoMunicipal, null);
  assert.equal(item(model, ALFA).status, "foraDaDisputa");
  assert.equal(item(model, ALFA).votos, null);
  assert.equal(item(model, DELTA).status, "foraDaDisputa");
  assert.equal(model.foraDaDisputaCount, 2);
  // Com dois valores volta a existir distribuição — e faixas.
  assert.equal(model.escalaPorQuantil, true);
});

test("pleito estadual: município ausente do pleito é ZERO apurado; sem eleitorado é null", () => {
  const model = build({ contestId: estadual2022.id });
  assert.ok(model);
  assert.equal(model.escopoMunicipal, null);

  // Gama não aparece no arquivo dela: ela estava na urna, o município apurou
  // zero voto — e zero, com eleitorado, tem taxa (0), faixa e entra na escala.
  const gama = item(model, GAMA);
  assert.equal(gama.votos, 0);
  assert.equal(gama.value, 0);
  assert.equal(gama.status, "medido");
  assert.notEqual(gama.band, null);

  // Delta também apurou zero, mas não tem eleitorado: taxa não existe.
  const delta = item(model, DELTA);
  assert.equal(delta.votos, 0);
  assert.equal(delta.value, null);
  assert.equal(delta.status, "semDenominador");
  assert.equal(delta.band, null);
  assert.equal(delta.rank, null);

  assert.equal(item(model, ALFA).value, 100);
  assert.equal(item(model, BETA).value, 250);
  assert.equal(model.foraDaDisputaCount, 0);
  assert.equal(model.semDenominadorCount, 1);
});

test("pleito estadual em % dos válidos: sem denominador apurado o município sai da escala", () => {
  const model = build({ contestId: estadual2022.id, metricId: "percentualValidos" });
  assert.ok(model);
  assert.equal(item(model, ALFA).value, 20);
  for (const ibge of [GAMA, DELTA]) {
    const semDenominador = item(model, ibge);
    // Zero voto apurado continua sendo zero VOTO; o percentual é que não
    // existe sem os válidos daquele município.
    assert.equal(semDenominador.votos, 0);
    assert.equal(semDenominador.value, null);
    assert.equal(semDenominador.status, "semDenominador");
    assert.equal(semDenominador.band, null);
  }
  assert.equal(model.semDenominadorCount, 2);
});

test("trocar a métrica recalcula faixas e a leitura do mapa", () => {
  const porMil = build({ metricId: "votosPorMilEleitores" });
  const votos = build({ metricId: "votos" });
  assert.ok(porMil && votos);

  assert.notDeepEqual(porMil.thresholds, votos.thresholds);
  // Em votos absolutos Alfa lidera; por 1.000 eleitores quem lidera é Beta —
  // é exatamente por isso que a métrica escolhida no painel tem de pintar.
  assert.equal(item(votos, ALFA).rank, 1);
  assert.equal(item(porMil, BETA).rank, 1);
  assert.equal(porMil.metricId, "votosPorMilEleitores");
  assert.equal(votos.metricId, "votos");
  assert.notDeepEqual(porMil.bandCounts, votos.bandCounts);
});

test("trocar o pleito recalcula faixas, valores e escopo", () => {
  const em2022 = build({ contestId: estadual2022.id, metricId: "votos" });
  const em2018 = build({ contestId: estadual2018.id, metricId: "votos" });
  assert.ok(em2022 && em2018);

  assert.equal(em2022.contest.id, estadual2022.id);
  assert.equal(em2018.contest.id, estadual2018.id);
  assert.equal(item(em2022, GAMA).votos, 0);
  assert.equal(item(em2018, GAMA).votos, 600);
  assert.equal(item(em2018, BETA).votos, 0);
  assert.notDeepEqual(em2022.thresholds, em2018.thresholds);
  // Pleito inexistente cai no primeiro do arquivo em vez de quebrar a camada.
  const inexistente = build({ contestId: "9999-6-1" });
  assert.equal(inexistente?.contest.id, dataset.contests[0].id);
});

test("trajetória pendente (ou sem pleito): a camada não é oferecida", () => {
  const pendente: CandidateDataset = {
    metadata: { ...dataset.metadata, status: "pendente" },
    contests: dataset.contests,
  };
  const semPleito: CandidateDataset = {
    metadata: { ...dataset.metadata, pleitos: 0 },
    contests: [],
  };
  for (const candidato of [pendente, semPleito]) {
    const model = buildCandidateLayerModel({
      dataset: candidato,
      municipios: MUNICIPIOS,
      electorateIndex: ELEITORADO,
      state: state(),
    });
    assert.equal(model, null);
  }
});

test("sem snapshot do eleitorado a taxa não existe: a camada cai em votos e declara", () => {
  const model = build({ metricId: "votosPorMilEleitores" }, null);
  assert.ok(model);
  assert.equal(model.eleitoradoPendente, true);
  assert.equal(model.metricId, "votos");
  assert.equal(item(model, ALFA).value, 1000);
  assert.equal(item(model, ALFA).eleitorado, null);
});

test("a camada não altera o que as outras abas pintam", () => {
  const perfis = MUNICIPIOS.map((municipality) =>
    perfil(municipality.ibgeCode, municipality.name),
  );
  const antes = buildAnalysisModel(perfis, getDefaultAnalysisState(), 4000);
  const municipiosClone = structuredClone(MUNICIPIOS);
  const eleitoradoClone = structuredClone(ELEITORADO);
  const datasetClone = structuredClone(dataset);

  buildCandidateLayerModel({
    dataset,
    municipios: MUNICIPIOS,
    electorateIndex: ELEITORADO,
    state: state({ contestId: municipal2020.id }),
  });

  // Nada de mutar insumo compartilhado: o mesmo array de municípios e o mesmo
  // índice de eleitorado alimentam a análise, o espectro e os locais.
  assert.deepEqual(MUNICIPIOS, municipiosClone);
  assert.deepEqual(ELEITORADO, eleitoradoClone);
  assert.deepEqual(dataset, datasetClone);

  const depois = buildAnalysisModel(perfis, getDefaultAnalysisState(), 4000);
  assert.deepEqual(depois.thresholds, antes.thresholds);
  assert.deepEqual(depois.bandCounts, antes.bandCounts);
  assert.equal(depois.allItems.length, antes.allItems.length);
});

test("estado inicial: por 1.000 eleitores, com queda para votos sem eleitorado", () => {
  assert.equal(
    getDefaultCandidateLayerState(dataset, ELEITORADO).metricId,
    "votosPorMilEleitores",
  );
  assert.equal(getDefaultCandidateLayerState(dataset, null).metricId, "votos");
  assert.equal(
    getDefaultCandidateLayerState(dataset, ELEITORADO).contestId,
    dataset.contests[0].id,
  );
});

test("estado guardado: pleito sumido e métrica sem denominador voltam ao padrão", () => {
  const guardado = {
    contestId: "2010-6-1",
    metricId: "percentualPartido",
    activeBands: [1, 3],
  };
  const limpo = sanitizeCandidateLayerState(guardado, dataset, ELEITORADO);
  assert.equal(limpo.contestId, dataset.contests[0].id);
  assert.equal(limpo.metricId, "percentualPartido");
  assert.deepEqual(limpo.activeBands, [1, 3]);

  const semEleitorado = sanitizeCandidateLayerState(
    { contestId: municipal2020.id, metricId: "votosPorMilEleitores" },
    dataset,
    null,
  );
  assert.equal(semEleitorado.contestId, municipal2020.id);
  assert.equal(semEleitorado.metricId, "votos");
  assert.deepEqual(semEleitorado.activeBands, [0, 1, 2, 3, 4]);
  // Lixo no armazenamento não pode derrubar a camada.
  assert.deepEqual(
    sanitizeCandidateLayerState("{}", dataset, ELEITORADO),
    getDefaultCandidateLayerState(dataset, ELEITORADO),
  );
});

test("o denominador da taxa é o eleitorado apto, e a camada escreve isso", () => {
  const model = build({ metricId: "votosPorMilEleitores" });
  assert.ok(model);
  assert.match(model.denominadorNota ?? "", /eleitorado apto/);
  assert.match(model.denominadorNota ?? "", /não a população/);
  // No cartão estreito da camada ativa a nota vai na forma curta — mas vai.
  assert.match(describeCandidateLayer(model), /não habitantes/);
  // Votos absolutos não têm denominador nenhum para declarar.
  assert.equal(build({ metricId: "votos" })?.denominadorNota, null);
});

test("os dois cinzas têm frases diferentes no tooltip", () => {
  const municipal = build({ contestId: municipal2020.id });
  const estadual = build({ contestId: estadual2022.id });
  assert.ok(municipal && estadual);

  const foraDaDisputa = describeCandidateLayerItem(
    municipal,
    item(municipal, ALFA),
  );
  const semDenominador = describeCandidateLayerItem(
    estadual,
    item(estadual, DELTA),
  );
  assert.match(foraDaDisputa, /Fora da disputa/);
  assert.match(foraDaDisputa, /Cidade Beta/);
  assert.match(semDenominador, /sem eleitorado apurado/);
  assert.notEqual(foraDaDisputa, semDenominador);
  // Município medido mostra valor e votos, sem inventar unidade.
  assert.match(
    describeCandidateLayerItem(estadual, item(estadual, ALFA)),
    /100 · 1\.000 votos/,
  );
  assert.equal(
    describeCandidateLayerItem(estadual, undefined),
    "Sem dado da candidatura neste município",
  );
});

test("a rampa é a MESMA dos votos dela por local, e a legenda nomeia os intervalos", () => {
  assert.deepEqual(
    [...CANDIDATE_LAYER_COLORS],
    [...POLLING_CANDIDATE_COLORS],
    "as duas leituras do voto dela têm de falar a mesma língua visual",
  );
  const model = build({ metricId: "votosPorMilEleitores" });
  assert.ok(model);
  assert.match(
    getCandidateLayerRangeLabel(model.metricId, model.thresholds, 0),
    /^Até /,
  );
  assert.match(
    getCandidateLayerRangeLabel(model.metricId, model.thresholds, 4),
    /^Acima de /,
  );
});

function perfil(ibgeCode: string, name: string): MunicipalityProfile {
  return {
    ibgeCode,
    tseCode: ibgeCode.slice(-5),
    name,
    electorate: 1000,
    stateSharePct: 25,
    stateRank: 1,
    zoneCount: 1,
    biometrics: 500,
    biometricsPct: 50,
    registeredDisability: 0,
    socialName: 0,
    topAgeGroup: { label: "35 a 39 anos", electorate: 200, percentage: 20 },
    gender: { female: 500, male: 500, notInformed: 0 },
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
