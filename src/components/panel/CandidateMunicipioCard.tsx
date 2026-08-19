import { TrendingUp } from "lucide-react";
import candidatoJson from "../../data/candidato/adriana-accorsi.json";
import type { CandidateDataset } from "../../types/candidate";
import { isCandidatePendente } from "../../utils/candidate";
import { getMunicipioDestaques } from "../../utils/candidateStats";
import { formatInteger, formatPercent } from "../../utils/electorate";

/**
 * Desempenho da Dra. Adriana no município selecionado, abaixo do cartão de
 * eleitorado. Importa o snapshot direto, como a aba "Accorsi".
 *
 * Um cartão por universo de disputa, no máximo dois: em quase todo município
 * sai um (última eleição estadual ou federal) e em Goiânia saem dois, por conta
 * da prefeitura. Os números NÃO se somam nem se comparam entre universos.
 *
 * Sem voto apurado não há cartão de zero: o componente não renderiza, porque
 * "não apurado" e "zero voto" são afirmações diferentes.
 */

const dataset = candidatoJson as unknown as CandidateDataset;

export function CandidateMunicipioCard({ ibgeCode }: { ibgeCode: string }) {
  if (isCandidatePendente(dataset)) return null;

  const destaques = getMunicipioDestaques(dataset, ibgeCode);
  if (destaques.length === 0) return null;

  return (
    <section
      className="candidate-municipio-section"
      aria-label="Desempenho da Dra. Adriana Accorsi neste município"
    >
      <div className="section-heading-inline">
        <TrendingUp size={14} />
        <strong>Dra. Adriana neste município</strong>
      </div>

      {destaques.map((destaque) => (
        <div className="candidate-municipio-card" key={destaque.contestId}>
          <div className="candidate-municipio-card__head">
            <span>
              {destaque.officeName}
              {destaque.round > 1 ? ` · ${destaque.round}º turno` : ""}
            </span>
            <b>{destaque.electionYear}</b>
          </div>

          <strong className="candidate-municipio-card__votos">
            {formatInteger(destaque.votos)}
          </strong>
          <small>votos nominais apurados aqui</small>

          <div className="candidate-municipio-card__linha">
            <div>
              <span>% dos válidos</span>
              <b>
                {destaque.percentualValidos !== null
                  ? formatPercent(destaque.percentualValidos)
                  : "—"}
              </b>
              <small>
                {destaque.percentualValidos !== null
                  ? "dos votos válidos do município"
                  : "sem total de válidos apurado"}
              </small>
            </div>
            <div>
              <span>Posição aqui</span>
              <b>
                {destaque.posicaoNoMunicipio !== null
                  ? `${destaque.posicaoNoMunicipio}º`
                  : "—"}
              </b>
              <small>
                {destaque.posicaoNoMunicipio !== null
                  ? `de ${formatInteger(destaque.candidaturasComVoto)} candidaturas`
                  : "colocação não apurada"}
              </small>
            </div>
          </div>
        </div>
      ))}

      {destaques.length > 1 && (
        <p className="candidate-municipio-nota">
          São duas disputas diferentes — prefeitura e cadeira legislativa — com
          adversários e regras próprias. Os números ficam lado a lado para
          comparação de território, mas não se somam.
        </p>
      )}
    </section>
  );
}
