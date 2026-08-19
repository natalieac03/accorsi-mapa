/**
 * O GATE — Rodada 3.
 *
 * Regra combinada antes de escrever qualquer linha de k-means: se não
 * validar, não sobe. Este arquivo é onde essa regra vira código, e não
 * intenção.
 *
 * Por que um gate, e por que aqui: clusterização e regressão são as únicas
 * peças deste módulo que podem simplesmente NÃO funcionar com n=246
 * municípios e variáveis correlacionadas. K-means sempre devolve k grupos —
 * inclusive quando não existe grupo nenhum no dado. Elastic Net sempre
 * devolve coeficientes — inclusive quando não há sinal. Os dois falham
 * produzindo resultado de aparência normal, e é por isso que o critério
 * precisa ser fixado ANTES de ver o resultado: depois, sempre dá para
 * afrouxar um limiar até o número passar.
 *
 * Se o gate reprovar, a aba continua funcionando com os tipos por regra da
 * Rodada 2, que não dependem de estimação nenhuma. Perder os perfis é perder
 * um componente; publicar perfis inventados custaria a confiança no módulo
 * inteiro.
 */

import { silhouetteDeReferencia, type ClusterPoint, type ClusterResult } from "./clustering.ts";
import type { CrossValidationResult } from "./expectedPerformance";

export type GateCriteria = {
  /** Observações mínimas para clusterizar e validar. */
  minimoDeObservacoes: number;
  /** Silhouette médio mínimo. */
  silhouetteMinimo: number;
  /** Tamanho absoluto mínimo de cada cluster. */
  clusterMinimoAbsoluto: number;
  /** Tamanho mínimo de cada cluster como fração do total. */
  clusterMinimoRelativo: number;
  /** R² fora da amostra mínimo. */
  r2Minimo: number;
  /**
   * Margem que o silhouette real precisa ter sobre o de dado SEM estrutura.
   *
   * Sem isso, o critério absoluto sozinho aprova ruído: uma nuvem uniforme
   * chega a silhouette 0,51 com k=4, porque qualquer partição de uma nuvem
   * uniforme é compacta e silhouette premia compacidade.
   */
  margemSobreReferencia: number;
};

/**
 * Os limiares.
 *
 * Números escolhidos e justificados, fixados antes de rodar contra o dado
 * real — que é a única forma de um critério significar alguma coisa:
 *
 * - silhouette 0,35: abaixo disso a literatura trata a estrutura como fraca
 *   demais para sustentar interpretação. Chamar de "perfil" um agrupamento
 *   com silhouette 0,2 seria dar nome a ruído.
 * - cluster com ao menos 10 territórios E 5% do total: um grupo de três
 *   municípios não é um perfil, é uma coincidência com rótulo.
 * - R² fora da amostra 0,20: abaixo disso a "lacuna" entre estimado e
 *   observado é majoritariamente erro do modelo, não característica do
 *   território — e a aba estaria apontando oportunidades que são ruído de
 *   previsão.
 * - 60 observações: piso para 5 dobras de validação cruzada terem tamanho
 *   utilizável.
 */
export const CRITERIOS: GateCriteria = {
  minimoDeObservacoes: 60,
  silhouetteMinimo: 0.35,
  clusterMinimoAbsoluto: 10,
  clusterMinimoRelativo: 0.05,
  r2Minimo: 0.2,
  margemSobreReferencia: 0.1,
};

export type GateCheck = {
  nome: string;
  aprovado: boolean;
  /** Valor medido, formatado para leitura. */
  medido: string;
  /** Limiar exigido, formatado. */
  exigido: string;
  /** O que a reprovação significa, em português. */
  significado: string;
};

export type GateDecision = {
  /** true = perfis e modelo podem ser exibidos. */
  aprovado: boolean;
  clusterizacaoAprovada: boolean;
  modeloAprovado: boolean;
  verificacoes: GateCheck[];
  /** Resumo em uma frase para o topo da aba. */
  resumo: string;
};

