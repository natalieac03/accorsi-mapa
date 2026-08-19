/**
 * Modelo de desempenho esperado — Elastic Net com validação cruzada.
 *
 * Objetivo: estimar qual seria a taxa de votos de um território dadas as suas
 * características, e chamar de LACUNA a diferença entre o estimado e o
 * observado. A palavra importa: lacuna é "resultado abaixo do observado em
 * territórios estatisticamente semelhantes", nunca "votos garantidos".
 *
 * Escolhas e seus motivos:
 *
 * - Elastic Net, não árvore: o pedido é um modelo INTERPRETÁVEL. Coeficientes
 *   lineares sobre variáveis padronizadas dizem quanto cada característica
 *   pesa e em que direção; uma floresta diria "confia em mim".
 *
 * - Alvo em logit da taxa: taxa vive em (0,1) e um modelo linear em cima dela
 *   prevê valores fora do intervalo. O logit resolve isso e, de quebra, torna
 *   os efeitos multiplicativos, que é como razão de votos se comporta.
 *
 * - Padronização e imputação calculadas DENTRO de cada dobra de treino. Usar
 *   a média do conjunto inteiro vazaria informação do teste para o treino e
 *   inflaria o R² — que é exatamente o número usado para decidir se o modelo
 *   sobe. Um vazamento aqui não deixa o modelo pior: deixa o gate cego.
 */

export type ModelObservation = {
  id: string;
  /** Features na ordem de `featureIds`; null = ausente. */
  features: (number | null)[];
  /** Taxa observada em (0,1). */
  taxa: number;
  /** Peso da observação (votos válidos): território maior informa mais. */
  peso: number;
};

export type ElasticNetConfig = {
  /** Força da regularização. */
  lambda: number;
  /** 0 = Ridge puro, 1 = Lasso puro. */
  alpha: number;
  maxIteracoes: number;
  tolerancia: number;
};

export const CONFIG_PADRAO: ElasticNetConfig = {
  lambda: 0.05,
  alpha: 0.5,
  maxIteracoes: 500,
  tolerancia: 1e-6,
};

export type ModelFit = {
  intercepto: number;
  coeficientes: number[];
  featureIds: string[];
  medias: number[];
  desvios: number[];
};

export type CrossValidationResult = {
  /** R² fora da amostra, agregado sobre as dobras. */
  r2ForaDaAmostra: number;
  /** R² dentro da amostra, para comparação — sobreajuste fica visível. */
  r2DentroDaAmostra: number;
  dobras: number;
  observacoes: number;
  modelo: ModelFit;
};

const EPSILON = 1e-6;

function logit(p: number): number {
  const seguro = Math.min(1 - EPSILON, Math.max(EPSILON, p));
  return Math.log(seguro / (1 - seguro));
}

