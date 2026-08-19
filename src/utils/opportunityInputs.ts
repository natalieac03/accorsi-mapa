/**
 * Insumos da aba Oportunidades: quais pleitos dá para comparar e quais dos
 * sete tipos têm dado para existir.
 *
 * Este módulo nasceu de um choque entre a especificação e o snapshot real.
 * A especificação descreve sete tipos; o snapshot desta instalação sustenta
 * menos que sete, e por motivos distintos entre si. Sem uma camada que diga
 * QUAL insumo falta e POR QUÊ, a tela mostraria "0 municípios" nos tipos sem
 * dado — e "zero" é uma afirmação: quer dizer "procurei e não achei nenhum".
 * O que é verdade ali é outra coisa: "não tenho como procurar". As duas
 * leituras levam a decisões de campanha opostas, então a diferença precisa
 * estar na tela, não num comentário de código.
 *
 * É a mesma disciplina do resto do projeto — ausência nunca vira zero —
 * aplicada um nível acima: não ao valor de um município, mas à existência de
 * um tipo inteiro.
 *
 * Puro: sem React, sem fetch. Recebe o snapshot e as métricas já calculadas,
 * devolve decisões declaradas.
 */

import type { CandidateContest, CandidateDataset } from "../types/candidate";
import type { ContestMetrics, TerritoryMetrics } from "../types/opportunity";
import type { OpportunityTypeId } from "./opportunityTypes";

/**
 * Fração dos municípios do estado que um pleito precisa alcançar para servir
 * de base territorial.
 *
 * Existe por um caso concreto desta instalação: o snapshot traz três
 * candidaturas a Prefeito, todas com `municipiosComVoto: 1` — a votação de
 * uma cidade só. São os pleitos mais numerosos do arquivo, então qualquer
 * seleção por "cargo com mais pleitos" escolheria justamente eles, e a aba
 * inteira analisaria um município e chamaria isso de mapa do estado.
 *
 * Meio estado é um corte grosso de propósito: serve para separar disputa
 * estadual de disputa municipal, não para afinar amostra.
 */
export const COBERTURA_MINIMA_DO_PLEITO = 0.5;

export type PleitoDescartado = {
  contestId: string;
  electionYear: number;
  officeName: string;
  municipiosComVoto: number;
};

export type SelecaoDePleitos = {
  atual: CandidateContest;
  /** Pleito de comparação. null quando só um pleito tem cobertura estadual. */
  anterior: CandidateContest | null;
  /** true quando `anterior` disputou OUTRO cargo que `atual`. */
  entreCargos: boolean;
  /**
   * Ressalva que acompanha toda classificação derivada da comparação, quando
   * ela cruza cargos. Vai para `avisos` de cada território e para o cabeçalho
   * da janela — não fica só aqui.
   */
  avisoDeComparacao: string | null;
  /** Pleitos fora da conta por cobertura, com o número que os excluiu. */
  descartados: PleitoDescartado[];
  /** Quantos municípios um pleito precisava alcançar para entrar. */
  minimoDeMunicipios: number;
};

/**
 * Escolhe o pleito de referência e o de comparação.
 *
 * Critério: cobertura territorial primeiro, recência depois. Entre os pleitos
 * que alcançam meio estado, o mais recente é a referência; a comparação é o
 * mais recente dos restantes, preferindo o MESMO cargo.
 *
 * Quando não há dois pleitos do mesmo cargo — que é o caso aqui — a
 * comparação atravessa cargos, e isso é permitido por um motivo específico:
 * o lift já é uma razão contra a taxa de referência do próprio pleito, então
 * comparar lift de 2022 com lift de 2018 compara duas posições relativas, não
 * duas taxas absolutas de universos diferentes. Continua sendo uma escolha
 * discutível, e por isso ela sai declarada em `avisoDeComparacao` em vez de
 * acontecer em silêncio. Quem discordar troca o critério aqui, num lugar só.
 */