function formatar(valor: number, casas = 2): string {
  return valor.toFixed(casas).replace(".", ",");
}

/**
 * Avalia a clusterização.
 *
 * `melhor` é o resultado de maior silhouette entre os k testados. Reprovar
 * aqui não é falha do código: é o dado dizendo que não há agrupamento nítido
 * o bastante para virar "perfil de sucesso".
 */
export function avaliarClusterizacao(
  melhor: ClusterResult | null,
  totalDeObservacoes: number,
  criterios: GateCriteria = CRITERIOS,
  /** Pontos usados no agrupamento; sem eles não há como medir o modelo nulo. */
  pontos?: ClusterPoint[],
): GateCheck[] {
  const verificacoes: GateCheck[] = [];

  verificacoes.push({
    nome: "Observações suficientes",
    aprovado: totalDeObservacoes >= criterios.minimoDeObservacoes,
    medido: `${totalDeObservacoes} territórios`,
    exigido: `≥ ${criterios.minimoDeObservacoes}`,
    significado:
      "Com poucos territórios, qualquer agrupamento reflete acaso amostral " +
      "mais do que estrutura no dado.",
  });

  if (!melhor) {
    verificacoes.push({
      nome: "Clusterização executável",
      aprovado: false,
      medido: "não executada",
      exigido: "ao menos um k testável",
      significado: "Não há observações suficientes para testar nenhum valor de k.",
    });
    return verificacoes;
  }

  verificacoes.push({
    nome: "Silhouette médio",
    aprovado: melhor.silhouette >= criterios.silhouetteMinimo,
    medido: formatar(melhor.silhouette),
    exigido: `≥ ${formatar(criterios.silhouetteMinimo)}`,
    significado:
      "Silhouette baixo significa que os grupos se sobrepõem: os territórios " +
      "de um 'perfil' não são mais parecidos entre si do que com os de fora.",
  });

  // Comparação contra o modelo nulo. É a verificação que separa "os grupos
  // são compactos" de "existem grupos": a primeira é verdade em qualquer
  // nuvem, a segunda é o que a aba precisa.
  if (pontos && pontos.length > melhor.k) {
    const referencia = silhouetteDeReferencia(pontos, melhor.k);
    const folga = melhor.silhouette - referencia.media;
    verificacoes.push({
      nome: "Silhouette acima do modelo nulo",
      aprovado: folga >= criterios.margemSobreReferencia,
      medido: `${formatar(folga)} de folga (real ${formatar(melhor.silhouette)}, ` +
        `dado sem estrutura ${formatar(referencia.media)})`,
      exigido: `≥ ${formatar(criterios.margemSobreReferencia)}`,
      significado:
        "Dado uniforme, sem grupo nenhum, também produz silhouette alto — " +
        "qualquer partição de uma nuvem é compacta. Só há estrutura real se o " +
        "dado observado bate o sorteio aleatório com folga.",
    });
  } else {
    verificacoes.push({
      nome: "Silhouette acima do modelo nulo",
      aprovado: false,
      medido: "não medido",
      exigido: `≥ ${formatar(criterios.margemSobreReferencia)}`,
      significado:
        "Sem os pontos do agrupamento não é possível comparar com dado sem " +
        "estrutura, e o silhouette absoluto sozinho aprovaria ruído.",
    });
  }

  const minimoRelativo = Math.ceil(
    totalDeObservacoes * criterios.clusterMinimoRelativo,
  );
  const exigidoPorCluster = Math.max(criterios.clusterMinimoAbsoluto, minimoRelativo);
  const menorCluster = Math.min(...melhor.tamanhos);

  verificacoes.push({
    nome: "Tamanho do menor grupo",
    aprovado: menorCluster >= exigidoPorCluster,
    medido: `${menorCluster} territórios`,
    exigido: `≥ ${exigidoPorCluster}`,
    significado:
      "Grupo minúsculo não é um perfil: é um punhado de casos atípicos com " +
      "rótulo, e generalizar a partir dele produz recomendação errada.",
  });

  return verificacoes;
}

