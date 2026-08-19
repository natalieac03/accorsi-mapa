/**
 * Motor de métricas territoriais da aba Oportunidades — Rodada 1.
 *
 * Puro: sem React, sem fetch, sem estado. Recebe o snapshot da candidatura
 * (o mesmo `src/data/candidato/<slug>.json` que a aba de trajetória já usa) e
 * o índice de eleitorado, e devolve métricas por território. Isso permite
 * testar cada fórmula isolada, com números que dá para conferir na mão.
 *
 * O que este módulo NÃO faz, de propósito: não estima, não classifica, não
 * agrupa, não prevê. Ele responde "o que foi apurado, normalizado de formas
 * comparáveis". Similaridade, tipos de oportunidade e modelo de desempenho
 * esperado dependem destas métricas e vêm depois — construir na ordem inversa
 * seria erguer inferência sobre uma base que ninguém conferiu.
 */

import type {
  CandidateContest,
  CandidateDataset,
  ElectorateIndex,
} from "../types/candidate";
import type {
  BetaPrior,
  ConcentrationSummary,
  ContestMetrics,
  LiftReferenceId,
  OpportunityRankingMetricId,
  OpportunityRankingRow,
  SmoothingConfig,
  TerritoryMetrics,
} from "../types/opportunity";

/**
 * Padrão da suavização.
 *
 * `strength: 50` = um território precisa de ~50 votos válidos para a taxa
 * dele pesar tanto quanto a média geral. Abaixo disso a média domina. O
 * número é uma escolha, não uma descoberta — está aqui, num lugar só, para
 * ser discutido e ajustado com dado real, e é reportado na interface junto do
 * resultado.
 */
export const SUAVIZACAO_PADRAO: SmoothingConfig = {
  strength: 50,
  estimateFromData: true,
  maxStrength: 500,
};

/** Divisão que devolve null em vez de Infinity/NaN quando não há denominador. */
function dividir(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(denominador) || denominador <= 0) return null;
  const valor = numerador / denominador;
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Estima o prior beta pelo método dos momentos sobre as taxas observadas.
 *
 * A ideia: se as taxas municipais variam pouco em torno da média, a média é
 * informativa e o prior pode ser forte; se variam muito, cada território diz
 * algo próprio e o prior deve ser fraco. O método dos momentos lê exatamente
 * isso da distribuição, em vez de fixar um número no escuro.
 *
 * Cai para o valor configurado quando a estimativa não se sustenta: variância
 * nula (todos iguais), variância grande demais para uma beta, ou amostra
 * pequena. Nesses casos forçar a fórmula produziria alpha/beta negativos ou
 * absurdos — melhor usar o prior configurado e DIZER que foi ele.
 */
export function estimateBetaPrior(
  taxas: number[],
  config: SmoothingConfig = SUAVIZACAO_PADRAO,
): BetaPrior {
  const validas = taxas.filter(
    (taxa) => Number.isFinite(taxa) && taxa >= 0 && taxa <= 1,
  );
  const fallback = (media: number): BetaPrior => {
    const seguro = Number.isFinite(media) && media > 0 && media < 1 ? media : 0.5;
    return {
      alpha: seguro * config.strength,
      beta: (1 - seguro) * config.strength,
      strength: config.strength,
      mean: seguro,
      origin: "configurado",
      capped: false,
    };
  };

  if (validas.length === 0) return fallback(0.5);

  const media = validas.reduce((soma, taxa) => soma + taxa, 0) / validas.length;

  // Menos de 10 territórios não sustentam estimativa de variância.
  if (!config.estimateFromData || validas.length < 10) return fallback(media);

  const variancia =
    validas.reduce((soma, taxa) => soma + (taxa - media) ** 2, 0) /
    (validas.length - 1);

  const maxima = media * (1 - media);

  // Variância PRATICAMENTE nula (todas as taxas iguais) não pode passar por
  // `variancia <= 0`: com ponto flutuante, 40 valores idênticos dão algo como
  // 7e-33, e a fórmula abaixo devolveria força ~2e+31 — um prior que puxaria
  // TODO território exatamente para a média, apagando o sinal inteiro. O
  // limiar relativo cobre isso; comparar com zero absoluto, não.
  if (variancia <= maxima * 1e-9 || variancia >= maxima) return fallback(media);

  const forca = maxima / variancia - 1;
  if (!Number.isFinite(forca) || forca <= 0) return fallback(media);

  const limitada = Math.min(forca, config.maxStrength);
  return {
    alpha: media * limitada,
    beta: (1 - media) * limitada,
    strength: limitada,
    mean: media,
    origin: "estimado",
    capped: limitada < forca,
  };
}