function sigmoide(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Média de uma coluna ignorando ausentes; null se a coluna for toda ausente. */
function mediaDaColuna(linhas: (number | null)[][], coluna: number): number | null {
  const valores = linhas
    .map((linha) => linha[coluna])
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (valores.length === 0) return null;
  return valores.reduce((soma, v) => soma + v, 0) / valores.length;
}

/**
 * Imputa ausentes e padroniza usando ESTATÍSTICAS DE TREINO.
 *
 * Devolve as estatísticas para que o conjunto de teste seja transformado com
 * elas — e não com as próprias, que é como o vazamento acontece.
 */
function prepararTreino(observacoes: ModelObservation[]): {
  matriz: number[][];
  medias: number[];
  desvios: number[];
} {
  const colunas = observacoes[0]?.features.length ?? 0;
  const brutas = observacoes.map((o) => o.features);

  const medias = new Array(colunas).fill(0);
  for (let coluna = 0; coluna < colunas; coluna += 1) {
    medias[coluna] = mediaDaColuna(brutas, coluna) ?? 0;
  }

  const imputadas = brutas.map((linha) =>
    linha.map((valor, coluna) =>
      valor !== null && Number.isFinite(valor) ? valor : medias[coluna],
    ),
  );

  const desvios = new Array(colunas).fill(1);
  for (let coluna = 0; coluna < colunas; coluna += 1) {
    const valores = imputadas.map((linha) => linha[coluna]);
    const media = medias[coluna];
    const variancia =
      valores.reduce((soma, v) => soma + (v - media) ** 2, 0) /
      Math.max(1, valores.length - 1);
    desvios[coluna] = variancia > 0 ? Math.sqrt(variancia) : 1;
  }

  return {
    matriz: imputadas.map((linha) =>
      linha.map((valor, coluna) => (valor - medias[coluna]) / desvios[coluna]),
    ),
    medias,
    desvios,
  };
}

function aplicarTransformacao(
  observacoes: ModelObservation[],
  medias: number[],
  desvios: number[],
): number[][] {
  return observacoes.map((o) =>
    o.features.map((valor, coluna) => {
      const bruto = valor !== null && Number.isFinite(valor) ? valor : medias[coluna];
      return (bruto - medias[coluna]) / desvios[coluna];
    }),
  );
}

/** Soft-thresholding do coordinate descent. */
function softThreshold(valor: number, limiar: number): number {
  if (valor > limiar) return valor - limiar;
  if (valor < -limiar) return valor + limiar;
  return 0;
}

/** Ajusta Elastic Net por coordinate descent, com pesos por observação. */
export function fitElasticNet(
  matriz: number[][],
  alvo: number[],
  pesos: number[],
  config: ElasticNetConfig = CONFIG_PADRAO,
): { intercepto: number; coeficientes: number[] } {
  const n = matriz.length;
  const p = matriz[0]?.length ?? 0;
  const coeficientes = new Array(p).fill(0);

  const somaPesos = pesos.reduce((soma, w) => soma + w, 0) || 1;
  let intercepto = alvo.reduce((soma, y, i) => soma + y * pesos[i], 0) / somaPesos;

  const residuos = alvo.map((y) => y - intercepto);

  for (let iteracao = 0; iteracao < config.maxIteracoes; iteracao += 1) {
    let maiorMudanca = 0;

    for (let j = 0; j < p; j += 1) {
      let numerador = 0;
      let denominador = 0;
      for (let i = 0; i < n; i += 1) {
        const xij = matriz[i][j];
        // Resíduo parcial: tira a contribuição atual desta coluna.
        const parcial = residuos[i] + coeficientes[j] * xij;
        numerador += pesos[i] * xij * parcial;
        denominador += pesos[i] * xij * xij;
      }
      numerador /= somaPesos;
      denominador /= somaPesos;

      const novo =
        denominador + config.lambda * (1 - config.alpha) > 0
          ? softThreshold(numerador, config.lambda * config.alpha) /
            (denominador + config.lambda * (1 - config.alpha))
          : 0;

      const mudanca = Math.abs(novo - coeficientes[j]);
      if (mudanca > 0) {
        for (let i = 0; i < n; i += 1) {
          residuos[i] -= (novo - coeficientes[j]) * matriz[i][j];
        }
        coeficientes[j] = novo;
        maiorMudanca = Math.max(maiorMudanca, mudanca);
      }
    }

    // Reajusta o intercepto com os resíduos correntes.
    const ajuste = residuos.reduce((soma, r, i) => soma + r * pesos[i], 0) / somaPesos;
    intercepto += ajuste;
    for (let i = 0; i < n; i += 1) residuos[i] -= ajuste;

    if (maiorMudanca < config.tolerancia) break;
  }

  return { intercepto, coeficientes };
}

function calcularR2(observado: number[], previsto: number[], pesos: number[]): number {
  const somaPesos = pesos.reduce((soma, w) => soma + w, 0) || 1;
  const media = observado.reduce((soma, y, i) => soma + y * pesos[i], 0) / somaPesos;
  let sqr = 0;
  let sqt = 0;
  for (let i = 0; i < observado.length; i += 1) {
    sqr += pesos[i] * (observado[i] - previsto[i]) ** 2;
    sqt += pesos[i] * (observado[i] - media) ** 2;
  }
  // R² negativo é resultado LEGÍTIMO: significa que o modelo prevê pior que a
  // média. Não deve ser truncado em zero — é justamente o sinal que o gate
  // precisa ver.
  return sqt > 0 ? 1 - sqr / sqt : 0;
}

/**
 * Validação cruzada em k dobras.
 *
 * As dobras são determinísticas (fatiamento por índice após ordenação por id),
 * não embaralhadas ao acaso: o mesmo dado precisa dar o mesmo R², senão o gate
 * aprovaria ou reprovaria conforme a sorte da execução.
 */
export function crossValidate(
  observacoes: ModelObservation[],
  featureIds: string[],
  opcoes: { dobras?: number; config?: ElasticNetConfig } = {},
): CrossValidationResult | null {
  const dobras = opcoes.dobras ?? 5;
  const config = opcoes.config ?? CONFIG_PADRAO;

  const validas = observacoes
    .filter((o) => Number.isFinite(o.taxa) && o.taxa > 0 && o.taxa < 1 && o.peso > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (validas.length < dobras * 2) return null;

  const alvoCompleto = validas.map((o) => logit(o.taxa));
  const pesosCompletos = validas.map((o) => o.peso);

  const observadosFora: number[] = [];
  const previstosFora: number[] = [];
  const pesosFora: number[] = [];

  for (let dobra = 0; dobra < dobras; dobra += 1) {
    const treino: ModelObservation[] = [];
    const teste: ModelObservation[] = [];
    validas.forEach((o, indice) => {
      if (indice % dobras === dobra) teste.push(o);
      else treino.push(o);
    });
    if (treino.length === 0 || teste.length === 0) continue;

    const { matriz, medias, desvios } = prepararTreino(treino);
    const alvoTreino = treino.map((o) => logit(o.taxa));
    const pesosTreino = treino.map((o) => o.peso);
    const { intercepto, coeficientes } = fitElasticNet(
      matriz,
      alvoTreino,
      pesosTreino,
      config,
    );

    const matrizTeste = aplicarTransformacao(teste, medias, desvios);
    matrizTeste.forEach((linha, i) => {
      const previsto =
        intercepto + linha.reduce((soma, x, j) => soma + x * coeficientes[j], 0);
      observadosFora.push(logit(teste[i].taxa));
      previstosFora.push(previsto);
      pesosFora.push(teste[i].peso);
    });
  }

  if (observadosFora.length === 0) return null;

  // Modelo final: treinado em TUDO, para ser o que a interface usa. O R² que
  // decide, porém, é o das dobras — nunca o deste ajuste.
  const { matriz, medias, desvios } = prepararTreino(validas);
  const { intercepto, coeficientes } = fitElasticNet(
    matriz,
    alvoCompleto,
    pesosCompletos,
    config,
  );
  const previstosDentro = matriz.map(
    (linha) => intercepto + linha.reduce((soma, x, j) => soma + x * coeficientes[j], 0),
  );

  return {
    r2ForaDaAmostra: calcularR2(observadosFora, previstosFora, pesosFora),
    r2DentroDaAmostra: calcularR2(alvoCompleto, previstosDentro, pesosCompletos),
    dobras,
    observacoes: validas.length,
    modelo: { intercepto, coeficientes, featureIds, medias, desvios },
  };
}

/** Taxa estimada para um território, de volta à escala (0,1). */
export function predictRate(modelo: ModelFit, features: (number | null)[]): number {
  const linha = features.map((valor, coluna) => {
    const bruto =
      valor !== null && Number.isFinite(valor) ? valor : modelo.medias[coluna];
    return (bruto - modelo.medias[coluna]) / modelo.desvios[coluna];
  });
  const logitPrevisto =
    modelo.intercepto +
    linha.reduce((soma, x, j) => soma + x * modelo.coeficientes[j], 0);
  // Extrapolação distante satura a sigmoide em 0 ou 1 exatos por ponto
  // flutuante. Taxa 1 significaria "todos os votos válidos", e 0 dividiria
  // por zero nas contas seguintes: o intervalo precisa ser ABERTO.
  return Math.min(1 - EPSILON, Math.max(EPSILON, sigmoide(logitPrevisto)));
}

/**
 * Lacuna: quanto o observado fica abaixo do estimado.
 *
 * Truncada em zero: desempenho ACIMA do estimado não é "lacuna negativa", é
 * outro fenômeno (força pessoal), e já tem tipo próprio na Rodada 2.
 */
export function performanceGap(estimado: number, observado: number): number {
  return Math.max(0, estimado - observado);
}

/** Coeficientes ordenados por magnitude — a explicação do modelo. */
export function explainModel(
  modelo: ModelFit,
): { featureId: string; coeficiente: number; direcao: "positiva" | "negativa" }[] {
  return modelo.featureIds
    .map((featureId, indice) => ({
      featureId,
      coeficiente: modelo.coeficientes[indice],
      direcao: (modelo.coeficientes[indice] >= 0 ? "positiva" : "negativa") as
        | "positiva"
        | "negativa",
    }))
    .filter((item) => Math.abs(item.coeficiente) > 1e-8)
    .sort((a, b) => Math.abs(b.coeficiente) - Math.abs(a.coeficiente));
}
