import type { CandidateContest } from "../types/candidate";
import { getMunicipalScope, pctValidosNoEstado } from "../utils/candidateStats";
import { formatInteger, formatPercent } from "../utils/electorate";

/**
 * Os cartões de resumo de um pleito — usados na aba lateral da candidata e na
 * janela de Estatísticas, com a mesma leitura nos dois lugares.
 *
 * O ponto deste componente é usar a RÉGUA CERTA para cada tipo de disputa.
 * Prefeita e vereadora se disputam dentro de uma cidade: medi-las pelo estado
 * produzia cartão sem conteúdo — "1 município com voto", "concentração top 5:
 * 100%" — e uma colocação ("3ª de 627 candidaturas") que a comparava com gente
 * que concorria em OUTRA cidade. Num pleito municipal os cartões passam a ser
 * da cidade; em cargo estadual ou federal, onde o estado inteiro é uma disputa
 * só, a leitura estadual continua como estava.
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
  const escopo = getMunicipalScope(contest);
  const Card = ({
    titulo,
    valor,
    nota,
  }: {
    titulo: string;
    valor: string;
    nota: string;
  }) => (
    <div className={cardClassName}>
      <span>{titulo}</span>
      <strong>{valor}</strong>
      <small>{nota}</small>
    </div>
  );

  if (escopo) {
    return (
      <section className={className} aria-label="Resumo do pleito">
        <Card
          titulo={`Votos em ${escopo.nome}`}
          valor={formatInteger(escopo.votos)}
          nota="votos nominais apurados na cidade"
        />
        <Card
          titulo="Posição na cidade"
          valor={
            escopo.posicaoNoMunicipio !== null
              ? `${escopo.posicaoNoMunicipio}º`
              : "—"
          }
          nota={`de ${formatInteger(escopo.candidaturasComVoto)} candidaturas com voto`}
        />
        <Card
          titulo="% dos válidos"
          valor={
            escopo.percentualValidos !== null
              ? formatPercent(escopo.percentualValidos)
              : "—"
          }
          nota={
            escopo.percentualValidos !== null
              ? `sobre ${formatInteger(escopo.validos)} votos válidos`
              : "sem total de válidos apurado"
          }
        />
      </section>
    );
  }

  const pctEstado = pctValidosNoEstado(contest);
  return (
    <section className={className} aria-label="Resumo do pleito">
      <Card
        titulo="Votos no estado"
        valor={formatInteger(contest.votosNoEstado)}
        nota={`em ${formatInteger(contest.municipiosComVoto)} municípios com voto`}
      />
      <Card
        titulo="Posição no pleito"
        valor={
          contest.posicaoNoEstado !== null ? `${contest.posicaoNoEstado}º` : "—"
        }
        nota={`de ${formatInteger(contest.candidaturasNoPleito)} candidaturas do cargo`}
      />
      <Card
        titulo="% dos válidos no estado"
        valor={pctEstado !== null ? formatPercent(pctEstado) : "—"}
        nota="sobre os válidos dos municípios onde teve voto"
      />
      <Card
        titulo="Concentração top 5"
        valor={formatPercent(contest.concentracaoPercentual.top5)}
        nota={`top 10 ${formatPercent(contest.concentracaoPercentual.top10)} · top 20 ${formatPercent(contest.concentracaoPercentual.top20)}`}
      />
    </section>
  );
}