export function selecionarPleitos(
  dataset: CandidateDataset,
  totalDeMunicipios: number,
): SelecaoDePleitos | null {
  const minimoDeMunicipios = Math.ceil(
    totalDeMunicipios * COBERTURA_MINIMA_DO_PLEITO,
  );

  const elegiveis: CandidateContest[] = [];
  const descartados: PleitoDescartado[] = [];

  for (const contest of dataset.contests ?? []) {
    if (contest.municipiosComVoto >= minimoDeMunicipios) {
      elegiveis.push(contest);
    } else {
      descartados.push({
        contestId: contest.id,
        electionYear: contest.electionYear,
        officeName: contest.officeName,
        municipiosComVoto: contest.municipiosComVoto,
      });
    }
  }

  if (elegiveis.length === 0) return null;

  const ordenados = [...elegiveis].sort(
    (a, b) => b.electionYear - a.electionYear || b.round - a.round,
  );

  const atual = ordenados[0];
  const restantes = ordenados.slice(1);
  const mesmoCargo = restantes.find(
    (contest) => contest.officeCode === atual.officeCode,
  );
  const anterior = mesmoCargo ?? restantes[0] ?? null;
  const entreCargos =
    anterior !== null && anterior.officeCode !== atual.officeCode;

  return {
    atual,
    anterior,
    entreCargos,
    avisoDeComparacao: entreCargos
      ? `Comparação entre cargos diferentes: ${atual.officeName} ` +
        `${atual.electionYear} contra ${anterior?.officeName} ` +
        `${anterior?.electionYear}. O snapshot não traz dois pleitos do mesmo ` +
        "cargo com cobertura estadual. O lift é uma posição relativa dentro de " +
        "cada pleito, o que torna a comparação possível, mas ela mistura " +
        "disputas de natureza diferente — leia a tendência com essa ressalva."
      : null,
    descartados,
    minimoDeMunicipios,
  };
}

export type StatusDoInsumo = {
  /** false = o tipo não pode ser calculado; a lista dele não é "vazia". */
  disponivel: boolean;
  /** Por que falta, e o que precisaria existir. Vazio quando disponível. */
  motivo: string;
};

export type InsumosPorTipo = Record<OpportunityTypeId, StatusDoInsumo>;

const DISPONIVEL: StatusDoInsumo = { disponivel: true, motivo: "" };

/**
 * O que cada tipo precisa para existir, verificado contra o dado real.
 *
 * A verificação é feita sobre o snapshot carregado, não sobre uma lista fixa
 * de "tipos suportados": no dia em que o ETL do bloco partidário rodar, os
 * dois tipos que dependem dele voltam sozinhos, sem editar código.
 */
export function avaliarInsumos(argumentos: {
  selecao: SelecaoDePleitos;
  metricas: ContestMetrics;
  ancoras: TerritoryMetrics[];
  /** Quantos territórios receberam similaridade contra as âncoras. */
  territoriosComSimilaridade: number;
  /** Quantos territórios têm comparecimento apurado no snapshot. */
  territoriosComComparecimento: number;
}): InsumosPorTipo {
  const {
    selecao,
    metricas,
    ancoras,
    territoriosComSimilaridade,
    territoriosComComparecimento,
  } = argumentos;

  const comBloco = metricas.territorios.filter(
    (territorio) => territorio.participacaoNoBloco !== null,
  ).length;

  const semAnterior: StatusDoInsumo = {
    disponivel: false,
    motivo:
      "Depende de duas eleições comparáveis; o snapshot da candidatura traz " +
      `apenas um pleito com cobertura de pelo menos ${selecao.minimoDeMunicipios} ` +
      "municípios. Sem o pleito anterior não há tendência para observar.",
  };

  const semBloco: StatusDoInsumo = {
    disponivel: false,
    motivo:
      "Depende da votação do partido por município no mesmo pleito. O campo " +
      "existe no formato do snapshot (`percentualDoPartido`), mas está nulo em " +
      `${metricas.territorios.length} de ${metricas.territorios.length} ` +
      "territórios: o ETL atual só processa votação por partido em pleito " +
      "municipal. Preencher exige processar a votação partidária do cargo " +
      "proporcional correspondente.",
  };

  const semSimilaridade: StatusDoInsumo = {
    disponivel: false,
    motivo:
      ancoras.length === 0
        ? "Depende de territórios âncora — os de desempenho comprovadamente " +
          "acima da média — e nenhum território do pleito atual atinge o lift " +
          "mínimo com o volume mínimo de válidos. Sem âncora não há perfil de " +
          "referência com que comparar."
        : "Depende de similaridade de perfil, e nenhum território reuniu " +
          "variáveis socioeconômicas suficientes para o cálculo de Gower.",
  };

  const semComparecimento: StatusDoInsumo = {
    disponivel: false,
    motivo:
      "Depende do comparecimento por município, que não existe em nenhum " +
      "snapshot deste projeto. Exige um ETL novo sobre o detalhe de votação " +
      "por município e zona do TSE. Enquanto isso, o tipo não é vazio: é " +
      "incalculável.",
  };

  const temAnterior = selecao.anterior !== null;
  const temSimilaridade = territoriosComSimilaridade > 0 && ancoras.length > 0;

  return {
    consolidacao: temAnterior ? DISPONIVEL : semAnterior,
    recuperacao: temAnterior ? DISPONIVEL : semAnterior,
    forcaPessoal: comBloco > 0 ? DISPONIVEL : semBloco,
    afinidadeNaoConvertida: comBloco > 0 ? DISPONIVEL : semBloco,
    expansao: temSimilaridade ? DISPONIVEL : semSimilaridade,
    novaFronteira: temSimilaridade ? DISPONIVEL : semSimilaridade,
    mobilizacao:
      temSimilaridade && territoriosComComparecimento > 0
        ? DISPONIVEL
        : territoriosComComparecimento === 0
          ? semComparecimento
          : semSimilaridade,
  };
}