/**
 * Taxa suavizada: (votos + alpha) / (validos + alpha + beta).
 *
 * Com muitos válidos o prior some e a taxa suavizada converge para a bruta;
 * com poucos, ela fica perto da média geral. É essa a proteção contra
 * "território minúsculo no topo do ranking por acidente".
 */
export function smoothRate(
  votos: number,
  validos: number,
  prior: BetaPrior,
): number | null {
  if (!Number.isFinite(validos) || validos <= 0) return null;
  return dividir(votos + prior.alpha, validos + prior.alpha + prior.beta);
}

/** Concentração da votação entre territórios, incluindo HHI e curva. */
export function summarizeConcentration(
  votosPorTerritorio: number[],
  totalNoEstado: number,
): ConcentrationSummary {
  const ordenados = [...votosPorTerritorio]
    .filter((votos) => Number.isFinite(votos) && votos > 0)
    .sort((a, b) => b - a);

  const total = totalNoEstado > 0 ? totalNoEstado : 0;
  const fatia = (n: number): number => {
    if (total <= 0) return 0;
    const soma = ordenados.slice(0, n).reduce((acc, votos) => acc + votos, 0);
    return soma / total;
  };

  // HHI em escala 0–10000, como a literatura de concentração usa.
  const hhi =
    total > 0
      ? ordenados.reduce((acc, votos) => acc + (votos / total) * (votos / total), 0) *
        10000
      : 0;

  let acumulado = 0;
  let territoriosParaMetade = 0;
  for (const votos of ordenados) {
    if (total <= 0) break;
    acumulado += votos;
    territoriosParaMetade += 1;
    if (acumulado / total >= 0.5) break;
  }

  return {
    top5: fatia(5),
    top10: fatia(10),
    top20: fatia(20),
    hhi,
    territoriosParaMetade,
  };
}

/**
 * Métricas de um pleito, território a território.
 *
 * `votosSomados` sai separado de `votosNoEstado` de propósito: os dois
 * precisam bater, e quando não batem isso é um defeito de agregação que
 * precisa aparecer, não ser escondido atrás de um número só.
 */
export function buildContestMetrics(
  contest: CandidateContest,
  eleitorado: ElectorateIndex,
  config: SmoothingConfig = SUAVIZACAO_PADRAO,
): ContestMetrics {
  const entradas = Object.entries(contest.municipios);

  let votosSomados = 0;
  let validosSomados = 0;
  const taxasObservadas: number[] = [];

  for (const [, municipio] of entradas) {
    votosSomados += municipio.votos;
    if (municipio.validos > 0) {
      validosSomados += municipio.validos;
      taxasObservadas.push(municipio.votos / municipio.validos);
    }
  }

  const prior = estimateBetaPrior(taxasObservadas, config);
  const taxaReferencia = dividir(votosSomados, validosSomados);

  const territorios: TerritoryMetrics[] = entradas.map(([ibgeCode, municipio]) => {
    const taxa = dividir(municipio.votos, municipio.validos);
    const taxaSuavizada = smoothRate(municipio.votos, municipio.validos, prior);
    const aptos = eleitorado?.[ibgeCode] ?? null;

    return {
      ibgeCode,
      nome: municipio.nome,
      votos: municipio.votos,
      validos: municipio.validos,
      taxa,
      taxaSuavizada,
      // Sobre o ELEITORADO apto, não sobre os válidos: são universos
      // diferentes, e misturar os dois é erro clássico de leitura.
      votosPorMil:
        aptos !== null && aptos > 0 ? (municipio.votos / aptos) * 1000 : null,
      // Lift usa a taxa SUAVIZADA: sem isso, o município minúsculo volta ao
      // topo pela porta dos fundos, agora com um lift absurdo.
      lift:
        taxaSuavizada !== null && taxaReferencia !== null && taxaReferencia > 0
          ? taxaSuavizada / taxaReferencia
          : null,
      participacaoNoBloco:
        municipio.percentualDoPartido !== null
          ? municipio.percentualDoPartido / 100
          : null,
      concentracao:
        contest.votosNoEstado > 0 ? municipio.votos / contest.votosNoEstado : 0,
      posicaoNoMunicipio: municipio.posicaoNoMunicipio,
      eleitorado: aptos,
    };
  });

  return {
    contestId: contest.id,
    electionYear: contest.electionYear,
    officeCode: contest.officeCode,
    officeName: contest.officeName,
    round: contest.round,
    votosNoEstado: contest.votosNoEstado,
    votosSomados,
    validosSomados,
    taxaReferencia,
    prior,
    concentracao: summarizeConcentration(
      territorios.map((territorio) => territorio.votos),
      contest.votosNoEstado,
    ),
    territorios,
    territoriosSemDenominador: territorios.filter(
      (territorio) => territorio.taxa === null,
    ).length,
  };
}

