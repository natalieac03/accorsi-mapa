import type { CandidateContest } from "../types/candidate";
import { buildContestCards } from "../utils/candidateStats";

/**
 * Cartões de resumo de um pleito, usados na aba lateral da candidata, na janela
 * de Estatísticas e no sumário do relatório exportado.
 *
 * A escolha da RÉGUA (municipal x estadual) e o texto de cada cartão moram em
 * `buildContestCards`: medir pleito municipal pelo estado dava cartão vazio ("1
 * município com voto", "concentração top 5: 100%") e colocação contra quem
 * concorreu em OUTRA cidade. Este componente só desenha o que o motor decidiu.
 *
 * Resultado de urna não aparece aqui: quem mostra é o gráfico de trajetória.
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
