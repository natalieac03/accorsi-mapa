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
import { MISSING_DATA_COLOR } from "../../src/utils/electorate.ts";
import {
  buildPollingModel,
  createPollingCsv,
  describePollingLayer,
  describePollingScope,
  formatPollingValue,
  getDefaultPollingState,
  getPollingBandLabel,
  getPollingCsvFilename,
  getPollingMetric,
  getPollingMetricColors,
  getPollingMetricShortLabel,
  getPollingRangeLabel,
  getPollingValueRatio,
  POLLING_METRICS,
  POLLING_SHARE_COLORS,
  POLLING_SHARE_THRESHOLDS,
  sanitizePollingState,
} from "../../src/utils/pollingPlaces.ts";
import { buildPartySpectrumIndex, SPECTRUM_COLORS } from "../../src/utils/spectrum.ts";

/**
 * MÉTRICA DA CAMADA SUBMUNICIPAL: índice ideológico 0–10 (padrão) ou
 * percentual de voto de uma sigla — as duas disponíveis em QUALQUER cargo, por
 * escolha de quem olha. Quem carrega a escolha é a sigla em foco: sem sigla, o
 * índice; com sigla, o percentual dela.
 *
 * Payload 100% sintético e inline: estes testes NUNCA são pulados por falta de
 * snapshot, porque não dependem de nenhum arquivo gerado pelo ETL. O único
 * arquivo real lido é o registro de notas dos partidos, que é versionado.
 */
