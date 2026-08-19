/**
 * Tipos de oportunidade por REGRA — Rodada 2.
 *
 * A observação que estrutura este módulo: quase todos os tipos de
 * oportunidade da especificação são comparações entre métricas que a Rodada 1
 * já calcula. "Consolidação" é desempenho alto + estável. "Recuperação" é
 * desempenho que caiu. "Afinidade não convertida" é partido forte e candidato
 * fraco no mesmo lugar. Nenhum deles precisa de clusterização nem de
 * regressão — precisa de duas métricas e um limiar.
 *
 * Isso importa porque cluster e modelo são as peças que podem não validar com
 * n=246 municípios. Construir os tipos por regra primeiro entrega a aba
 * inteira funcionando, e deixa o aprendizado estatístico como melhoria de um
 * componente, não como pré-requisito de tudo.
 *
 * Todo limiar mora em `LIMIARES`, num lugar só, e sai na interface junto do
 * resultado. Um número escolhido e declarado é honesto; o mesmo número
 * espalhado por dez arquivos é dogma disfarçado.
 */

import type { ContestMetrics, TerritoryMetrics } from "../types/opportunity";

export type OpportunityTypeId =
  | "consolidacao"
  | "expansao"
  | "novaFronteira"
  | "recuperacao"
  | "afinidadeNaoConvertida"
  | "forcaPessoal"
  | "mobilizacao";

export type OpportunityType = {
  id: OpportunityTypeId;
  label: string;
  /** O que o tipo responde, em uma linha, para o cabeçalho do card. */
  pergunta: string;
};

export const TIPOS: Record<OpportunityTypeId, OpportunityType> = {
  consolidacao: {
    id: "consolidacao",
    label: "Base consolidada",
    pergunta: "Onde o desempenho já é alto e se manteve entre eleições?",
  },
  expansao: {
    id: "expansao",
    label: "Expansão",
    pergunta: "Onde o desempenho é intermediário e a escala eleitoral é relevante?",
  },
  novaFronteira: {
    id: "novaFronteira",
    label: "Nova fronteira",
    pergunta: "Onde o perfil é compatível mas a votação ainda é baixa?",
  },
  recuperacao: {
    id: "recuperacao",
    label: "Recuperação",
    pergunta: "Onde já foi melhor e houve queda proporcional relevante?",
  },
  afinidadeNaoConvertida: {
    id: "afinidadeNaoConvertida",
    label: "Afinidade não convertida",
    pergunta: "Onde o partido vai bem e a candidatura fica abaixo do esperado no bloco?",
  },
  forcaPessoal: {
    id: "forcaPessoal",
    label: "Força pessoal",
    pergunta: "Onde a candidatura supera proporcionalmente o próprio partido?",
  },
  mobilizacao: {
    id: "mobilizacao",
    label: "Mobilização",
    pergunta: "Onde o perfil é compatível e o comparecimento fica abaixo da média?",
  },
};

/**
 * Limiares da classificação.
 *
 * Todos são ESCOLHAS, não descobertas — a mesma ressalva que vale para os
 * pesos do score. Estão aqui juntos para serem discutidos com dado real, e a
 * interface os exibe junto do resultado. Ninguém deve precisar ler o código
 * para saber por que um município caiu num tipo e não noutro.
 */
export const LIMIARES = {
  /** Lift a partir do qual o desempenho conta como "alto". */
  liftAlto: 1.25,
  /** Lift abaixo do qual conta como "baixo". */
  liftBaixo: 0.75,
  /** Similaridade mínima com as âncoras para o perfil ser "compatível". */
  similaridadeAlta: 70,
  /** Queda proporcional de lift entre eleições que caracteriza recuperação. */
  quedaRelevante: 0.2,
  /** Variação máxima de lift para o desempenho contar como estável. */
  estabilidade: 0.15,
  /** Participação no bloco acima disso = força pessoal. */
  blocoForte: 0.3,
  /** Participação no bloco abaixo disso, com partido presente = não convertida. */
  blocoFraco: 0.15,
  /** Mínimo de votos válidos para o território ser classificado. */
  minimoDeValidos: 200,
} as const;