/** Avalia o modelo de desempenho esperado. */
export function avaliarModelo(
  validacao: CrossValidationResult | null,
  criterios: GateCriteria = CRITERIOS,
): GateCheck[] {
  if (!validacao) {
    return [
      {
        nome: "Validação cruzada executável",
        aprovado: false,
        medido: "não executada",
        exigido: "observações suficientes para 5 dobras",
        significado:
          "Sem validação fora da amostra não há como saber se o modelo " +
          "aprendeu algo ou decorou o próprio conjunto de treino.",
      },
    ];
  }

  const verificacoes: GateCheck[] = [
    {
      nome: "R² fora da amostra",
      aprovado: validacao.r2ForaDaAmostra >= criterios.r2Minimo,
      medido: formatar(validacao.r2ForaDaAmostra),
      exigido: `≥ ${formatar(criterios.r2Minimo)}`,
      significado:
        "Abaixo do limiar, a diferença entre estimado e observado é " +
        "principalmente erro do modelo — a 'lacuna' apontaria ruído de " +
        "previsão como oportunidade.",
    },
  ];

  // Não é critério de reprovação, é diagnóstico: uma diferença grande entre
  // dentro e fora da amostra indica sobreajuste, e a pessoa que for
  // interpretar o resultado precisa ver isso.
  const distancia = validacao.r2DentroDaAmostra - validacao.r2ForaDaAmostra;
  verificacoes.push({
    nome: "Distância dentro/fora da amostra",
    aprovado: true,
    medido: formatar(distancia),
    exigido: "diagnóstico, não critério",
    significado:
      distancia > 0.3
        ? "Diferença grande: o modelo se ajusta bem ao treino e mal ao teste. " +
          "Sinal de sobreajuste — leia os coeficientes com reserva."
        : "Ajuste dentro e fora da amostra são compatíveis.",
  });

  return verificacoes;
}

/** Decisão final: o que pode ser exibido. */
export function decidir(
  melhorCluster: ClusterResult | null,
  totalDeObservacoes: number,
  validacao: CrossValidationResult | null,
  criterios: GateCriteria = CRITERIOS,
  pontos?: ClusterPoint[],
): GateDecision {
  const deCluster = avaliarClusterizacao(
    melhorCluster,
    totalDeObservacoes,
    criterios,
    pontos,
  );
  const deModelo = avaliarModelo(validacao, criterios);

  const clusterizacaoAprovada = deCluster.every((v) => v.aprovado);
  // A verificação de diagnóstico está sempre aprovada, então não altera isto.
  const modeloAprovado = deModelo.every((v) => v.aprovado);

  const verificacoes = [...deCluster, ...deModelo];
  const reprovadas = verificacoes.filter((v) => !v.aprovado);

  let resumo: string;
  if (clusterizacaoAprovada && modeloAprovado) {
    resumo =
      "Clusterização e modelo passaram nos critérios definidos antes da " +
      "execução. Perfis e lacuna estimada estão disponíveis.";
  } else if (reprovadas.length === verificacoes.length) {
    resumo =
      "Nenhum critério foi atendido. A aba segue com a classificação por " +
      "regra, que não depende de estimação.";
  } else {
    resumo =
      `${reprovadas.length} de ${verificacoes.length} critérios não foram ` +
      "atendidos: " +
      reprovadas.map((v) => `${v.nome} (${v.medido}, exigido ${v.exigido})`).join("; ") +
      ". Os componentes reprovados não são exibidos; a classificação por " +
      "regra continua valendo.";
  }

  return {
    aprovado: clusterizacaoAprovada && modeloAprovado,
    clusterizacaoAprovada,
    modeloAprovado,
    verificacoes,
    resumo,
  };
}