/** Métricas de todos os pleitos do snapshot, na ordem em que ele os traz. */
export function buildAllContestMetrics(
  dataset: CandidateDataset,
  eleitorado: ElectorateIndex,
  config: SmoothingConfig = SUAVIZACAO_PADRAO,
): ContestMetrics[] {
  return dataset.contests.map((contest) =>
    buildContestMetrics(contest, eleitorado, config),
  );
}

/**
 * Lift recalculado contra um subconjunto de territórios.
 *
 * A referência estadual responde "acima da média do estado?". Já um conjunto
 * (por exemplo, só os municípios de uma região) responde "acima da média dos
 * seus pares?" — pergunta diferente e, para decisão de campanha, muitas vezes
 * mais útil. A referência usada precisa aparecer na tela junto do número:
 * lift sem referência declarada não quer dizer nada.
 */
export function liftAgainst(
  territorios: TerritoryMetrics[],
  referencia: LiftReferenceId,
  metricas: ContestMetrics,
): Map<string, number | null> {
  const base =
    referencia === "estado"
      ? metricas.taxaReferencia
      : (() => {
          const votos = territorios.reduce((soma, t) => soma + t.votos, 0);
          const validos = territorios.reduce((soma, t) => soma + t.validos, 0);
          return dividir(votos, validos);
        })();

  const resultado = new Map<string, number | null>();
  for (const territorio of territorios) {
    resultado.set(
      territorio.ibgeCode,
      territorio.taxaSuavizada !== null && base !== null && base > 0
        ? territorio.taxaSuavizada / base
        : null,
    );
  }
  return resultado;
}

const VALOR_DA_METRICA: Record<
  OpportunityRankingMetricId,
  (territorio: TerritoryMetrics) => number | null
> = {
  taxaSuavizada: (t) => t.taxaSuavizada,
  lift: (t) => t.lift,
  votosPorMil: (t) => t.votosPorMil,
  participacaoNoBloco: (t) => t.participacaoNoBloco,
  votos: (t) => t.votos,
};

/**
 * Ranking por uma métrica, do maior para o menor.
 *
 * Território sem valor para a métrica NÃO entra — não vai para o fim da
 * lista com zero. Ausência e zero são coisas diferentes, e essa distinção é
 * exatamente o que o resto do projeto protege.
 *
 * Desempate estável e determinístico: votos, depois nome. Sem isso, dois
 * territórios com a mesma taxa trocariam de posição entre execuções.
 */
export function rankTerritories(
  metricas: ContestMetrics,
  metricId: OpportunityRankingMetricId,
  opcoes: { minimoDeValidos?: number } = {},
): OpportunityRankingRow[] {
  const minimo = opcoes.minimoDeValidos ?? 0;
  const extrair = VALOR_DA_METRICA[metricId];

  return metricas.territorios
    .filter((territorio) => territorio.validos >= minimo)
    .map((territorio) => ({ territorio, valor: extrair(territorio) }))
    .filter(
      (item): item is { territorio: TerritoryMetrics; valor: number } =>
        item.valor !== null && Number.isFinite(item.valor),
    )
    .sort(
      (a, b) =>
        b.valor - a.valor ||
        b.territorio.votos - a.territorio.votos ||
        a.territorio.nome.localeCompare(b.territorio.nome, "pt-BR"),
    )
    .map((item, indice) => ({
      ...item.territorio,
      valor: item.valor,
      posicao: indice + 1,
    }));
}
