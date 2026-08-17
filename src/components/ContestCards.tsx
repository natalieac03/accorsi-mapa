import type { CandidateContest } from "../types/candidate";
import { buildContestCards } from "../utils/candidateStats";

/**
 * Os cartões de resumo de um pleito — usados na aba lateral da candidata, na
 * janela de Estatísticas e, agora, no sumário do relatório exportado.
 *
 * A escolha da RÉGUA (municipal × estadual) e o texto de cada cartão moram em
 * `buildContestCards`, no motor: prefeita e vereadora se disputam dentro de
 * uma cidade, e medi-las pelo estado produzia cartão sem conteúdo ("1
 * município com voto", "concentração top 5: 100%") e uma colocação que a
 * comparava com gente que concorria em OUTRA cidade. Este componente só
 * desenha o que o motor decidiu — assim o PDF que vai para a reunião mostra
 * exatamente os mesmos números que a tela mostrou.
 *
 * Resultado de urna não aparece aqui: quando é derrota, a plataforma não
 * carimba (o dado segue no JSON e no CSV); quando é eleição ou 2º turno, quem
 * mostra é o gráfico de trajetória, que tem espaço para o rótulo.
 */
export function ContestCards({
  contest,
  className = "candidate-cards",
  cardClassName,
}: {
  contest: CandidateContest;
  /** "candidate-cards" na barra lateral, "stats-cards" na janela cheia. */
  className?: string;
  cardClassName?: string;
}) {
  return (
    <section className={className} aria-label="Resumo do pleito">
      {buildContestCards(contest).map((card) => (
        <div className={cardClassName} key={card.titulo}>
          <span>{card.titulo}</span>
          <strong>{card.valor}</strong>
          <small>{card.nota}</small>
        </div>
      ))}
    </section>
  );
}
