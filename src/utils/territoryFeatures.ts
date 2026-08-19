/**
 * Matriz de características territoriais e similaridade de Gower — Rodada 2.
 *
 * ESCALA: municipal, e só. Os indicadores ricos do IBGE (renda, PIB per
 * capita, densidade, saneamento) existem por município; o comportamento
 * eleitoral fino existe por seção. Comparar uma seção de Goiânia com um
 * município inteiro é possível, mas é comparação entre universos diferentes,
 * e o resultado carrega uma confiança que não se recupera depois. Enquanto
 * não houver dado socioeconômico na granularidade da seção, este módulo se
 * mantém municipal e diz isso em voz alta, em vez de misturar as escalas e
 * apresentar o resultado como se fossem a mesma coisa.
 *
 * Por que Gower e não distância euclidiana: as variáveis estão em unidades
 * incomparáveis (reais, pessoas por km², percentuais, contagem). Gower
 * normaliza cada uma pelo próprio intervalo observado antes de comparar, e
 * — o que mais importa aqui — lida com AUSENTE sem transformar em zero:
 * variável que falta nos dois lados simplesmente sai da conta daquele par,
 * com o peso redistribuído. Zerar um ausente diria "esse município tem renda
 * zero", que é falso e empurraria o território para um canto do espaço.
 */

import type { AgeStructureDataset } from "../types/ageStructure";
import type { ElectorateDataset } from "../types/electorate";
import type { LiteracyDataset } from "../types/literacy";
import type { SocioeconomicDataset } from "../types/socioeconomic";

/** Uma variável da matriz, com procedência para a interface exibir. */
export type FeatureDefinition = {
  id: string;
  label: string;
  /** Fonte oficial e ano — a interface precisa mostrar isto junto do número. */
  fonte: string;
  /** Peso relativo na distância de Gower. */
  peso: number;
};

export type TerritoryFeatures = {
  ibgeCode: string;
  nome: string;
  /** id da feature -> valor; null = dado indisponível, nunca zero. */
  valores: Record<string, number | null>;
};

export type FeatureMatrix = {
  definicoes: FeatureDefinition[];
  territorios: TerritoryFeatures[];
  /** Intervalo observado por feature, usado para normalizar as diferenças. */
  intervalos: Record<string, { min: number; max: number } | null>;
  /** Quantos territórios têm valor para cada feature. */
  cobertura: Record<string, number>;
};

export type SimilarityDetail = {
  featureId: string;
  label: string;
  /** 0 = idêntico, 1 = extremos opostos do intervalo observado. */
  distancia: number;
  valorA: number | null;
  valorB: number | null;
};

export type SimilarityResult = {
  ibgeCode: string;
  nome: string;
  /** 0–100. */
  similaridade: number;
  /** Quantas features entraram na conta (as duas pontas tinham valor). */
  featuresComparadas: number;
  /** Quantas ficaram de fora por ausência. */
  featuresAusentes: number;
  /** As que mais aproximam, menor distância primeiro. */
  aproximam: SimilarityDetail[];
  /** As que mais afastam, maior distância primeiro. */
  afastam: SimilarityDetail[];
};

/**
 * Definição das features.
 *
 * Escolhas deliberadas:
 *
 * - PERCENTUAIS e razões, não contagens absolutas. População absoluta faria a
 *   similaridade virar "tamanho parecido", e tamanho já é tratado à parte
 *   (escala) nas métricas da Rodada 1.
 *
 * - Das cinco faixas etárias, entram QUATRO. As cinco somam 100% por
 *   construção, então a quinta é redundante: mantê-la conta a mesma
 *   informação duas vezes e infla o peso de idade sobre o resto. É o mesmo
 *   motivo pelo qual só entra a taxa de alfabetização, e não também a de
 *   não-alfabetização.
 *
 * - Nada de raça, deficiência ou nome social. Não é limitação técnica: esses
 *   dados existem no snapshot do eleitorado. É recusa deliberada de usar
 *   atributo sensível como sinal político.
 */
export const FEATURES: FeatureDefinition[] = [
  { id: "densidade", label: "Densidade demográfica", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "pibPerCapita", label: "PIB per capita", fonte: "IBGE 2023", peso: 1 },
  { id: "salarioMedio", label: "Salário médio formal", fonte: "IBGE 2024", peso: 1 },
  { id: "ocupacao", label: "População ocupada", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "baixaRenda", label: "População de baixa renda", fonte: "IBGE 2010", peso: 1 },
  { id: "escolarizacao", label: "Escolarização 6–14", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "saneamento", label: "Saneamento adequado", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "alfabetizacao", label: "Alfabetização 15+", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "jovens18a24", label: "Faixa 18–24 anos", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "adultos25a39", label: "Faixa 25–39 anos", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "adultos40a59", label: "Faixa 40–59 anos", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "idosos60mais", label: "Faixa 60+ anos", fonte: "IBGE Censo 2022", peso: 1 },
  { id: "eleitoradoSobrePop", label: "Eleitorado sobre população", fonte: "TSE + IBGE", peso: 1 },
  { id: "biometria", label: "Cobertura de biometria", fonte: "TSE", peso: 1 },
];

