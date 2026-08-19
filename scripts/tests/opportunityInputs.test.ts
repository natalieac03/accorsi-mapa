import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
} from "../../src/types/candidate.ts";
import type {
  ContestMetrics,
  TerritoryMetrics,
} from "../../src/types/opportunity.ts";
import {
  avaliarInsumos,
  contarTiposDisponiveis,
  diagnosticarLimiares,
  selecionarPleitos,
} from "../../src/utils/opportunityInputs.ts";
import { classifyTerritory } from "../../src/utils/opportunityTypes.ts";

/**
 * Fixtures SINTÉTICOS, inline — mesma disciplina dos outros testes desta aba:
 * nada aqui lê `src/data`, então nenhum teste fica SKIP antes do
 * `gerar_dados.sh`, e o arquivo roda igual em máquina recém-clonada.
 *
 * O que está sob teste é a fronteira entre "não achei" e "não pude procurar".
 * É a distinção que a aba inteira depende de acertar: um tipo com zero
 * municípios afirma que a busca aconteceu; um tipo sem insumo afirma que ela
 * não aconteceu. Confundir os dois entrega para a campanha uma conclusão que
 * o dado nunca sustentou.
 */

const ESTADO_COM_246 = 246;

function municipio(votos: number, validos: number): CandidateMunicipio {
  return {
    nome: `Município ${votos}`,
    votos,
    validos,
    percentualValidos: validos > 0 ? (votos / validos) * 100 : null,
    votosDoPartido: null,
    percentualDoPartido: null,
    posicaoNoMunicipio: null,
    candidaturasComVoto: 1,
  };
}