export type TerritoryEvidence = {
  ibgeCode: string;
  nome: string;
  /** Métricas do pleito de referência (o mais recente comparável). */
  atual: TerritoryMetrics;
  /** Métricas do pleito anterior do mesmo cargo, quando existe. */
  anterior: TerritoryMetrics | null;
  /** Similaridade média com as âncoras; null quando não foi possível medir. */
  similaridade: number | null;
  /** Comparecimento do território, quando disponível. null = indisponível. */
  comparecimento: number | null;
  /** Comparecimento médio de referência, para o tipo mobilização. */
  comparecimentoReferencia: number | null;
  /**
   * Ressalva sobre a própria comparação entre os dois pleitos — hoje usada
   * quando `atual` e `anterior` são de cargos diferentes.
   *
   * Entra como aviso em toda classificação que dependa de `anterior`. O motivo
   * de vir de fora em vez de ser deduzida aqui: quem escolhe os pleitos é a
   * seleção (`utils/opportunityInputs.ts`), e só ela sabe por que aquele par
   * foi formado. O motor classifica o que recebe; inventar aqui a explicação
   * de uma escolha feita noutro lugar seria duplicar a regra em dois arquivos.
   */
  avisoDeComparacao?: string | null;
};

export type OpportunityClassification = {
  ibgeCode: string;
  nome: string;
  tipos: OpportunityTypeId[];
  /** Tipo principal: o primeiro da ordem de prioridade abaixo. */
  tipoPrincipal: OpportunityTypeId | null;
  explicacao: string;
  /**
   * SÓ o porquê da classificação, sem o nome do território, sem o rótulo do
   * tipo e sem a ressalva sobre similaridade.
   *
   * `explicacao` é a frase completa, para exportação (PDF, Excel, respostas do
   * agente), onde cada linha viaja sozinha e precisa se apresentar. Na tela ela
   * repetia três coisas que já estavam ali: o nome no título do card, o tipo no
   * rail e no cabeçalho, e a mesma ressalva de similaridade em todos os cards
   * da lista. Repetição que, somada, era a maior parte da altura de cada linha.
   *
   * Vazio quando nenhuma razão se aplica — o consumidor decide o que mostrar.
   */
  motivo: string;
  avisos: string[];
};

/**
 * Ordem de prioridade quando um território cai em mais de um tipo.
 *
 * A especificação não define o que fazer nesse caso, e o caso é comum: um
 * município pode ser simultaneamente "recuperação" e "afinidade não
 * convertida". Sem uma ordem declarada, o tipo principal dependeria da ordem
 * de avaliação no código — ou seja, de acidente.
 *
 * O critério: primeiro os tipos que descrevem um FATO histórico observado
 * (consolidação, recuperação), depois os que descrevem uma RELAÇÃO entre
 * métricas (força pessoal, afinidade não convertida), por último os que
 * dependem de similaridade, que é a inferência mais frágil da cadeia.
 */
const PRIORIDADE: OpportunityTypeId[] = [
  "consolidacao",
  "recuperacao",
  "forcaPessoal",
  "afinidadeNaoConvertida",
  "expansao",
  "novaFronteira",
  "mobilizacao",
];

function formatarPercentual(valor: number): string {
  return `${(valor * 100).toFixed(1).replace(".", ",")}%`;
}