function razao(numerador: number | null | undefined, denominador: number | null | undefined): number | null {
  if (numerador === null || numerador === undefined) return null;
  if (denominador === null || denominador === undefined || denominador <= 0) return null;
  const valor = numerador / denominador;
  return Number.isFinite(valor) ? valor : null;
}

/** Monta a matriz a partir dos snapshots já existentes no projeto. */
export function buildFeatureMatrix(sources: {
  socioeconomic: SocioeconomicDataset | null;
  ageStructure: AgeStructureDataset | null;
  literacy: LiteracyDataset | null;
  electorate: ElectorateDataset | null;
}): FeatureMatrix {
  const codigos = new Set<string>();
  for (const municipio of Object.keys(sources.electorate?.municipalities ?? {})) {
    codigos.add(municipio);
  }
  for (const municipio of Object.keys(sources.socioeconomic?.municipalities ?? {})) {
    codigos.add(municipio);
  }

  const territorios: TerritoryFeatures[] = [...codigos].sort().map((ibgeCode) => {
    const socio = sources.socioeconomic?.municipalities?.[ibgeCode]?.values ?? null;
    const idade = sources.ageStructure?.municipalities?.[ibgeCode] ?? null;
    const alfa = sources.literacy?.municipalities?.[ibgeCode] ?? null;
    const eleitoral = sources.electorate?.municipalities?.[ibgeCode] ?? null;

    const pop16 = idade?.population16Plus ?? null;

    return {
      ibgeCode,
      nome: eleitoral?.name ?? sources.socioeconomic?.municipalities?.[ibgeCode]?.name ?? "",
      valores: {
        densidade: socio?.populationDensity ?? null,
        pibPerCapita: socio?.gdpPerCapita ?? null,
        salarioMedio: socio?.formalAverageSalary ?? null,
        ocupacao: socio?.occupiedPopulation ?? null,
        baixaRenda: socio?.lowIncomePopulation ?? null,
        escolarizacao: socio?.schoolAttendance ?? null,
        saneamento: socio?.adequateSanitation ?? null,
        alfabetizacao: alfa?.literacyRate ?? null,
        jovens18a24: razao(idade?.bands?.a18to24, pop16),
        adultos25a39: razao(idade?.bands?.a25to39, pop16),
        adultos40a59: razao(idade?.bands?.a40to59, pop16),
        idosos60mais: razao(idade?.bands?.a60plus, pop16),
        eleitoradoSobrePop: razao(eleitoral?.electorate, idade?.populationTotal),
        biometria: razao(eleitoral?.biometrics, eleitoral?.electorate),
      },
    };
  });

  const intervalos: FeatureMatrix["intervalos"] = {};
  const cobertura: FeatureMatrix["cobertura"] = {};

  for (const definicao of FEATURES) {
    const valores = territorios
      .map((territorio) => territorio.valores[definicao.id])
      .filter((valor): valor is number => valor !== null && Number.isFinite(valor));

    cobertura[definicao.id] = valores.length;
    intervalos[definicao.id] =
      valores.length > 0
        ? { min: Math.min(...valores), max: Math.max(...valores) }
        : null;
  }

  return { definicoes: FEATURES, territorios, intervalos, cobertura };
}

/**
 * Distância de Gower entre dois territórios.
 *
 * Para cada variável presente nos DOIS, a diferença absoluta é dividida pelo
 * intervalo observado da variável — o que a põe em [0,1] e torna comparável
 * com as demais. A distância final é a média ponderada dessas diferenças.
 *
 * Variável ausente em qualquer um dos lados sai da conta e do denominador:
 * o peso é redistribuído entre as que restaram, em vez de virar zero (que
 * significaria "iguais") ou um (que significaria "opostos"). As duas
 * alternativas seriam invenção.
 *
 * Devolve null quando nenhuma variável é comparável — não zero, que seria
 * lido como "idênticos".
 */
