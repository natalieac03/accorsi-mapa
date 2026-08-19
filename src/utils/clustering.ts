/**
 * K-means determinístico e silhouette — Rodada 3.
 *
 * Determinismo é requisito, não preferência: a especificação exige que duas
 * execuções com os mesmos dados produzam o mesmo resultado, e um mapa que
 * muda de perfil a cada recarga destrói a confiança inteira do módulo. Por
 * isso o gerador pseudoaleatório é semeado e a inicialização é k-means++ com
 * essa semente — nada de `Math.random()`.
 *
 * Este módulo NÃO decide se a clusterização vale: ele calcula e reporta a
 * qualidade. Quem decide é `opportunityGate.ts`. A separação é proposital —
 * o motor que produz o resultado não pode ser o mesmo que julga se o
 * resultado presta.
 */

export type ClusterPoint = {
  id: string;
  /** Já padronizado (z-score) e sem ausentes. */
  valores: number[];
};

export type ClusterAssignment = {
  id: string;
  cluster: number;
  /** Silhouette individual: -1 (mal agrupado) a 1 (bem agrupado). */
  silhouette: number;
};

export type ClusterResult = {
  k: number;
  atribuicoes: ClusterAssignment[];
  centroides: number[][];
  /** Média das silhouettes individuais. */
  silhouette: number;
  tamanhos: number[];
  /** Iterações até convergir; útil para diagnosticar instabilidade. */
  iteracoes: number;
};

/**
 * Gerador pseudoaleatório semeado (mulberry32).
 *
 * Pequeno, rápido e — o que importa aqui — reprodutível: mesma semente,
 * mesma sequência, sempre.
 */
function criarRng(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distanciaQuadrada(a: number[], b: number[]): number {
  let soma = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diferenca = a[i] - b[i];
    soma += diferenca * diferenca;
  }
  return soma;
}

function distancia(a: number[], b: number[]): number {
  return Math.sqrt(distanciaQuadrada(a, b));
}

/** Inicialização k-means++, semeada. */
function inicializar(pontos: ClusterPoint[], k: number, rng: () => number): number[][] {
  const centroides: number[][] = [];
  const primeiro = Math.floor(rng() * pontos.length);
  centroides.push([...pontos[primeiro].valores]);

  while (centroides.length < k) {
    const distancias = pontos.map((ponto) =>
      Math.min(...centroides.map((centro) => distanciaQuadrada(ponto.valores, centro))),
    );
    const total = distancias.reduce((soma, d) => soma + d, 0);
    if (total <= 0) {
      // Todos os pontos coincidem com algum centróide: não há como espalhar
      // mais. Repetir um ponto seria criar cluster vazio.
      centroides.push([...pontos[Math.floor(rng() * pontos.length)].valores]);
      continue;
    }
    let alvo = rng() * total;
    let escolhido = 0;
    for (let i = 0; i < distancias.length; i += 1) {
      alvo -= distancias[i];
      if (alvo <= 0) {
        escolhido = i;
        break;
      }
    }
    centroides.push([...pontos[escolhido].valores]);
  }

  return centroides;
}

/**
 * Silhouette de cada ponto.
 *
 * s = (b - a) / max(a, b), onde `a` é a distância média aos pontos do próprio
 * cluster e `b` a menor distância média a um cluster vizinho. Ponto sozinho no
 * cluster recebe 0 por convenção — não 1, que sugeriria agrupamento perfeito
 * quando na verdade não há com o que comparar.
 */
