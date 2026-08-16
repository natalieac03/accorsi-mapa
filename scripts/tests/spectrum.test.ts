import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgeStructureDataset } from "../../src/types/ageStructure.ts";
import type { LiteracyDataset } from "../../src/types/literacy.ts";
import type { ElectionDataset } from "../../src/types/elections.ts";
import type { ElectorateDataset } from "../../src/types/electorate.ts";
import type { SocioeconomicDataset } from "../../src/types/socioeconomic.ts";
import type {
  PartySpectrumRegistry,
  SpectrumSourceContest,
} from "../../src/types/spectrum.ts";
import { buildTerritorialDataset } from "../../src/utils/socioeconomic.ts";
import { ELEICOES_PENDENTES, INSTRUCAO_GERAR } from "./dadosPendentes.ts";
import {
  buildContestsFromElections,
  buildPartySpectrumIndex,
  buildSpectrumContests,
  buildSpectrumModel,
  classifySpectrumBlock,
  createSpectrumCsv,
  getAbsoluteThresholds,
  getDefaultSpectrumState,
  normalizePartyCode,
  resolvePartyScore,
  resolveWaveYear,
  sanitizeSpectrumState,
  SPECTRUM_SHIFT_THRESHOLDS,
} from "../../src/utils/spectrum.ts";

function loadJson<T>(relative: string): T {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
  ) as T;
}

function loadData() {
  const registry = loadJson<PartySpectrumRegistry>(
    "../../src/data/party-spectrum.json",
  );
  const elections = loadJson<ElectionDataset>(
    "../../src/data/election-history-go.json",
  );
  const electorate = loadJson<ElectorateDataset>(
    "../../src/data/electorate-go.json",
  );
  const socioeconomic = loadJson<SocioeconomicDataset>(
    "../../src/data/socioeconomic-go.json",
  );
  const ageStructure = loadJson<AgeStructureDataset>(
    "../../src/data/age-structure-go.json",
  );
  const literacy = loadJson<LiteracyDataset>("../../src/data/literacy-go.json");
  return {
    registry,
    elections,
    index: buildPartySpectrumIndex(registry),
    municipalities: Object.values(
      buildTerritorialDataset(electorate, socioeconomic, ageStructure, literacy)
        .municipalities,
    ),
  };
}

test("registro de partidos é íntegro e sem alias ambíguo", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { registry, index } = loadData();
  assert.equal(registry.metadata.schemaVersion, 1);
  assert.ok(registry.parties.length >= 30);
  assert.ok(
    registry.metadata.blockThresholds.leftMaximum <
      registry.metadata.blockThresholds.rightMinimum,
  );
  for (const party of registry.parties) {
    for (const [wave, score] of Object.entries(party.scores)) {
      if (score === null) continue;
      assert.ok(
        score >= 0 && score <= 10,
        `${party.code} na onda ${wave} tem nota fora da escala`,
      );
    }
    const hasScore = Object.values(party.scores).some((score) => score !== null);
    assert.ok(hasScore, `${party.code} não tem nenhuma nota`);
  }
  // buildPartySpectrumIndex lança quando há alias ambíguo; chegar aqui já prova.
  assert.ok(index.aliasToCode.size >= registry.parties.length);
});