/** Quantos dos sete tipos têm insumo, para o resumo do cabeçalho. */
export function contarTiposDisponiveis(insumos: InsumosPorTipo): number {
  return Object.values(insumos).filter((status) => status.disponivel).length;
}

export type DiagnosticoDeLimiar = {
  /** O que o limiar separa, em uma linha. */
  rotulo: string;
  /** O corte em uso, já formatado. */
  corte: string;
  passam: number;
  total: number;
  /**
   * true quando o limiar quase não separa nada: deixa passar mais de 95% dos
   * territórios ou menos de 2%.
   *
   * Um corte que aprova 245 de 246 não está classificando — está pintando o
   * estado inteiro de uma cor e chamando isso de achado. O limiar continua
   * sendo o configurado (não é papel deste módulo reajustar número por conta
   * própria, e um limiar movido depois de ver o resultado é justamente o que
   * o portão estatístico da Rodada 3 existe para impedir), mas a tela precisa
   * mostrar que ele não está fazendo trabalho nenhum.
   */
  poucoSeletivo: boolean;
};

function diagnosticar(
  rotulo: string,
  corte: string,
  passam: number,
  total: number,
): DiagnosticoDeLimiar {
  const fracao = total > 0 ? passam / total : 0;
  return {
    rotulo,
    corte,
    passam,
    total,
    poucoSeletivo: total > 0 && (fracao > 0.95 || fracao < 0.02),
  };
}

/**
 * Poder de separação de cada limiar sobre o dado carregado.
 *
 * A especificação já mandava exibir os limiares junto do resultado. Isto vai
 * um passo além, por um motivo aprendido no dado real: exibir "≥ 70%" não
 * conta que 245 dos 246 municípios passam nesse corte. Os dois números juntos
 * são a informação; o limiar sozinho parece critério e pode ser cenário.
 */
export function diagnosticarLimiares(
  metricas: ContestMetrics,
  similaridades: ReadonlyMap<string, number | null>,
  limiares: {
    liftAlto: number;
    liftBaixo: number;
    similaridadeAlta: number;
    minimoDeValidos: number;
  },
): DiagnosticoDeLimiar[] {
  const territorios = metricas.territorios;
  const total = territorios.length;

  const comSimilaridade = [...similaridades.values()].filter(
    (valor): valor is number => valor !== null,
  );

  return [
    diagnosticar(
      "Desempenho alto",
      `lift ≥ ${limiares.liftAlto}`,
      territorios.filter((t) => t.lift !== null && t.lift >= limiares.liftAlto)
        .length,
      total,
    ),
    diagnosticar(
      "Desempenho baixo",
      `lift < ${limiares.liftBaixo}`,
      territorios.filter((t) => t.lift !== null && t.lift < limiares.liftBaixo)
        .length,
      total,
    ),
    diagnosticar(
      "Perfil compatível",
      `similaridade ≥ ${limiares.similaridadeAlta}%`,
      comSimilaridade.filter((valor) => valor >= limiares.similaridadeAlta)
        .length,
      comSimilaridade.length,
    ),
    diagnosticar(
      "Volume suficiente",
      `≥ ${limiares.minimoDeValidos} válidos`,
      territorios.filter((t) => t.validos >= limiares.minimoDeValidos).length,
      total,
    ),
  ];
}