export function silhouetteScores(
  pontos: ClusterPoint[],
  atribuicoes: number[],
  k: number,
): number[] {
  const porCluster: number[][] = Array.from({ length: k }, () => []);
  atribuicoes.forEach((cluster, indice) => porCluster[cluster].push(indice));

  return pontos.map((ponto, indice) => {
    const meu = atribuicoes[indice];
    const irmaos = porCluster[meu].filter((outro) => outro !== indice);
    if (irmaos.length === 0) return 0;

    const a =
      irmaos.reduce((soma, outro) => soma + distancia(ponto.valores, pontos[outro].valores), 0) /
      irmaos.length;

    let b = Infinity;
    for (let cluster = 0; cluster < k; cluster += 1) {
      if (cluster === meu || porCluster[cluster].length === 0) continue;
      const media =
        porCluster[cluster].reduce(
          (soma, outro) => soma + distancia(ponto.valores, pontos[outro].valores),
          0,
        ) / porCluster[cluster].length;
      b = Math.min(b, media);
    }
    if (!Number.isFinite(b)) return 0;

    const maior = Math.max(a, b);
    return maior > 0 ? (b - a) / maior : 0;
  });
}

/** K-means com centróides semeados. Converge por estabilidade das atribuições. */
export function kmeans(
  pontos: ClusterPoint[],
  k: number,
  opcoes: { semente?: number; maxIteracoes?: number } = {},
): ClusterResult {
  const semente = opcoes.semente ?? 42;
  const maxIteracoes = opcoes.maxIteracoes ?? 100;
  const rng = criarRng(semente);

  let centroides = inicializar(pontos, k, rng);
  let atribuicoes = new Array(pontos.length).fill(0);
  let iteracoes = 0;

  for (; iteracoes < maxIteracoes; iteracoes += 1) {
    let mudou = false;

    for (let i = 0; i < pontos.length; i += 1) {
      let melhor = 0;
      let melhorDistancia = Infinity;
      for (let cluster = 0; cluster < k; cluster += 1) {
        const d = distanciaQuadrada(pontos[i].valores, centroides[cluster]);
        if (d < melhorDistancia) {
          melhorDistancia = d;
          melhor = cluster;
        }
      }
      if (atribuicoes[i] !== melhor) {
        atribuicoes[i] = melhor;
        mudou = true;
      }
    }

    const somas: number[][] = Array.from({ length: k }, () =>
      new Array(pontos[0]?.valores.length ?? 0).fill(0),
    );
    const contagens = new Array(k).fill(0);
    atribuicoes.forEach((cluster, indice) => {
      contagens[cluster] += 1;
      pontos[indice].valores.forEach((valor, dimensao) => {
        somas[cluster][dimensao] += valor;
      });
    });

    centroides = centroides.map((centro, cluster) =>
      contagens[cluster] > 0
        ? somas[cluster].map((soma) => soma / contagens[cluster])
        : centro,
    );

    if (!mudou) break;
  }

  const silhouettes = silhouetteScores(pontos, atribuicoes, k);
  const tamanhos = new Array(k).fill(0);
  atribuicoes.forEach((cluster) => {
    tamanhos[cluster] += 1;
  });

  return {
    k,
    atribuicoes: pontos.map((ponto, indice) => ({
      id: ponto.id,
      cluster: atribuicoes[indice],
      silhouette: silhouettes[indice],
    })),
    centroides,
    silhouette:
      silhouettes.length > 0
        ? silhouettes.reduce((soma, s) => soma + s, 0) / silhouettes.length
        : 0,
    tamanhos,
    iteracoes,
  };
}

/**
 * Testa k de 2 a 5 e devolve TODOS os resultados, do melhor silhouette para o
 * pior.
 *
 * Devolve todos de propósito: quem decide se algum presta é o gate, e para
 * decidir ele precisa ver os candidatos rejeitados também. Um módulo que
 * devolvesse só "o melhor" esconderia que o melhor era ruim.
 */
export function testarValoresDeK(
  pontos: ClusterPoint[],
  opcoes: { kMinimo?: number; kMaximo?: number; semente?: number } = {},
): ClusterResult[] {
  const kMinimo = opcoes.kMinimo ?? 2;
  const kMaximo = opcoes.kMaximo ?? 5;
  const resultados: ClusterResult[] = [];

  for (let k = kMinimo; k <= kMaximo; k += 1) {
    if (pontos.length <= k) break;
    resultados.push(kmeans(pontos, k, { semente: opcoes.semente }));
  }

  return resultados.sort((a, b) => b.silhouette - a.silhouette || a.k - b.k);
}