export function gowerDistance(
  a: TerritoryFeatures,
  b: TerritoryFeatures,
  matriz: FeatureMatrix,
): { distancia: number | null; detalhes: SimilarityDetail[]; ausentes: number } {
  let somaPesos = 0;
  let somaPonderada = 0;
  let ausentes = 0;
  const detalhes: SimilarityDetail[] = [];

  for (const definicao of matriz.definicoes) {
    const valorA = a.valores[definicao.id] ?? null;
    const valorB = b.valores[definicao.id] ?? null;
    const intervalo = matriz.intervalos[definicao.id];

    if (valorA === null || valorB === null || !intervalo) {
      ausentes += 1;
      continue;
    }

    const amplitude = intervalo.max - intervalo.min;
    // Variável constante em todo o estado não distingue ninguém: incluí-la
    // com distância 0 inflaria artificialmente a similaridade de todo par.
    if (amplitude <= 0) {
      ausentes += 1;
      continue;
    }

    const distancia = Math.min(1, Math.abs(valorA - valorB) / amplitude);
    somaPesos += definicao.peso;
    somaPonderada += definicao.peso * distancia;
    detalhes.push({
      featureId: definicao.id,
      label: definicao.label,
      distancia,
      valorA,
      valorB,
    });
  }

  return {
    distancia: somaPesos > 0 ? somaPonderada / somaPesos : null,
    detalhes,
    ausentes,
  };
}

/**
 * Territórios mais parecidos com uma âncora, do mais para o menos parecido.
 *
 * `minimoDeFeatures` evita o caso perverso em que dois territórios com quase
 * tudo ausente batem numa única variável e aparecem como 98% similares. Com
 * poucas variáveis comparadas, a similaridade não é informação, é acaso.
 */
export function findSimilarTerritories(
  ancoraIbge: string,
  matriz: FeatureMatrix,
  opcoes: { minimoDeFeatures?: number; limite?: number } = {},
): SimilarityResult[] {
  const minimo = opcoes.minimoDeFeatures ?? 6;
  const ancora = matriz.territorios.find((t) => t.ibgeCode === ancoraIbge);
  if (!ancora) return [];

  const resultados: SimilarityResult[] = [];

  for (const candidato of matriz.territorios) {
    if (candidato.ibgeCode === ancoraIbge) continue;

    const { distancia, detalhes, ausentes } = gowerDistance(ancora, candidato, matriz);
    if (distancia === null || detalhes.length < minimo) continue;

    const ordenados = [...detalhes].sort((x, y) => x.distancia - y.distancia);
    resultados.push({
      ibgeCode: candidato.ibgeCode,
      nome: candidato.nome,
      similaridade: (1 - distancia) * 100,
      featuresComparadas: detalhes.length,
      featuresAusentes: ausentes,
      aproximam: ordenados.slice(0, 3),
      afastam: ordenados.slice(-3).reverse(),
    });
  }

  return resultados
    .sort(
      (x, y) =>
        y.similaridade - x.similaridade ||
        y.featuresComparadas - x.featuresComparadas ||
        x.nome.localeCompare(y.nome, "pt-BR"),
    )
    .slice(0, opcoes.limite ?? resultados.length);
}

/**
 * Similaridade média de um território contra um CONJUNTO de âncoras.
 *
 * É assim que "parecido com as bases onde o candidato vai bem" é medido sem
 * clusterização: em vez de descobrir grupos, usamos como âncora os
 * territórios de desempenho comprovado (que as métricas da Rodada 1 já
 * identificam) e perguntamos quão perto cada outro território está deles.
 */
export function similarityToAnchors(
  ibgeCode: string,
  ancoras: string[],
  matriz: FeatureMatrix,
  opcoes: { minimoDeFeatures?: number } = {},
): { similaridade: number | null; comparacoes: number } {
  const alvo = matriz.territorios.find((t) => t.ibgeCode === ibgeCode);
  if (!alvo) return { similaridade: null, comparacoes: 0 };

  const minimo = opcoes.minimoDeFeatures ?? 6;
  const valores: number[] = [];

  for (const ancoraIbge of ancoras) {
    if (ancoraIbge === ibgeCode) continue;
    const ancora = matriz.territorios.find((t) => t.ibgeCode === ancoraIbge);
    if (!ancora) continue;
    const { distancia, detalhes } = gowerDistance(alvo, ancora, matriz);
    if (distancia === null || detalhes.length < minimo) continue;
    valores.push((1 - distancia) * 100);
  }

  if (valores.length === 0) return { similaridade: null, comparacoes: 0 };
  return {
    similaridade: valores.reduce((soma, v) => soma + v, 0) / valores.length,
    comparacoes: valores.length,
  };
}