function formatarLift(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/** Classifica um território, podendo devolver vários tipos. */
export function classifyTerritory(
  evidencia: TerritoryEvidence,
): OpportunityClassification {
  const { atual, anterior, similaridade } = evidencia;
  const tipos: OpportunityTypeId[] = [];
  const avisos: string[] = [];
  const razoes: string[] = [];

  const lift = atual.lift;
  const liftAnterior = anterior?.lift ?? null;
  const bloco = atual.participacaoNoBloco;

  if (atual.validos < LIMIARES.minimoDeValidos) {
    avisos.push(
      `Apenas ${atual.validos} votos válidos — abaixo do mínimo de ` +
        `${LIMIARES.minimoDeValidos} para classificação confiável.`,
    );
  }
  if (lift === null) {
    avisos.push("Sem denominador apurado: não há taxa nem lift para este território.");
  }
  if (similaridade === null) {
    avisos.push("Similaridade indisponível: faltam variáveis para comparar o perfil.");
  }
  if (anterior === null) {
    avisos.push("Apenas uma eleição comparável — não há como avaliar tendência.");
  } else if (evidencia.avisoDeComparacao) {
    avisos.push(evidencia.avisoDeComparacao);
  }

  // --- tipos que dependem só de desempenho observado -----------------------
  if (lift !== null && liftAnterior !== null) {
    const variacao = liftAnterior > 0 ? (lift - liftAnterior) / liftAnterior : null;

    if (
      lift >= LIMIARES.liftAlto &&
      variacao !== null &&
      Math.abs(variacao) <= LIMIARES.estabilidade
    ) {
      tipos.push("consolidacao");
      razoes.push(
        `desempenho ${formatarLift(lift)}× a média e estável entre as duas eleições`,
      );
    }

    if (variacao !== null && variacao <= -LIMIARES.quedaRelevante) {
      tipos.push("recuperacao");
      razoes.push(
        `queda de ${formatarPercentual(Math.abs(variacao))} no lift em relação à eleição anterior`,
      );
    }
  }

  // --- relação entre candidatura e bloco partidário ------------------------
  if (bloco !== null) {
    if (bloco >= LIMIARES.blocoForte) {
      tipos.push("forcaPessoal");
      razoes.push(
        `${formatarPercentual(bloco)} dos votos do bloco partidário no território`,
      );
    } else if (bloco <= LIMIARES.blocoFraco && atual.votos > 0) {
      tipos.push("afinidadeNaoConvertida");
      razoes.push(
        `o bloco tem votação no território, mas a candidatura fica com apenas ` +
          `${formatarPercentual(bloco)} dela`,
      );
    }
  }

  // --- tipos que dependem de similaridade ---------------------------------
  const compativel =
    similaridade !== null && similaridade >= LIMIARES.similaridadeAlta;

  if (compativel && lift !== null) {
    if (lift < LIMIARES.liftBaixo) {
      tipos.push("novaFronteira");
      razoes.push(
        `perfil ${similaridade.toFixed(0)}% compatível com as bases de referência, ` +
          `mas desempenho ${formatarLift(lift)}× a média`,
      );
    } else if (lift < LIMIARES.liftAlto) {
      tipos.push("expansao");
      razoes.push(
        `perfil ${similaridade.toFixed(0)}% compatível e desempenho intermediário ` +
          `(${formatarLift(lift)}× a média)`,
      );
    }
  }

  if (
    compativel &&
    evidencia.comparecimento !== null &&
    evidencia.comparecimentoReferencia !== null &&
    evidencia.comparecimento < evidencia.comparecimentoReferencia
  ) {
    tipos.push("mobilizacao");
    razoes.push(
      `comparecimento de ${formatarPercentual(evidencia.comparecimento)}, abaixo da ` +
        `referência de ${formatarPercentual(evidencia.comparecimentoReferencia)}`,
    );
  }

  const tipoPrincipal =
    PRIORIDADE.find((tipo) => tipos.includes(tipo)) ?? null;

  return {
    ibgeCode: evidencia.ibgeCode,
    nome: evidencia.nome,
    tipos,
    tipoPrincipal,
    explicacao: montarExplicacao(evidencia, tipoPrincipal, razoes),
    motivo: montarMotivo(tipoPrincipal, razoes),
    avisos,
  };
}

/**
 * O porquê, sozinho — a mesma frase que `montarExplicacao` usa no meio.
 *
 * As duas leem as MESMAS `razoes`, então não há chance de a tela dizer um
 * motivo e o PDF dizer outro: o que muda entre elas é só o que envolve a
 * frase, não o que ela afirma.
 */
function montarMotivo(
  tipoPrincipal: OpportunityTypeId | null,
  razoes: string[],
): string {
  if (tipoPrincipal === null || razoes.length === 0) return "";
  return `${razoes.join("; ")}.`;
}

/**
 * Explicação em português, gerada por regra — sem LLM.
 *
 * Regras de redação, não negociáveis:
 *
 * - Descreve o TERRITÓRIO, nunca as pessoas. "Territórios com maior proporção
 *   desse perfil apresentaram votação maior", jamais "esse grupo vota em X".
 * - Nunca afirma causa. Similaridade e correlação são ditas como o que são.
 * - Sempre nomeia a eleição de referência e o que foi comparado. Número sem
 *   referência declarada não quer dizer nada.
 */
function montarExplicacao(
  evidencia: TerritoryEvidence,
  tipoPrincipal: OpportunityTypeId | null,
  razoes: string[],
): string {
  if (tipoPrincipal === null) {
    return (
      `${evidencia.nome} não se enquadra em nenhum tipo de oportunidade com os ` +
      "limiares atuais. Isso não significa ausência de potencial: significa que " +
      "as métricas disponíveis não sustentam uma classificação."
    );
  }

  const tipo = TIPOS[tipoPrincipal];
  const partes = [
    `${evidencia.nome} — ${tipo.label}.`,
    razoes.length > 0
      ? `Foi classificado assim porque ${razoes.join("; ")}.`
      : "",
    evidencia.similaridade !== null
      ? `A compatibilidade de perfil (${evidencia.similaridade.toFixed(0)}%) é uma ` +
        "medida de semelhança entre características territoriais agregadas, não " +
        "uma previsão de comportamento de eleitores."
      : "",
  ];

  return partes.filter(Boolean).join(" ");
}

/**
 * Territórios âncora: onde o desempenho foi comprovadamente acima da média.
 *
 * Deliberadamente NÃO é "os N com mais votos". Os maiores colégios eleitorais
 * concentram votos por tamanho, não por afinidade — usá-los como âncora faria
 * a similaridade descrever "cidade grande", e todo o resto da análise passaria
 * a apontar para cidades grandes. O critério é lift (desempenho relativo) com
 * volume mínimo, que é coisa diferente.
 */
export function selectAnchors(
  metricas: ContestMetrics,
  opcoes: { liftMinimo?: number; minimoDeValidos?: number; limite?: number } = {},
): TerritoryMetrics[] {
  const liftMinimo = opcoes.liftMinimo ?? LIMIARES.liftAlto;
  const minimoDeValidos = opcoes.minimoDeValidos ?? LIMIARES.minimoDeValidos;

  return metricas.territorios
    .filter(
      (territorio) =>
        territorio.lift !== null &&
        territorio.lift >= liftMinimo &&
        territorio.validos >= minimoDeValidos,
    )
    .sort(
      (a, b) =>
        (b.lift ?? 0) - (a.lift ?? 0) ||
        b.votos - a.votos ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    )
    .slice(0, opcoes.limite ?? 20);
}

/** Agrupa as classificações por tipo, para os cards da aba. */
export function groupByType(
  classificacoes: OpportunityClassification[],
): Map<OpportunityTypeId, OpportunityClassification[]> {
  const grupos = new Map<OpportunityTypeId, OpportunityClassification[]>();
  for (const tipo of PRIORIDADE) grupos.set(tipo, []);
  for (const classificacao of classificacoes) {
    for (const tipo of classificacao.tipos) {
      grupos.get(tipo)?.push(classificacao);
    }
  }
  return grupos;
}