const registry = JSON.parse(
  readFileSync(
    new URL("../../src/data/party-spectrum.json", import.meta.url),
    "utf8",
  ),
) as PartySpectrumRegistry;
const index = buildPartySpectrumIndex(registry);

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
const governador: SpectrumSourceContest = {
  ...presidente,
  id: "elections:2022-3-1",
  officeCode: 3,
  officeName: "Governador",
};
const prefeito: SpectrumSourceContest = {
  ...presidente,
  id: "parties:2024-11-1",
  electionYear: 2024,
  officeCode: 11,
  officeName: "Prefeito",
  origin: "parties",
};
const vereador: SpectrumSourceContest = {
  ...prefeito,
  id: "parties:2024-13-1",
  officeCode: 13,
  officeName: "Vereador",
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

// Escola grande, votação dividida: 700 PT e 300 PL em 1.000 votos apurados.
const escola = place({ id: "10010-1-1010", name: "Escola Central", electorate: 4000 });
// Local que apurou 500 votos e NENHUM deles foi para o PT: 0% é zero de
// verdade, não ausência de dado.
const clube = place({
  id: "10010-1-1020",
  name: "Clube do PL",
  neighborhood: "Setor Bueno",
  neighborhoodKey: "setor bueno",
  electorate: 1200,
  latitude: -16.7,
  longitude: -49.27,
});
// Local sem NENHUM voto apurado: sem denominador não existe percentual.
const semApuracao = place({
  id: "10010-2-2010",
  name: "Ginásio Sem Apuração",
  neighborhood: "Setor Oeste",
  neighborhoodKey: "setor oeste",
  zone: 2,
  electorate: 900,
  latitude: -16.66,
  longitude: -49.28,
});
// Local em que todo voto foi para sigla SEM nota no survey: fica sem índice
// ideológico, mas o percentual continua existindo (o denominador existe).
const semNota = place({
  id: "10010-2-2020",
  name: "Escola Sem Nota",
  neighborhood: "Setor Oeste",
  neighborhoodKey: "setor oeste",
  zone: 2,
  electorate: 700,
  latitude: -16.65,
  longitude: -49.29,
});
// Outro município, para o agregado municipal e o filtro.
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

const places = [escola, clube, semApuracao, semNota, anapolis];
const votes: Record<string, Record<string, number>> = {
  [escola.id]: { PT: 700, PL: 300 },
  [clube.id]: { PL: 500 },
  // semApuracao não tem chave nenhuma: nada foi apurado ali.
  [semNota.id]: { XPTO: 200 },
  [anapolis.id]: { PT: 100, PL: 900 },
};

function buildState(overrides: Partial<PollingState> = {}): PollingState {
  return { ...getDefaultPollingState([presidente]), ...overrides };
}

function buildModel(
  contest: SpectrumSourceContest,
  overrides: Partial<PollingState> = {},
) {
  return buildPollingModel({
    places,
    votes,
    index,
    registry,
    contest,
    state: buildState({ contestId: contest.id, ...overrides }),
  });
}

test("todo cargo abre no índice ideológico, inclusive Presidente e Governador", () => {
  // A medida não olha o cargo: olha se existe sigla em foco.
  assert.equal(getPollingMetric(null), "indice");
  assert.equal(getPollingMetric(undefined), "indice");
  assert.equal(getPollingMetric(""), "indice");
  // O alternador oferece as três medidas, com o índice na frente. A terceira
  // (votos da candidata) tem lista de pleitos própria e é coberta por inteiro
  // em pollingcandidata.test.ts.
  assert.deepEqual(
    POLLING_METRICS.map((option) => option.id),
    ["indice", "votoPartido", "votosCandidata"],
  );

  for (const contest of [presidente, governador, prefeito, vereador]) {
    // Estado padrão = nenhuma sigla escolhida = índice, em qualquer pleito.
    const model = buildModel(contest);
    assert.equal(model.metric, "indice");
    // Sem sigla em foco não há percentual por unidade.
    assert.equal(model.partyCode, "");
    const unit = model.units.find((item) => item.id === escola.id)!;
    assert.equal(unit.partySharePct, null);
    // (700 × 2,68 + 300 × 8,80) / 1000 = 4,516 — o valor da camada É o índice.
    assert.ok(Math.abs((unit.index as number) - 4.516) < 1e-9);
    assert.equal(unit.value, unit.index);
    // Faixas e cores continuam as do espectro, intocadas.
    assert.deepEqual(model.thresholds, [2.25, 4.5, 5.5, 7.75]);
    assert.equal(getPollingMetricColors(model.metric), SPECTRUM_COLORS);
    assert.equal(getPollingMetricShortLabel(model.metric, model.partyCode), "índice 0–10");
    assert.equal(getPollingBandLabel(model.metric, model.thresholds, 0), "Mais à esquerda");
    // E a explicação da tela é a do espectro, em todos eles.
    assert.ok(describePollingLayer(model).includes("índice ideológico 0–10"));
    assert.ok(describePollingScope(model).includes("índice agregado"));
    // Mesmo medindo o índice, as siglas do pleito continuam listadas: é delas
    // que o alternador tira a outra medida, em qualquer cargo.
    assert.deepEqual(
      model.partyOptions.map((option) => option.code),
      ["PL", "PT", "XPTO"],
    );
  }
});

test("escolher uma sigla troca a medida, também em qualquer cargo", () => {
  assert.equal(getPollingMetric("PT"), "votoPartido");

  // As duas medidas convivem no MESMO pleito municipal, que antes só tinha o
  // índice: o alternador não depende do cargo.
  const vereadorComSigla = buildModel(vereador, { partyCode: "PT" });
  assert.equal(vereadorComSigla.metric, "votoPartido");
  assert.equal(vereadorComSigla.partyCode, "PT");
  assert.equal(
    vereadorComSigla.units.find((item) => item.id === escola.id)!.value,
    70,
  );
  assert.equal(buildModel(vereador).metric, "indice");

  const model = buildModel(presidente, { partyCode: "PL" });
  assert.equal(model.metric, "votoPartido");
  assert.equal(model.officeName, "Presidente");
  assert.equal(model.partyCode, "PL");
  assert.deepEqual(
    model.partyOptions.map((option) => [option.code, option.votes]),
    [
      ["PL", 1700],
      ["PT", 800],
      ["XPTO", 200],
    ],
  );
  assert.ok(Math.abs(model.partyOptions[0].sharePct - (1700 / 2700) * 100) < 1e-9);

  // Faixas fixas de 0 a 100 e rampa sequencial, não a divergente do espectro.
  assert.deepEqual(model.thresholds, POLLING_SHARE_THRESHOLDS);
  assert.equal(getPollingMetricColors(model.metric), POLLING_SHARE_COLORS);
  assert.equal(getPollingMetricShortLabel(model.metric, model.partyCode), "% do PL");
  assert.equal(getPollingRangeLabel(model.metric, model.thresholds, 0), "Até 20,0%");
  assert.equal(
    getPollingRangeLabel(model.metric, model.thresholds, 4),
    "Acima de 80,0%",
  );

  // O valor da unidade é o percentual, e o índice deixa de ser a medida da
  // camada mesmo continuando calculado por baixo (o agente ainda o usa).
  const unit = model.units.find((item) => item.id === escola.id)!;
  assert.equal(unit.partyVotes, 300);
  assert.equal(unit.partySharePct, 30);
  assert.equal(unit.value, 30);
  assert.ok(Math.abs((unit.index as number) - 4.516) < 1e-9);

  // A explicação da tela muda com a MEDIDA, não com o cargo: fala da sigla,
  // diz que ali se lê distribuição de voto e lembra que o índice continua
  // disponível — nada de afirmar que este cargo não tem índice.
  const texto = describePollingLayer(model);
  assert.ok(texto.includes("PL"));
  assert.ok(texto.includes("distribuição de voto"));
  assert.ok(texto.includes("continua a um clique"));
  assert.ok(!texto.includes("Presidente"));
  assert.ok(!texto.includes("poucos nomes"));
  assert.ok(
    describePollingLayer(buildModel(presidente)).includes("índice ideológico 0–10"),
  );
  assert.ok(describePollingLayer(buildModel(vereador)).includes("índice ideológico 0–10"));
});

test("unidade sem denominador fica null e fora do ranking, jamais 0%", () => {
  const model = buildModel(presidente, { partyCode: "PT" });
  const vazio = model.units.find((item) => item.id === semApuracao.id)!;
  assert.equal(vazio.totalVotes, 0);
  assert.equal(vazio.partyVotes, 0);
  // Sem votos apurados não existe denominador: o percentual é AUSENTE.
  assert.equal(vazio.partySharePct, null);
  assert.equal(vazio.value, null);
  assert.equal(vazio.rank, 0);
  assert.ok(!model.filteredUnits.some((item) => item.id === semApuracao.id));
  assert.ok(model.filteredUnits.every((item) => item.value !== null));
  assert.equal(model.missingValueCount, 1);
  // A bolha existe (o local tem coordenada) com a cor de dado ausente.
  const bolha = model.bubbles.find((item) => item.id === semApuracao.id)!;
  assert.equal(bolha.value, null);
  assert.equal(bolha.color, MISSING_DATA_COLOR);
  assert.equal(bolha.focused, false);
  assert.equal(formatPollingValue(model.metric, null), "Sem voto apurado");
  // Sem valor não entra em faixa nenhuma: a soma das faixas ignora a unidade.
  assert.equal(
    model.bandCounts.reduce((total, count) => total + count, 0),
    model.units.length - 1,
  );
  // E não vai para o CSV do recorte em foco.
  assert.ok(!createPollingCsv(model).includes("Ginásio Sem Apuração"));
});

test("unidade com voto apurado e zero da sigla é 0 de verdade", () => {
  const model = buildModel(presidente, { partyCode: "PT" });
  const clubeUnit = model.units.find((item) => item.id === clube.id)!;
  // 500 votos apurados, nenhum do PT: zero medido, não ausência.
  assert.equal(clubeUnit.totalVotes, 500);
  assert.equal(clubeUnit.partyVotes, 0);
  assert.equal(clubeUnit.partySharePct, 0);
  assert.equal(clubeUnit.value, 0);
  assert.equal(clubeUnit.band, 0);
  assert.ok(clubeUnit.rank > 0);
  assert.ok(model.filteredUnits.some((item) => item.id === clube.id));
  assert.equal(formatPollingValue(model.metric, 0), "0,0%");
  assert.notEqual(formatPollingValue(model.metric, 0), formatPollingValue(model.metric, null));
  // A bolha do zero é pintada pela faixa mais clara da rampa, e a do sem
  // denominador com o cinza de ausência: as duas nunca se confundem.
  const bolhaZero = model.bubbles.find((item) => item.id === clube.id)!;
  assert.equal(bolhaZero.color, POLLING_SHARE_COLORS[0]);
  assert.notEqual(bolhaZero.color, MISSING_DATA_COLOR);
  // O CSV escreve 0, e deixa vazio só quando o valor é ausente.
  const linhas = createPollingCsv(model).trim().split("\n");
  const linhaClube = linhas.find((linha) => linha.includes("Clube do PL"))!;
  assert.ok(linhaClube.includes('"PT";"0";"0";"500"'));

  // Voto em sigla sem nota no survey não tem índice, mas TEM percentual: as
  // duas ausências são independentes.
  const semNotaUnit = model.units.find((item) => item.id === semNota.id)!;
  assert.equal(semNotaUnit.index, null);
  assert.equal(semNotaUnit.partySharePct, 0);
  assert.equal(semNotaUnit.value, 0);
  assert.ok(semNotaUnit.rank > 0);
  assert.equal(model.missingIndexCount, 2);
  assert.equal(model.missingValueCount, 1);
});

test("trocar a sigla recalcula unidades, resumo, faixas e ranking", () => {
  const comPl = buildModel(presidente, { partyCode: "PL" });
  const comPt = buildModel(presidente, { partyCode: "PT" });

  const escolaPl = comPl.units.find((item) => item.id === escola.id)!;
  const escolaPt = comPt.units.find((item) => item.id === escola.id)!;
  assert.equal(escolaPl.value, 30);
  assert.equal(escolaPt.value, 70);
  assert.equal(escolaPl.band, 1);
  assert.equal(escolaPt.band, 3);

  const anapolisPl = comPl.units.find((item) => item.id === anapolis.id)!;
  const anapolisPt = comPt.units.find((item) => item.id === anapolis.id)!;
  assert.equal(anapolisPl.value, 90);
  assert.equal(anapolisPt.value, 10);

  // Ranking inverte de ponta a ponta ao trocar a sigla.
  assert.deepEqual(
    comPl.filteredUnits.map((item) => item.id),
    [clube.id, anapolis.id, escola.id, semNota.id],
  );
  assert.deepEqual(
    comPt.filteredUnits.map((item) => item.id),
    [escola.id, anapolis.id, clube.id, semNota.id],
  );

  // Resumo do estado: PL 1.700 e PT 800 sobre 2.700 votos apurados.
  assert.equal(comPl.summary.partyVotes, 1700);
  assert.ok(Math.abs((comPl.summary.partySharePct as number) - (1700 / 2700) * 100) < 1e-9);
  assert.equal(comPt.summary.partyVotes, 800);
  assert.ok(Math.abs((comPt.summary.partySharePct as number) - (800 / 2700) * 100) < 1e-9);
  assert.ok(describePollingScope(comPt).includes("PT"));
  assert.ok(!describePollingScope(comPt).includes("índice"));

  // Agregado municipal (o que pinta o polígono e o PNG) acompanha a sigla.
  const goianiaPl = comPl.municipalityAggregates.find(
    (item) => item.ibgeCode === "5208707",
  )!;
  const goianiaPt = comPt.municipalityAggregates.find(
    (item) => item.ibgeCode === "5208707",
  )!;
  // Goiânia apurou 1.700 votos (1.000 + 500 + 200 sem nota).
  assert.equal(goianiaPl.totalVotes, 1700);
  assert.ok(Math.abs((goianiaPl.value as number) - (800 / 1700) * 100) < 1e-9);
  assert.ok(Math.abs((goianiaPt.value as number) - (700 / 1700) * 100) < 1e-9);

  // Bairro é soma de VOTOS antes do percentual, nunca média de percentuais.
  const porBairro = buildModel(presidente, {
    partyCode: "PT",
    viewMode: "neighborhoods",
  });
  const oeste = porBairro.units.find((item) => item.id === "5208707|setor oeste")!;
  // 0 voto do PT em 200 apurados (o local sem apuração não move o denominador).
  assert.equal(oeste.totalVotes, 200);
  assert.equal(oeste.partyVotes, 0);
  assert.equal(oeste.partySharePct, 0);
  assert.equal(oeste.placeCount, 2);
});

test("sigla escolhida sobrevive à troca de pleito, e some quando não tem voto", () => {
  // A sigla continua valendo em outro pleito que também a tem.
  assert.equal(buildModel(governador, { partyCode: "PT" }).partyCode, "PT");
  // Sigla sem nenhum voto apurado no pleito não vira filtro vazio: cede lugar
  // ao padrão (a mais votada), em vez de deixar o mapa inteiro sem valor.
  const inexistente = buildModel(presidente, { partyCode: "PSOL" });
  assert.equal(inexistente.partyCode, "PL");
  assert.ok(inexistente.filteredUnits.length > 0);
  // Em pleito municipal a escolha vale igual: ela não é mais ignorada por
  // causa do cargo.
  assert.equal(buildModel(vereador, { partyCode: "PT" }).partyCode, "PT");
  // Voltar para o índice é apagar a sigla — e nenhuma sigla é reposta por
  // baixo dos panos.
  const semSigla = buildModel(presidente, { partyCode: null });
  assert.equal(semSigla.metric, "indice");
  assert.equal(semSigla.partyCode, "");
  assert.ok(semSigla.filteredUnits.length > 0);

  // Sem arquivo de votos não há sigla nenhuma: nada é inventado. A escolha de
  // medida é respeitada mesmo assim — a camada diz "sem voto apurado", não
  // troca de medida sozinha.
  const semVotos = buildPollingModel({
    places,
    votes: null,
    index,
    registry,
    contest: presidente,
    state: buildState({ contestId: presidente.id, partyCode: "PT" }),
  });
  assert.equal(semVotos.metric, "votoPartido");
  assert.deepEqual(semVotos.partyOptions, []);
  assert.equal(semVotos.partyCode, "");
  assert.ok(semVotos.units.every((item) => item.value === null));
  assert.equal(semVotos.filteredUnits.length, 0);
  assert.equal(semVotos.summary.partySharePct, null);
  assert.equal(semVotos.missingValueCount, semVotos.units.length);
});

test("estado guarda a sigla escolhida e descarta lixo", () => {
  // Sem sigla guardada, a camada abre no índice: é o padrão da plataforma.
  assert.equal(getDefaultPollingState([presidente]).partyCode, null);
  assert.equal(
    getPollingMetric(getDefaultPollingState([presidente]).partyCode),
    "indice",
  );
  assert.equal(
    sanitizePollingState({ partyCode: "pt" }, [presidente]).partyCode,
    "PT",
  );
  assert.equal(
    sanitizePollingState({ partyCode: 42 }, [presidente]).partyCode,
    null,
  );
  assert.equal(
    sanitizePollingState({ partyCode: "<script>" }, [presidente]).partyCode,
    null,
  );
  assert.equal(sanitizePollingState(null, [presidente]).partyCode, null);
});

test("barrinha do ranking usa a escala certa de cada métrica", () => {
  // Índice mora em 0–10; percentual, em 0–100.
  assert.ok(Math.abs(getPollingValueRatio("indice", 5) - 0.5) < 1e-9);
  assert.ok(Math.abs(getPollingValueRatio("votoPartido", 50) - 0.5) < 1e-9);
  assert.equal(getPollingValueRatio("votoPartido", 0), 0);
  assert.equal(getPollingValueRatio("indice", null), 0);
});

test("CSV e PNG saem coerentes com a métrica ativa", () => {
  const model = buildModel(presidente, { partyCode: "PT" });
  const csv = createPollingCsv(model);
  const cabecalho = csv.trim().split("\n")[0];
  // Nenhuma coluna de índice ou de bloco sobra numa exportação de percentual.
  assert.ok(!cabecalho.includes("indice_ideologico"));
  assert.ok(!cabecalho.includes("esquerda_pct"));
  assert.ok(cabecalho.includes('"sigla";"votos_da_sigla";"percentual_da_sigla"'));
  assert.ok(csv.includes('"PT"'));
  assert.equal(
    getPollingCsvFilename(model),
    "locais-voto-pt-go-2022-1-1.csv",
  );
  // Sem sigla, o arquivo é o de sempre — em pleito municipal…
  assert.equal(
    getPollingCsvFilename(buildModel(vereador)),
    "locais-votacao-go-2024-13-1.csv",
  );
  // …e também em Presidente, que voltou a ter índice: o CSV traz de novo as
  // colunas de espectro que o cargo tinha perdido.
  const csvPresidenteIndice = createPollingCsv(buildModel(presidente));
  const cabecalhoIndice = csvPresidenteIndice.trim().split("\n")[0];
  assert.ok(cabecalhoIndice.includes("indice_ideologico"));
  assert.ok(cabecalhoIndice.includes("esquerda_pct"));
  assert.ok(!cabecalhoIndice.includes("percentual_da_sigla"));
  assert.equal(
    getPollingCsvFilename(buildModel(presidente)),
    "locais-votacao-go-2022-1-1.csv",
  );

  const png = buildPollingMapExport(model);
  assert.ok(png.title.includes("% de voto do PT"));
  assert.ok(!png.title.includes("ideológico"));
  assert.ok(!png.subtitle.includes("onda"));
  assert.ok(png.filename.startsWith("locais-voto-pt-"));
  // Legenda com a rampa sequencial, na ordem clara → escura.
  assert.deepEqual(
    png.legend.slice(0, 5).map((item) => item.color),
    [...POLLING_SHARE_COLORS],
  );
  assert.ok(png.legend[0].label.startsWith("Até 20,0%"));
  const goiania = png.styleById.get("5208707")!;
  assert.ok(goiania.valueLabel.endsWith("%"));

  // O PNG do índice sai igual em qualquer cargo, com a paleta do espectro.
  for (const contest of [vereador, presidente]) {
    const pngIndice = buildPollingMapExport(buildModel(contest));
    assert.equal(pngIndice.title, "Locais de votação · índice ideológico");
    assert.ok(pngIndice.subtitle.includes("onda"));
    assert.deepEqual(
      pngIndice.legend.slice(0, 5).map((item) => item.color),
      [...SPECTRUM_COLORS],
    );
  }
});