/**
 * Silhouette esperado em dado SEM ESTRUTURA, com a mesma forma do real.
 *
 * Existe por causa de uma descoberta durante os testes: uma nuvem uniforme,
 * sem grupo nenhum, produz silhouette 0,51 com k=4. Silhouette premia
 * compacidade, e qualquer partição de uma nuvem uniforme é compacta — então
 * um limiar absoluto sobre silhouette APROVARIA clusterização de ruído puro.
 *
 * A correção é a lógica do gap statistic (Tibshirani et al.): sortear pontos
 * uniformemente dentro do mesmo intervalo observado em cada dimensão — que é
 * a hipótese nula "não há grupos" — agrupar igual e medir o silhouette
 * resultante. Se o dado real não bate esse patamar com folga, o que k-means
 * achou foi geometria, não estrutura.
 *
 * `amostras` controla quantos sorteios entram na média. Mais sorteios, menos
 * variância na referência, mais custo.
 */
export function silhouetteDeReferencia(
  pontos: ClusterPoint[],
  k: number,
  opcoes: { amostras?: number; semente?: number } = {},
): { media: number; desvio: number; amostras: number } {
  const amostras = opcoes.amostras ?? 5;
  const semente = opcoes.semente ?? 42;
  const dimensoes = pontos[0]?.valores.length ?? 0;
  if (dimensoes === 0 || pontos.length <= k) {
    return { media: 0, desvio: 0, amostras: 0 };
  }

  const minimos = new Array(dimensoes).fill(Infinity);
  const maximos = new Array(dimensoes).fill(-Infinity);
  for (const ponto of pontos) {
    ponto.valores.forEach((valor, dimensao) => {
      minimos[dimensao] = Math.min(minimos[dimensao], valor);
      maximos[dimensao] = Math.max(maximos[dimensao], valor);
    });
  }

  const valores: number[] = [];
  for (let amostra = 0; amostra < amostras; amostra += 1) {
    const rng = criarRng(semente + amostra * 1013);
    const sinteticos: ClusterPoint[] = pontos.map((_, indice) => ({
      id: `ref-${indice}`,
      valores: minimos.map(
        (minimo, dimensao) => minimo + rng() * (maximos[dimensao] - minimo),
      ),
    }));
    valores.push(kmeans(sinteticos, k, { semente: semente + amostra }).silhouette);
  }

  const media = valores.reduce((soma, v) => soma + v, 0) / valores.length;
  const variancia =
    valores.reduce((soma, v) => soma + (v - media) ** 2, 0) /
    Math.max(1, valores.length - 1);

  return { media, desvio: Math.sqrt(variancia), amostras: valores.length };
}

/** Padroniza colunas (z-score), devolvendo média e desvio para reuso. */
export function padronizar(
  linhas: number[][],
): { padronizadas: number[][]; medias: number[]; desvios: number[] } {
  const colunas = linhas[0]?.length ?? 0;
  const medias = new Array(colunas).fill(0);
  const desvios = new Array(colunas).fill(1);

  for (let coluna = 0; coluna < colunas; coluna += 1) {
    const valores = linhas.map((linha) => linha[coluna]);
    const media = valores.reduce((soma, v) => soma + v, 0) / valores.length;
    const variancia =
      valores.reduce((soma, v) => soma + (v - media) ** 2, 0) / Math.max(1, valores.length - 1);
    medias[coluna] = media;
    // Coluna constante: desvio 1 evita divisão por zero e a deixa em zero
    // depois da padronização, sem influenciar distância nenhuma.
    desvios[coluna] = variancia > 0 ? Math.sqrt(variancia) : 1;
  }

  return {
    padronizadas: linhas.map((linha) =>
      linha.map((valor, coluna) => (valor - medias[coluna]) / desvios[coluna]),
    ),
    medias,
    desvios,
  };
}
