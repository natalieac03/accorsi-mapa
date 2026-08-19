/**
 * Métricas territoriais determinísticas da aba Oportunidades (Rodada 1).
 *
 * Tudo aqui é aritmética sobre dado apurado do TSE: taxa sobre válidos, votos
 * por mil eleitores, lift, participação dentro do bloco partidário,
 * concentração e suavização estatística. Nenhum modelo, nenhuma inferência,
 * nenhuma clusterização — essas ficam para rodadas seguintes, e de propósito:
 * o que está aqui pode ser conferido à mão contra o dado oficial, linha a
 * linha, e é isso que sustenta a confiança no resto.
 *
 * Convenção herdada de `types/candidate.ts` e mantida sem exceção: `null`
 * significa "o dado não existe", nunca zero. Município sem denominador fica
 * sem taxa e fora do ranking, em vez de aparecer com 0% falso.
 */

/** Referência contra a qual o lift de um território é medido. */
export type LiftReferenceId = "estado" | "conjunto";

export type SmoothingConfig = {
  /**
   * Força do prior na suavização. Interpretação direta: equivale a somar
   * `strength` votos "médios" ao território antes de calcular a taxa.
   *
   * Existe para impedir que uma seção com 7 votos válidos e 3 para o
   * candidato (43%!) apareça como a maior oportunidade do estado. Quanto
   * menor o território, mais a taxa suavizada puxa para a média geral.
   */
  strength: number;
  /**
   * Quando true, `strength` é estimado da própria distribuição da eleição
   * (método dos momentos sobre uma beta-binomial) em vez de fixo. Cai para o
   * valor fixo se a distribuição não sustentar a estimativa — ver
   * `estimateBetaPrior`.
   */
  estimateFromData: boolean;
  /**
   * Teto para a força do prior estimado, em votos equivalentes.
   *
   * O método dos momentos pode devolver força enorme quando as taxas variam
   * pouco entre territórios — matematicamente correto, mas na prática
   * achataria todo mundo na média e apagaria justamente o sinal que a aba
   * procura. O teto é uma escolha explícita, não uma descoberta: com 500, um
   * município com 1.000 válidos ainda mantém dois terços do peso próprio.
   * Revisar com dado real.
   */
  maxStrength: number;
};

/** Prior beta usado na suavização, já resolvido para uma eleição. */
export type BetaPrior = {
  alpha: number;
  beta: number;
  /** alpha + beta: a "força" efetiva, em votos equivalentes. */
  strength: number;
  /** alpha / (alpha + beta): a taxa média para a qual os pequenos puxam. */
  mean: number;
  /**
   * "estimado" quando saiu do método dos momentos; "configurado" quando a
   * estimativa não era sustentável e caiu no valor fixo. Vai para a interface:
   * a pessoa precisa saber qual dos dois foi usado.
   */
  origin: "estimado" | "configurado";
  /** true quando a estimativa foi limitada pelo teto — precisa aparecer na tela. */
  capped: boolean;
};

export type TerritoryMetrics = {
  ibgeCode: string;
  nome: string;
  votos: number;
  /** Votos válidos do MESMO cargo e turno. Nunca inclui brancos e nulos. */
  validos: number;
  /** votos / validos. null sem denominador apurado. */
  taxa: number | null;
  /** Taxa puxada para a média pelo prior. Sempre definida quando há válidos. */
  taxaSuavizada: number | null;
  /** votos / eleitores * 1000. null sem eleitorado gerado. */
  votosPorMil: number | null;
  /** taxaSuavizada / taxa de referência. null sem taxa. */
  lift: number | null;
  /** votos / votos do bloco partidário no território. null sem dado. */
  participacaoNoBloco: number | null;
  /** votos do território / votos do candidato no estado. */
  concentracao: number;
  posicaoNoMunicipio: number | null;
  /** Eleitorado apto, quando o snapshot existe. */
  eleitorado: number | null;
};

export type ConcentrationSummary = {
  top5: number;
  top10: number;
  top20: number;
  /**
   * Herfindahl-Hirschman sobre a distribuição dos votos do candidato entre
   * territórios, em escala 0–10000. Alto = votação concentrada em poucos
   * lugares; baixo = pulverizada. É a leitura que o top-N não dá sozinho.
   */
  hhi: number;
  /** Quantos territórios respondem por metade da votação total. */
  territoriosParaMetade: number;
};

export type ContestMetrics = {
  contestId: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  round: number;
  /** Total apurado do candidato no estado, direto do snapshot. */
  votosNoEstado: number;
  /** Soma dos votos por município — precisa bater com votosNoEstado. */
  votosSomados: number;
  /** Soma dos válidos do cargo nos municípios com denominador apurado. */
  validosSomados: number;
  /** votosSomados / validosSomados: a taxa de referência estadual. */
  taxaReferencia: number | null;
  prior: BetaPrior;
  concentracao: ConcentrationSummary;
  territorios: TerritoryMetrics[];
  /** Municípios sem denominador — ficam fora de taxa, lift e ranking. */
  territoriosSemDenominador: number;
};

export type OpportunityRankingMetricId =
  | "taxaSuavizada"
  | "lift"
  | "votosPorMil"
  | "participacaoNoBloco"
  | "votos";

export type OpportunityRankingRow = TerritoryMetrics & {
  posicao: number;
  /** Valor da métrica escolhida; linhas sem valor não entram no ranking. */
  valor: number;
};