function pleito(
  id: string,
  electionYear: number,
  officeCode: number,
  officeName: string,
  municipiosComVoto: number,
): CandidateContest {
  const municipios: Record<string, CandidateMunicipio> = {};
  for (let indice = 0; indice < municipiosComVoto; indice += 1) {
    municipios[`52000${indice}`] = municipio(100 + indice, 5_000);
  }
  return {
    id,
    electionYear,
    officeCode,
    officeName,
    round: 1,
    candidatura: {
      sqCandidato: "0",
      nomeCompleto: "FULANA DE TAL",
      nomeUrna: "FULANA",
      partido: "PT",
      numero: "1310",
      situacaoCandidatura: "APTO",
      resultado: "NAO ELEITO",
    },
    votosNoEstado: 1_000,
    posicaoNoEstado: null,
    candidaturasNoPleito: 1,
    municipiosComVoto,
    concentracaoPercentual: { top5: 0, top10: 0, top20: 0 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios,
    locais: null,
    bairros: null,
  } as CandidateContest;
}

function dataset(contests: CandidateContest[]): CandidateDataset {
  return { metadata: {}, contests } as unknown as CandidateDataset;
}

function territorio(
  ibgeCode: string,
  extras: Partial<TerritoryMetrics> = {},
): TerritoryMetrics {
  return {
    ibgeCode,
    nome: `Território ${ibgeCode}`,
    votos: 500,
    validos: 10_000,
    taxa: 0.05,
    taxaSuavizada: 0.05,
    votosPorMil: null,
    lift: 1,
    participacaoNoBloco: null,
    concentracao: 0.1,
    posicaoNoMunicipio: null,
    eleitorado: null,
    ...extras,
  };
}

function metricas(territorios: TerritoryMetrics[]): ContestMetrics {
  return {
    contestId: "2022-6-1",
    electionYear: 2022,
    officeCode: 6,
    officeName: "Deputado Federal",
    round: 1,
    votosNoEstado: 1_000,
    votosSomados: 1_000,
    validosSomados: 20_000,
    taxaReferencia: 0.05,
    prior: {
      alpha: 2.5,
      beta: 47.5,
      strength: 50,
      mean: 0.05,
      origin: "configurado",
      capped: false,
    },
    concentracao: { top5: 0, top10: 0, top20: 0, hhi: 0, territoriosParaMetade: 0 },
    territorios,
    territoriosSemDenominador: 0,
  };
}

// ------------------------------------------------------ seleção de pleitos --

test("pleito de um município só não vira base territorial do estado", () => {
  // REGRESSÃO do defeito real desta instalação: o snapshot traz TRÊS
  // candidaturas a Prefeito (um município cada) e UMA a Deputado Federal (246).
  // A regra antiga — "o cargo com mais pleitos" — elegia Prefeito, e a aba
  // analisava Goiânia apresentando o resultado como mapa de Goiás.
  const selecao = selecionarPleitos(
    dataset([
      pleito("2024-11-1", 2024, 11, "Prefeito", 1),
      pleito("2020-11-1", 2020, 11, "Prefeito", 1),
      pleito("2016-11-1", 2016, 11, "Prefeito", 1),
      pleito("2022-6-1", 2022, 6, "Deputado Federal", 246),
    ]),
    ESTADO_COM_246,
  );

  assert.ok(selecao !== null);
  assert.equal(selecao.atual.officeName, "Deputado Federal");
  assert.equal(selecao.atual.electionYear, 2022);
  assert.equal(selecao.anterior, null);
  assert.equal(selecao.descartados.length, 3);
  // O descarte precisa carregar o número que o motivou: sem isso, a tela diz
  // "ficou de fora" sem dizer por quê, e ninguém audita a decisão.
  assert.ok(selecao.descartados.every((item) => item.municipiosComVoto === 1));
});

test("entre dois pleitos do mesmo cargo, nenhuma ressalva de comparação", () => {
  const selecao = selecionarPleitos(
    dataset([
      pleito("2018-6-1", 2018, 6, "Deputado Federal", 240),
      pleito("2022-6-1", 2022, 6, "Deputado Federal", 246),
    ]),
    ESTADO_COM_246,
  );

  assert.ok(selecao !== null);
  assert.equal(selecao.atual.electionYear, 2022);
  assert.equal(selecao.anterior?.electionYear, 2018);
  assert.equal(selecao.entreCargos, false);
  assert.equal(selecao.avisoDeComparacao, null);
});

test("o mesmo cargo tem preferência sobre o pleito mais recente de outro cargo", () => {
  const selecao = selecionarPleitos(
    dataset([
      pleito("2022-6-1", 2022, 6, "Deputado Federal", 246),
      // Mais recente que o de 2014, porém de outro cargo: não deve vencer.
      pleito("2020-7-1", 2020, 7, "Deputado Estadual", 244),
      pleito("2014-6-1", 2014, 6, "Deputado Federal", 230),
    ]),
    ESTADO_COM_246,
  );

  assert.ok(selecao !== null);
  assert.equal(selecao.anterior?.officeCode, 6);
  assert.equal(selecao.anterior?.electionYear, 2014);
  assert.equal(selecao.entreCargos, false);
});

test("comparação entre cargos acontece, mas sai declarada", () => {
  // O caso desta instalação: 2022 Deputado Federal contra 2018 Deputado
  // Estadual. Permitido porque o lift é posição relativa dentro de cada
  // pleito — e proibido de acontecer em silêncio.
  const selecao = selecionarPleitos(
    dataset([
      pleito("2022-6-1", 2022, 6, "Deputado Federal", 246),
      pleito("2018-7-1", 2018, 7, "Deputado Estadual", 236),
    ]),
    ESTADO_COM_246,
  );

  assert.ok(selecao !== null);
  assert.equal(selecao.entreCargos, true);
  assert.ok(selecao.avisoDeComparacao !== null);
  assert.match(selecao.avisoDeComparacao, /Deputado Federal/);
  assert.match(selecao.avisoDeComparacao, /Deputado Estadual/);
});

test("sem nenhum pleito de cobertura estadual, a seleção devolve null", () => {
  // null, não um pleito qualquer: a aba prefere não abrir a fingir que abriu.
  assert.equal(
    selecionarPleitos(
      dataset([pleito("2024-11-1", 2024, 11, "Prefeito", 1)]),
      ESTADO_COM_246,
    ),
    null,
  );
});

// -------------------------------------------------- disponibilidade de tipo --

function insumosDeUmPleitoSo() {
  const selecao = selecionarPleitos(
    dataset([pleito("2022-6-1", 2022, 6, "Deputado Federal", 246)]),
    ESTADO_COM_246,
  );
  assert.ok(selecao !== null);
  return avaliarInsumos({
    selecao,
    metricas: metricas([territorio("5200050"), territorio("5200100")]),
    ancoras: [],
    territoriosComSimilaridade: 0,
    territoriosComComparecimento: 0,
  });
}

test("sem eleição anterior, consolidação e recuperação são incalculáveis", () => {
  const insumos = insumosDeUmPleitoSo();
  assert.equal(insumos.consolidacao.disponivel, false);
  assert.equal(insumos.recuperacao.disponivel, false);
  // O motivo precisa dizer o que falta, não só que falta.
  assert.match(insumos.consolidacao.motivo, /duas eleições/);
});

test("bloco partidário nulo em todo território torna os dois tipos incalculáveis", () => {
  const insumos = insumosDeUmPleitoSo();
  assert.equal(insumos.forcaPessoal.disponivel, false);
  assert.equal(insumos.afinidadeNaoConvertida.disponivel, false);
  assert.match(insumos.forcaPessoal.motivo, /percentualDoPartido/);
});

test("um único território com bloco apurado já libera os tipos partidários", () => {
  // A verificação é contra o DADO carregado, não contra uma lista fixa de
  // "tipos suportados": no dia em que o ETL do bloco rodar, os tipos voltam
  // sozinhos, sem editar código.
  const selecao = selecionarPleitos(
    dataset([pleito("2022-6-1", 2022, 6, "Deputado Federal", 246)]),
    ESTADO_COM_246,
  );
  assert.ok(selecao !== null);

  const insumos = avaliarInsumos({
    selecao,
    metricas: metricas([
      territorio("5200050", { participacaoNoBloco: 0.42 }),
      territorio("5200100"),
    ]),
    ancoras: [],
    territoriosComSimilaridade: 0,
    territoriosComComparecimento: 0,
  });

  assert.equal(insumos.forcaPessoal.disponivel, true);
  assert.equal(insumos.forcaPessoal.motivo, "");
});

test("sem âncora não há perfil de referência: expansão e nova fronteira caem", () => {
  const insumos = insumosDeUmPleitoSo();
  assert.equal(insumos.expansao.disponivel, false);
  assert.equal(insumos.novaFronteira.disponivel, false);
  assert.match(insumos.expansao.motivo, /âncora/);
});

test("mobilização diz que depende de um ETL que não existe no projeto", () => {
  const insumos = insumosDeUmPleitoSo();
  assert.equal(insumos.mobilizacao.disponivel, false);
  assert.match(insumos.mobilizacao.motivo, /comparecimento/);
  // A frase precisa fechar a porta da leitura errada explicitamente.
  assert.match(insumos.mobilizacao.motivo, /incalculável/);
});

test("com âncoras e similaridade, os tipos de perfil ficam disponíveis", () => {
  const selecao = selecionarPleitos(
    dataset([
      pleito("2022-6-1", 2022, 6, "Deputado Federal", 246),
      pleito("2018-6-1", 2018, 6, "Deputado Federal", 240),
    ]),
    ESTADO_COM_246,
  );
  assert.ok(selecao !== null);

  const insumos = avaliarInsumos({
    selecao,
    metricas: metricas([territorio("5200050"), territorio("5200100")]),
    ancoras: [territorio("5200050", { lift: 1.4 })],
    territoriosComSimilaridade: 2,
    territoriosComComparecimento: 0,
  });

  assert.equal(insumos.expansao.disponivel, true);
  assert.equal(insumos.novaFronteira.disponivel, true);
  assert.equal(insumos.consolidacao.disponivel, true);
  // Comparecimento continua ausente: 6 de 7, nunca 7 de 7 por arrasto.
  assert.equal(insumos.mobilizacao.disponivel, false);
  assert.equal(contarTiposDisponiveis(insumos), 4);
});

// --------------------------------------------- propagação da ressalva ------

test("a ressalva de comparação chega aos avisos do território classificado", () => {
  const aviso = "Comparação entre cargos diferentes: teste.";
  const classificacao = classifyTerritory({
    ibgeCode: "5200050",
    nome: "Abadia de Goiás",
    atual: territorio("5200050", { lift: 1.4 }),
    anterior: territorio("5200050", { lift: 1.38 }),
    similaridade: 80,
    comparecimento: null,
    comparecimentoReferencia: null,
    avisoDeComparacao: aviso,
  });

  assert.ok(classificacao.avisos.includes(aviso));
});

test("sem pleito anterior, o aviso é o da ausência — não o da comparação", () => {
  // Os dois avisos são excludentes por construção: não existe comparação
  // entre cargos quando não existe segundo pleito. Ver os dois juntos seria
  // sinal de que a seleção passou uma ressalva órfã.
  const classificacao = classifyTerritory({
    ibgeCode: "5200050",
    nome: "Abadia de Goiás",
    atual: territorio("5200050"),
    anterior: null,
    similaridade: 80,
    comparecimento: null,
    comparecimentoReferencia: null,
    avisoDeComparacao: "não deveria aparecer",
  });

  assert.ok(
    classificacao.avisos.some((aviso) => aviso.includes("uma eleição comparável")),
  );
  assert.ok(!classificacao.avisos.includes("não deveria aparecer"));
});

// ------------------------------------------- poder de separação do limiar --

test("limiar que aprova quase todo mundo é marcado como pouco seletivo", () => {
  // REGRESSÃO da leitura do dado real: com as âncoras desta instalação, a
  // similaridade de Gower fica entre 66% e 87%, então o corte de 70% aprova
  // 245 de 246 municípios. O corte continua sendo o configurado — mover
  // limiar depois de ver o resultado é exatamente o que o portão da Rodada 3
  // existe para impedir —, mas a tela precisa mostrar que ele não separa.
  const territorios = Array.from({ length: 100 }, (_, indice) =>
    territorio(`52${String(indice).padStart(5, "0")}`, { lift: 1 }),
  );
  const similaridades = new Map(
    territorios.map((t, indice) => [t.ibgeCode, 66 + (indice % 21)]),
  );

  const diagnostico = diagnosticarLimiares(
    metricas(territorios),
    similaridades,
    {
      liftAlto: 1.25,
      liftBaixo: 0.75,
      similaridadeAlta: 60,
      minimoDeValidos: 200,
    },
  );

  const perfil = diagnostico.find((item) => item.rotulo === "Perfil compatível");
  assert.ok(perfil !== undefined);
  assert.equal(perfil.passam, 100);
  assert.equal(perfil.poucoSeletivo, true);
});

test("limiar que separa de verdade não é marcado", () => {
  const territorios = Array.from({ length: 100 }, (_, indice) =>
    territorio(`52${String(indice).padStart(5, "0")}`, { lift: 1 }),
  );
  const similaridades = new Map(
    territorios.map((t, indice) => [t.ibgeCode, indice]),
  );

  const diagnostico = diagnosticarLimiares(
    metricas(territorios),
    similaridades,
    {
      liftAlto: 1.25,
      liftBaixo: 0.75,
      similaridadeAlta: 50,
      minimoDeValidos: 200,
    },
  );

  const perfil = diagnostico.find((item) => item.rotulo === "Perfil compatível");
  assert.ok(perfil !== undefined);
  assert.equal(perfil.passam, 50);
  assert.equal(perfil.poucoSeletivo, false);
});

test("similaridade ausente sai do denominador, não conta como reprovada", () => {
  const territorios = [territorio("5200050"), territorio("5200100")];
  const similaridades = new Map<string, number | null>([
    ["5200050", 90],
    ["5200100", null],
  ]);

  const perfil = diagnosticarLimiares(metricas(territorios), similaridades, {
    liftAlto: 1.25,
    liftBaixo: 0.75,
    similaridadeAlta: 70,
    minimoDeValidos: 200,
  }).find((item) => item.rotulo === "Perfil compatível");

  assert.ok(perfil !== undefined);
  // 1 de 1, não 1 de 2: quem não pôde ser medido não reprova.
  assert.equal(perfil.total, 1);
  assert.equal(perfil.passam, 1);
});