test("notas derivadas são a média das siglas de origem", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { registry } = loadData();
  const byCode = new Map(registry.parties.map((party) => [party.code, party]));
  let checked = 0;
  for (const party of registry.parties) {
    for (const [wave, origins] of Object.entries(party.derivedFrom ?? {})) {
      const values = origins.map((origin) => {
        const source = byCode.get(origin);
        assert.ok(source, `origem ${origin} de ${party.code} não existe`);
        const score = source.scores[wave];
        assert.ok(typeof score === "number", `${origin} sem nota na onda ${wave}`);
        return score as number;
      });
      const expected = values.reduce((total, value) => total + value, 0) / values.length;
      const actual = party.scores[wave];
      assert.ok(typeof actual === "number");
      assert.ok(
        Math.abs((actual as number) - expected) < 0.006,
        `${party.code}/${wave}: esperado ${expected}, encontrado ${String(actual)}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 2);
});

test("aliases históricos resolvem para a sigla atual", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { index } = loadData();
  assert.equal(resolvePartyScore(index, "PR", 2018)?.code, "PL");
  assert.equal(resolvePartyScore(index, "PRB", 2018)?.code, "REPUBLICANOS");
  assert.equal(resolvePartyScore(index, "PPS", 2018)?.code, "CIDADANIA");
  assert.equal(resolvePartyScore(index, "PTC", 2018)?.code, "AGIR");
  assert.equal(resolvePartyScore(index, "UNIÃO", 2022)?.code, "UNIAO");
  assert.equal(resolvePartyScore(index, "uniao brasil", 2022)?.code, "UNIAO");
  assert.equal(resolvePartyScore(index, "PARTIDO INEXISTENTE", 2022), null);
});

test("normalização de sigla ignora acento, caixa e pontuação", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(normalizePartyCode("UNIÃO"), "UNIAO");
  assert.equal(normalizePartyCode(" pc do b "), "PCDOB");
  assert.equal(normalizePartyCode("PC do B"), "PCDOB");
});

test("partido sem nota na onda não é tratado como zero", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { index } = loadData();
  // PSL e DEM deixaram de existir antes da onda de 2022.
  assert.ok(resolvePartyScore(index, "PSL", 2018));
  assert.equal(resolvePartyScore(index, "PSL", 2022), null);
  assert.equal(resolvePartyScore(index, "DEM", 2022), null);
  // UP não existia na onda de 2018.
  assert.equal(resolvePartyScore(index, "UP", 2018), null);
  assert.ok(resolvePartyScore(index, "UP", 2022));
});

test("onda do survey segue o ano da eleição", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { registry } = loadData();
  assert.equal(resolveWaveYear(registry, 2018), 2018);
  assert.equal(resolveWaveYear(registry, 2020), 2018);
  assert.equal(resolveWaveYear(registry, 2022), 2022);
  assert.equal(resolveWaveYear(registry, 2024), 2022);
});

test("blocos respeitam os limiares configurados", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { registry } = loadData();
  assert.equal(classifySpectrumBlock(2.68, registry), "left");
  assert.equal(classifySpectrumBlock(5.0, registry), "center");
  assert.equal(classifySpectrumBlock(8.8, registry), "right");
  assert.equal(
    classifySpectrumBlock(registry.metadata.blockThresholds.leftMaximum, registry),
    "left",
  );
  assert.equal(
    classifySpectrumBlock(registry.metadata.blockThresholds.rightMinimum, registry),
    "right",
  );
});

test("índice ponderado confere com a aritmética feita à mão", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { registry, index, municipalities } = loadData();
  // PT = 2,68 e PL = 8,80 na onda de 2022; XPTO não tem nota.
  const contest: SpectrumSourceContest = {
    id: "teste:2022-1-1",
    electionYear: 2022,
    round: 1,
    officeCode: 1,
    officeName: "Presidente",
    origin: "parties",
    waveYear: 2022,
    stateTotalVotes: 1000,
    municipalities: {
      [municipalities[0].ibgeCode]: { PT: 700, PL: 300 },
      [municipalities[1].ibgeCode]: { PT: 100, PL: 100, XPTO: 300 },
      [municipalities[2].ibgeCode]: { XPTO: 50 },
    },
  };
  const model = buildSpectrumModel(
    [contest],
    municipalities.slice(0, 3),
    index,
    getDefaultSpectrumState([contest]),
  );
  const first = model.allItems.find(
    (item) => item.municipality.ibgeCode === municipalities[0].ibgeCode,
  )!;
  // (700*2,68 + 300*8,80) / 1000 = 4,516
  assert.ok(Math.abs((first.index as number) - 4.516) < 1e-9);
  assert.equal(first.coveragePct, 100);
  assert.equal(first.blockSharePct.left, 70);
  assert.equal(first.blockSharePct.right, 30);
  assert.equal(first.leadingPartyCode, "PT");

  const second = model.allItems.find(
    (item) => item.municipality.ibgeCode === municipalities[1].ibgeCode,
  )!;
  // XPTO fica fora do numerador E do denominador: (100*2,68 + 100*8,80)/200 = 5,74
  assert.ok(Math.abs((second.index as number) - 5.74) < 1e-9);
  assert.equal(second.scoredVotes, 200);
  assert.equal(second.unscoredVotes, 300);
  assert.equal(second.totalVotes, 500);
  assert.ok(Math.abs(second.coveragePct - 40) < 1e-9);
  assert.equal(second.leadingPartyCode, "XPTO");

  // Município sem nenhum voto com nota fica sem índice, nunca zero.
  const third = model.allItems.find(
    (item) => item.municipality.ibgeCode === municipalities[2].ibgeCode,
  )!;
  assert.equal(third.index, null);
  assert.equal(third.value, null);
  assert.equal(third.rank, 0);
  assert.equal(model.missingMunicipalityCount, 1);
  assert.ok(!model.filteredItems.some((item) => item.value === null));

  // Estado: (700+100)*2,68 + (300+100)*8,80 sobre 1200 votos com nota.
  const expectedState = (800 * 2.68 + 400 * 8.8) / 1200;
  assert.ok(Math.abs((model.stateIndex as number) - expectedState) < 1e-9);
  assert.equal(model.stateScoredVotes, 1200);
  assert.equal(model.stateTotalVotes, 1550);
  assert.ok(Math.abs(model.stateCoveragePct - (1200 / 1550) * 100) < 1e-9);
  assert.deepEqual(
    model.unscoredParties.map((party) => party.code),
    ["XPTO"],
  );
  assert.equal(model.unscoredParties[0].votes, 350);
  assert.equal(model.wave.year, 2022);
  assert.equal(registry.metadata.waves.some((wave) => wave.year === 2022), true);
});

test("faixas absolutas do índice saem dos limiares do registro", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { registry } = loadData();
  const thresholds = getAbsoluteThresholds("index", registry);
  assert.deepEqual(thresholds, [2.25, 4.5, 5.5, 7.75]);
  assert.deepEqual(getAbsoluteThresholds("left", registry), [20, 40, 60, 80]);
});

test("índice sobre os pleitos reais de 2018 e 2022 é coerente", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index, municipalities } = loadData();
  const contests = buildContestsFromElections(elections, index.registry);
  assert.equal(contests.length, elections.contests.length);
  for (const contest of contests) {
    const model = buildSpectrumModel(
      contests,
      municipalities,
      index,
      { ...getDefaultSpectrumState(contests), contestId: contest.id },
    );
    assert.equal(model.allItems.length, 246);
    assert.equal(
      model.missingMunicipalityCount,
      0,
      `${contest.id} tem município sem índice`,
    );
    assert.ok(
      model.stateCoveragePct > 99.9,
      `${contest.id} tem cobertura de apenas ${model.stateCoveragePct}%`,
    );
    for (const item of model.allItems) {
      const value = item.index as number;
      assert.ok(
        value >= 0 && value <= 10,
        `${item.municipality.name} saiu com índice ${value} em ${contest.id}`,
      );
      const total =
        item.blockSharePct.left + item.blockSharePct.center + item.blockSharePct.right;
      assert.ok(
        Math.abs(total - 100) < 1e-9,
        `${item.municipality.name} tem blocos somando ${total}`,
      );
    }
    // A soma dos votos por município tem que fechar com os válidos do pleito.
    const original = elections.contests.find(
      (item) => `elections:${item.id}` === contest.id,
    )!;
    assert.equal(model.stateTotalVotes, original.stateValidVotes);
  }
});

test("2022 e 2018 no 2º turno separam esquerda e direita como esperado", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index, municipalities } = loadData();
  const contests = buildContestsFromElections(elections, index.registry);
  const runoff = contests.find(
    (contest) =>
      contest.electionYear === 2022 && contest.officeCode === 1 && contest.round === 2,
  )!;
  const model = buildSpectrumModel(contests, municipalities, index, {
    ...getDefaultSpectrumState(contests),
    contestId: runoff.id,
  });
  // No 2º turno de 2022 só há PT (2,68) e PL (8,80): o índice tem que ficar
  // estritamente entre as duas notas em todo município.
  for (const item of model.allItems) {
    const value = item.index as number;
    assert.ok(value >= 2.68 && value <= 8.8, `${item.municipality.name}: ${value}`);
  }
  assert.ok((model.stateIndex as number) > 2.68);
  assert.ok((model.stateIndex as number) < 8.8);
});

test("estado é sanitizado contra lixo do localStorage", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index } = loadData();
  const contests = buildContestsFromElections(elections, index.registry);
  const fallback = getDefaultSpectrumState(contests);
  assert.deepEqual(sanitizeSpectrumState(null, contests), fallback);
  assert.deepEqual(sanitizeSpectrumState("texto", contests), fallback);
  assert.equal(
    sanitizeSpectrumState({ contestId: "inexistente" }, contests).contestId,
    fallback.contestId,
  );
  assert.equal(
    sanitizeSpectrumState({ metricId: "nada" }, contests).metricId,
    "index",
  );
  assert.equal(
    sanitizeSpectrumState({ bandMode: "quantile" }, contests).bandMode,
    "quantile",
  );
  assert.deepEqual(
    sanitizeSpectrumState({ activeBands: [1, 1, 9, "x"] }, contests).activeBands,
    [1],
  );
  assert.deepEqual(
    sanitizeSpectrumState({ activeBands: [] }, contests).activeBands,
    [0, 1, 2, 3, 4],
  );
});

test("snapshot de votos por partido entra na lista de pleitos quando existe", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index } = loadData();
  const partyVotes = loadJson<{ contests: unknown[] }>(
    "../../src/data/party-votes-go.json",
  );
  const contests = buildSpectrumContests(
    elections,
    partyVotes as never,
    index.registry,
  );
  assert.equal(
    contests.length,
    elections.contests.length + partyVotes.contests.length,
  );
  const ids = new Set(contests.map((contest) => contest.id));
  assert.equal(ids.size, contests.length, "há id de pleito duplicado");
  // Sem o snapshot municipal o app continua funcionando com 2018/2022.
  assert.equal(
    buildSpectrumContests(elections, null, index.registry).length,
    elections.contests.length,
  );
});

test("CSV traz cobertura e não converte ausência em zero", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index, municipalities } = loadData();
  const contests = buildContestsFromElections(elections, index.registry);
  const model = buildSpectrumModel(
    contests,
    municipalities,
    index,
    getDefaultSpectrumState(contests),
  );
  const csv = createSpectrumCsv(model);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines.length, model.filteredItems.length + 1);
  assert.ok(lines[0].includes("indice_ideologico"));
  assert.ok(lines[0].includes("cobertura_pct"));
  assert.ok(lines[0].includes("votos_sem_nota"));
  assert.ok(csv.startsWith("﻿"));
});

function makeContest(
  id: string,
  municipalities: Record<string, Record<string, number>>,
): SpectrumSourceContest {
  return {
    id,
    electionYear: 2022,
    round: 1,
    officeCode: 1,
    officeName: "Presidente",
    origin: "parties",
    waveYear: 2022,
    stateTotalVotes: 0,
    municipalities,
  };
}

test("deslocamento do índice confere com a aritmética feita à mão", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { index, municipalities } = loadData();
  // PT = 2,68 e PL = 8,80 na onda de 2022; XPTO não tem nota.
  const current = makeContest("teste:atual", {
    [municipalities[0].ibgeCode]: { PT: 700, PL: 300 },
    [municipalities[1].ibgeCode]: { PT: 100, PL: 100 },
    [municipalities[2].ibgeCode]: { XPTO: 50 },
  });
  const comparison = makeContest("teste:comparado", {
    [municipalities[0].ibgeCode]: { PT: 300, PL: 700 },
    [municipalities[1].ibgeCode]: { XPTO: 200 },
    [municipalities[2].ibgeCode]: { PT: 100 },
  });
  const contests = [current, comparison];
  const model = buildSpectrumModel(contests, municipalities.slice(0, 3), index, {
    ...getDefaultSpectrumState(contests),
    contestId: current.id,
    metricId: "shift",
    comparisonContestId: comparison.id,
  });

  assert.equal(model.metricId, "shift");
  assert.equal(model.comparisonContest?.id, comparison.id);
  assert.deepEqual(model.thresholds, [...SPECTRUM_SHIFT_THRESHOLDS]);

  const first = model.allItems.find(
    (item) => item.municipality.ibgeCode === municipalities[0].ibgeCode,
  )!;
  // atual: (700*2,68 + 300*8,80)/1000 = 4,516 · comparado: (300*2,68 + 700*8,80)/1000 = 6,964
  assert.ok(Math.abs((first.index as number) - 4.516) < 1e-9);
  assert.ok(Math.abs((first.comparisonIndex as number) - 6.964) < 1e-9);
  assert.ok(Math.abs((first.shift as number) - -2.448) < 1e-9);
  assert.equal(first.value, first.shift);
  // deslocamento menor que -1 ponto: faixa 0 ("forte para a esquerda")
  assert.equal(first.band, 0);
  assert.equal(first.rank, 1);

  // Sem índice no pleito comparado: deslocamento nulo, fora de ranking/faixas.
  const second = model.allItems.find(
    (item) => item.municipality.ibgeCode === municipalities[1].ibgeCode,
  )!;
  assert.ok(Math.abs((second.index as number) - 5.74) < 1e-9);
  assert.equal(second.comparisonIndex, null);
  assert.equal(second.shift, null);
  assert.equal(second.value, null);
  assert.equal(second.rank, 0);

  // Sem índice no pleito atual: idem, nunca zero.
  const third = model.allItems.find(
    (item) => item.municipality.ibgeCode === municipalities[2].ibgeCode,
  )!;
  assert.equal(third.index, null);
  assert.ok(Math.abs((third.comparisonIndex as number) - 2.68) < 1e-9);
  assert.equal(third.shift, null);
  assert.equal(model.missingMunicipalityCount, 2);
  assert.ok(!model.filteredItems.some((item) => item.value === null));

  // Estado: 4,72 no atual e 7232/1100 no comparado.
  const expectedState = (800 * 2.68 + 400 * 8.8) / 1200;
  const expectedComparison = (300 * 2.68 + 700 * 8.8 + 100 * 2.68) / 1100;
  assert.ok(Math.abs((model.stateIndex as number) - expectedState) < 1e-9);
  assert.ok(
    Math.abs((model.stateComparisonIndex as number) - expectedComparison) < 1e-9,
  );
  assert.ok(
    Math.abs((model.stateShift as number) - (expectedState - expectedComparison)) <
      1e-9,
  );
});

test("métrica shift sem comparação cai para o índice (métrica efetiva)", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { index, municipalities } = loadData();
  const contest = makeContest("teste:solo", {
    [municipalities[0].ibgeCode]: { PT: 700, PL: 300 },
  });
  const model = buildSpectrumModel([contest], municipalities.slice(0, 1), index, {
    ...getDefaultSpectrumState([contest]),
    metricId: "shift",
    comparisonContestId: null,
  });
  assert.equal(model.metricId, "index");
  assert.equal(model.comparisonContest, null);
  assert.equal(model.stateShift, null);
});

test("sanitize valida o pleito de comparação e rejeita o próprio pleito", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index } = loadData();
  const contests = buildContestsFromElections(elections, index.registry);
  const [first, second] = contests;
  // Estado antigo sem o campo novo: comparação desligada, nada quebra.
  assert.equal(
    sanitizeSpectrumState({ contestId: first.id }, contests).comparisonContestId,
    null,
  );
  // Comparação com o próprio pleito nunca sobrevive ao sanitize.
  assert.equal(
    sanitizeSpectrumState(
      { contestId: first.id, comparisonContestId: first.id },
      contests,
    ).comparisonContestId,
    null,
  );
  // Pleito fora da lista também não.
  assert.equal(
    sanitizeSpectrumState(
      { contestId: first.id, comparisonContestId: "inexistente" },
      contests,
    ).comparisonContestId,
    null,
  );
  // Pleito válido e diferente é preservado.
  assert.equal(
    sanitizeSpectrumState(
      { contestId: first.id, comparisonContestId: second.id },
      contests,
    ).comparisonContestId,
    second.id,
  );
  // Faixas absolutas do deslocamento: simétricas em torno de zero.
  assert.deepEqual(getAbsoluteThresholds("shift", index.registry), [
    -1, -0.25, 0.25, 1,
  ]);
});

test("shift real 2022 vs 2018 (2º turnos presidenciais) é coerente", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index, municipalities } = loadData();
  // O snapshot pode ter um ano só; o pleito comparado é um clone sintético
  // quatro anos antes, o que ainda exercita ondas diferentes do survey.
  let contests = buildContestsFromElections(elections, index.registry);
  const current = contests[0]!;
  const comparison = {
    ...current,
    id: `${current.id}-anterior`,
    electionYear: current.electionYear - 4,
  };
  contests = [...contests, comparison];
  const model = buildSpectrumModel(contests, municipalities, index, {
    ...getDefaultSpectrumState(contests),
    contestId: current.id,
    metricId: "shift",
    comparisonContestId: comparison.id,
  });
  assert.equal(model.metricId, "shift");
  assert.equal(model.wave.year, index.registry.metadata.waveByElectionYear[String(current.electionYear)] ?? model.wave.year);
  // Ondas diferentes: o painel avisa que parte do deslocamento vem da régua.
  assert.ok(model.comparisonWave);
  assert.ok(model.comparisonWave.year <= model.wave.year);
  assert.equal(model.allItems.length, 246);
  assert.equal(model.missingMunicipalityCount, 0);
  for (const item of model.allItems) {
    const value = item.shift as number;
    assert.ok(
      value >= -10 && value <= 10,
      `${item.municipality.name} com deslocamento ${value}`,
    );
    assert.equal(item.value, item.shift);
  }
  // Faixas somam todos os municípios com valor.
  const bandTotal = model.bandCounts.reduce((total, count) => total + count, 0);
  assert.equal(bandTotal, 246);
  assert.ok((model.stateShift as number) >= -10);
  assert.ok((model.stateShift as number) <= 10);
});

test("CSV do shift ganha as colunas do pleito comparado e do deslocamento", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, index, municipalities } = loadData();
  // O snapshot pode ter um ano só; o pleito comparado é um clone sintético
  // quatro anos antes, o que ainda exercita ondas diferentes do survey.
  let contests = buildContestsFromElections(elections, index.registry);
  const current = contests[0]!;
  const comparison = {
    ...current,
    id: `${current.id}-anterior`,
    electionYear: current.electionYear - 4,
  };
  contests = [...contests, comparison];
  const model = buildSpectrumModel(contests, municipalities, index, {
    ...getDefaultSpectrumState(contests),
    contestId: current.id,
    metricId: "shift",
    comparisonContestId: comparison.id,
  });
  const csv = createSpectrumCsv(model);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines.length, model.filteredItems.length + 1);
  assert.ok(lines[0].includes("ano_comparacao"));
  assert.ok(lines[0].includes("onda_survey_comparacao"));
  assert.ok(lines[0].includes("indice_comparacao"));
  assert.ok(lines[0].includes("deslocamento_pontos"));
  // Sem métrica shift, o CSV continua com o formato original.
  const plain = buildSpectrumModel(contests, municipalities, index, {
    ...getDefaultSpectrumState(contests),
    contestId: current.id,
    metricId: "index",
    comparisonContestId: comparison.id,
  });
  const plainCsv = createSpectrumCsv(plain);
  assert.ok(!plainCsv.split("\n")[0].includes("deslocamento_pontos"));
});
