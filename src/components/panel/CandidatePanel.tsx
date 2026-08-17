import {
  Building2,
  Download,
  ExternalLink,
  ListOrdered,
  TrendingUp,
  Vote,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ContestCards } from "../ContestCards";
import candidatoJson from "../../data/candidato/adriana-accorsi.json";
import electorateJson from "../../data/electorate-go.json";
import type {
  CandidateDataset,
  CandidateRankingMetricId,
  ElectorateSource,
} from "../../types/candidate";
import { downloadTextFile } from "../../utils/browser";
import {
  buildAxisTicks,
  buildBairroComparisonScope,
  buildElectorateIndex,
  buildMunicipioRanking,
  buildTrajectory,
  CANDIDATE_RANKING_METRICS,
  createCandidateRankingCsv,
  formatCompactPt,
  formatRankingValue,
  getBairros,
  getCandidateCsvFilename,
  getCandidateRankingMetric,
  getOfficeLabel,
  isCandidatePendente,
} from "../../utils/candidate";
import { getMunicipalScope } from "../../utils/candidateStats";
import { formatInteger } from "../../utils/electorate";

/**
 * Aba "Accorsi": a trajetória nominal da candidata em foco, pleito a pleito.
 *
 * O painel importa os dados direto (em vez de recebê-los por props) para não
 * atravessar o App e o MunicipalityLayer com um dataset que só esta aba usa —
 * o mesmo motivo do uiBus: menos acoplamento com o carregamento do mapa.
 */

const dataset = candidatoJson as unknown as CandidateDataset;
const electorateSource = electorateJson as unknown as ElectorateSource;

const RANKING_SIZE = 15;
const BAIRROS_SIZE = 10;

/* Geometria do gráfico de trajetória (viewBox lógico; escala com o painel). */
const CHART_W = 340;
const CHART_H = 200;
const PLOT_LEFT = 40;
const PLOT_RIGHT = 6;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 40;

/**
 * Barra de coluna com topo arredondado (4px) e base reta, como manda a spec
 * de marcas: o dado termina suave, a linha de base continua sendo uma régua.
 */
function columnPath(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, height, width / 2);
  const base = y + height;
  return [
    `M ${x} ${base}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${base}`,
    "Z",
  ].join(" ");
}

export function CandidatePanel() {
  const pendente = isCandidatePendente(dataset);
  const [contestId, setContestId] = useState(dataset.contests[0]?.id ?? "");
  const [metricId, setMetricId] =
    useState<CandidateRankingMetricId>("votos");
  const [exportMessage, setExportMessage] = useState("");

  const trajectory = useMemo(() => buildTrajectory(dataset), []);
  const electorateIndex = useMemo(
    () => buildElectorateIndex(electorateSource),
    [],
  );
  const contest =
    dataset.contests.find((item) => item.id === contestId) ??
    dataset.contests[0] ??
    null;
  const ranking = useMemo(
    () =>
      contest
        ? buildMunicipioRanking(contest, metricId, electorateIndex, RANKING_SIZE)
        : [],
    [contest, metricId, electorateIndex],
  );
  /* A seção de bairros segue o pleito selecionado: a comparação só junta
     eleições do MESMO cargo (regra no motor, em buildBairroComparisonScope). */
  const bairroScope = useMemo(
    () => (contest ? buildBairroComparisonScope(dataset, contest) : null),
    [contest],
  );

  if (pendente || contest === null) {
    return (
      <div
        className="sidebar-view candidate-view"
        role="tabpanel"
        id="sidebar-candidate-panel"
      >
        <div className="workspace-view-header">
          <div>
            <span className="panel-eyebrow">Trajetória nominal</span>
            <h2>Adriana Accorsi</h2>
          </div>
        </div>
        <div className="workspace-empty-state candidate-empty-state">
          <TrendingUp size={26} />
          <strong>Trajetória ainda não gerada</strong>
          <span>
            Este painel lê o voto nominal da candidata, eleição por eleição,
            direto dos dados abertos do TSE. Rode <code>bash gerar_dados.sh</code>{" "}
            na raiz do projeto para baixar e processar os arquivos.
          </span>
        </div>
      </div>
    );
  }

  const metric = getCandidateRankingMetric(metricId);
  const eleitoradoPendente = electorateIndex === null;
  const maxVotos = Math.max(...trajectory.map((point) => point.votos));
  const ticks = buildAxisTicks(maxVotos);
  const plotW = CHART_W - PLOT_LEFT - PLOT_RIGHT;
  const plotH = CHART_H - PLOT_TOP - PLOT_BOTTOM;
  const band = plotW / trajectory.length;
  const barW = Math.min(24, Math.max(10, band - 14));
  const scaleY = (value: number) =>
    PLOT_TOP + plotH - (maxVotos > 0 ? (value / maxVotos) * plotH : 0);

  const maxRankingValue = ranking.length > 0 ? ranking[0].value : 0;

  /* Num pleito de uma cidade só, o ranking de municípios teria UMA linha
     repetindo o cartão de cima; quem informa ali embaixo é o de bairros. */
  const escopo = getMunicipalScope(contest);
  const bairrosAtuais = getBairros(contest)?.slice(0, BAIRROS_SIZE) ?? null;
  const comparacao = bairroScope?.comparacao ?? null;
  const cargoComparado = bairroScope?.officeLabel ?? getOfficeLabel(contest);
  /* Um pleito só daquele cargo com recorte: não há comparação possível, e a
     seção precisa dizer isso — sumir sem explicação deixaria a impressão de
     que a leitura por bairro não existe para o cargo selecionado. */
  const pleitoUnicoComBairros =
    bairroScope?.pleitos.length === 1 ? bairroScope.pleitos[0] : null;
  const comparacaoBairros = comparacao?.rows.slice(0, BAIRROS_SIZE) ?? null;
  const maxComparacao = comparacaoBairros
    ? Math.max(
        1,
        ...comparacaoBairros.flatMap((row) => [
          row.votosAnterior ?? 0,
          row.votosRecente ?? 0,
        ]),
      )
    : 1;

  const handleExport = () => {
    downloadTextFile(
      createCandidateRankingCsv(metricId, ranking),
      getCandidateCsvFilename(contest, metricId),
      "text/csv;charset=utf-8",
    );
    setExportMessage(`${formatInteger(ranking.length)} municípios exportados.`);
  };

  return (
    <div
      className="sidebar-view candidate-view"
      role="tabpanel"
      id="sidebar-candidate-panel"
    >
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Trajetória nominal</span>
          <h2>{dataset.metadata.nomeConsultado ?? "Adriana Accorsi"}</h2>
        </div>
      </div>

      <p className="workspace-description">
        Voto nominal da candidata separado do voto do partido, eleição por
        eleição, com recorte municipal — e por bairro de Goiânia quando o TSE
        publica o cadastro de locais do ano.
      </p>

      {/* Gráfico central: colunas por pleito. Série única, então a cor não
          precisa distinguir nada — o vermelho cheio marca o pleito selecionado
          e o resto recua (forma "ênfase"); clicar numa barra troca o pleito. */}
      <section className="candidate-chart" aria-label="Votos por eleição">
        <div className="analysis-section-heading">
          <span>
            <TrendingUp size={14} /> Votos por eleição
          </span>
        </div>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label={`Votos totais por eleição, de ${trajectory[0].electionYear} a ${trajectory[trajectory.length - 1].electionYear}`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PLOT_LEFT}
                x2={CHART_W - PLOT_RIGHT}
                y1={scaleY(tick)}
                y2={scaleY(tick)}
                className={
                  tick === 0 ? "candidate-chart-baseline" : "candidate-chart-grid"
                }
              />
              <text
                x={PLOT_LEFT - 5}
                y={scaleY(tick) + 2.5}
                className="candidate-chart-tick"
                textAnchor="end"
              >
                {formatCompactPt(tick)}
              </text>
            </g>
          ))}
          {trajectory.map((point, index) => {
            const x = PLOT_LEFT + band * index + (band - barW) / 2;
            const y = scaleY(point.votos);
            const height = PLOT_TOP + plotH - y;
            const center = PLOT_LEFT + band * index + band / 2;
            const selected = point.id === contest.id;
            const turno = point.round > 1 ? ` · ${point.round}º turno` : "";
            return (
              <g
                key={point.id}
                className={
                  selected
                    ? "candidate-traj-bar candidate-traj-bar--selected"
                    : "candidate-traj-bar"
                }
                onClick={() => setContestId(point.id)}
              >
                <title>
                  {/* resultadoLabel vem vazio quando não é para carimbar. */}
                  {`${point.electionYear} · ${point.officeName}${turno} · ${formatInteger(point.votos)} votos${point.resultadoLabel ? ` · ${point.resultadoLabel}` : ""}`}
                </title>
                {/* alvo de clique maior que a marca (a coluna é fina) */}
                <rect
                  x={PLOT_LEFT + band * index}
                  y={PLOT_TOP}
                  width={band}
                  height={plotH + PLOT_BOTTOM}
                  fill="transparent"
                />
                <path d={columnPath(x, y, barW, height)} className="candidate-traj-fill" />
                <text x={center} y={y - 5} className="candidate-chart-value" textAnchor="middle">
                  {formatCompactPt(point.votos)}
                </text>
                <text
                  x={center}
                  y={PLOT_TOP + plotH + 13}
                  className="candidate-chart-year"
                  textAnchor="middle"
                >
                  {point.electionYear}
                </text>
                <text
                  x={center}
                  y={PLOT_TOP + plotH + 24}
                  className="candidate-chart-office"
                  textAnchor="middle"
                >
                  {point.officeShort}
                </text>
                {point.resultadoShort && (
                  <text
                    x={center}
                    y={PLOT_TOP + plotH + 34}
                    className="candidate-chart-office"
                    textAnchor="middle"
                  >
                    {point.resultadoShort}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </section>

      <label className="analysis-metric-control candidate-contest-control">
        <span>
          <Vote size={15} /> Pleito em detalhe
        </span>
        <select
          value={contest.id}
          onChange={(event) => setContestId(event.target.value)}
        >
          {trajectory.map((point) => (
            <option value={point.id} key={point.id}>
              {point.electionYear} · {point.officeName}
              {point.round > 1 ? ` · ${point.round}º turno` : ""}
              {point.resultadoLabel ? ` · ${point.resultadoLabel}` : ""}
            </option>
          ))}
        </select>
        <small>
          {contest.candidatura.nomeUrna} · {contest.candidatura.partido}{" "}
          {contest.candidatura.numero}
        </small>
      </label>

      <ContestCards contest={contest} className="candidate-cards" />

      {!escopo && (
      <section className="analysis-ranking-section" aria-label="Ranking de municípios">
        <div className="analysis-ranking-header">
          <div>
            <span>
              <ListOrdered size={13} /> Ranking de municípios
            </span>
            <small>{metric.description}</small>
          </div>
        </div>

        <div
          className="candidate-metric-tabs"
          role="group"
          aria-label="Métrica do ranking"
        >
          {CANDIDATE_RANKING_METRICS.map((item) => {
            const disabled = item.requiresElectorate && eleitoradoPendente;
            return (
              <button
                type="button"
                key={item.id}
                className={
                  metricId === item.id ? "candidate-metric--active" : ""
                }
                aria-pressed={metricId === item.id}
                disabled={disabled}
                title={
                  disabled
                    ? "Eleitorado ainda não gerado — rode bash gerar_dados.sh"
                    : item.description
                }
                onClick={() => setMetricId(item.id)}
              >
                {item.shortLabel}
              </button>
            );
          })}
        </div>
        {eleitoradoPendente && (
          <p className="candidate-metric-note">
            “Votos por 1.000 eleitores” precisa do snapshot do eleitorado
            (electorate-go.json), ainda pendente. Rode{" "}
            <code>bash gerar_dados.sh</code> para habilitar.
          </p>
        )}

        <div className="candidate-ranking-list">
          {ranking.map((row, index) => (
            <div className="candidate-ranking-row" key={row.ibgeCode}>
              <span className="analysis-rank-number">#{index + 1}</span>
              <span className="analysis-rank-main">
                <span>
                  <strong>{row.nome}</strong>
                  <em>{formatRankingValue(metricId, row.value)}</em>
                </span>
                <span className="candidate-rank-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${
                        maxRankingValue > 0
                          ? Math.max(2, (row.value / maxRankingValue) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </span>
              </span>
            </div>
          ))}
          {ranking.length === 0 && (
            <p className="candidate-metric-note">
              Nenhum município tem denominador para esta métrica neste pleito.
            </p>
          )}
        </div>

        <button
          className="candidate-export-button"
          type="button"
          onClick={handleExport}
          disabled={ranking.length === 0}
        >
          <Download size={15} /> Baixar ranking em CSV
        </button>
        <div className="sr-only" role="status" aria-live="polite">
          {exportMessage}
        </div>
      </section>
      )}

      {(bairrosAtuais || comparacaoBairros || pleitoUnicoComBairros) && (
        <section
          className="insight-section candidate-bairros"
          aria-label="Bairros de Goiânia"
        >
          <div className="section-heading-inline">
            <Building2 size={14} />
            <strong>Bairros de Goiânia</strong>
          </div>

          {bairrosAtuais && (
            <div className="candidate-bairro-list">
              {/* Mesmo rótulo de cargo da comparação abaixo: dentro de uma
                  seção só, o pleito não pode ter dois nomes. */}
              <p className="candidate-bairro-caption">
                Top {bairrosAtuais.length} bairros no pleito selecionado (
                {contest.electionYear} · {cargoComparado}).
              </p>
              {bairrosAtuais.map((row) => (
                <div className="candidate-bairro-row" key={row.bairro}>
                  <span className="candidate-bairro-name">{row.bairro}</span>
                  <em>{formatInteger(row.votos)}</em>
                </div>
              ))}
              {contest.votosSemLocalDeVotacao > 0 && (
                <p className="candidate-bairro-caption">
                  {formatInteger(contest.votosSemLocalDeVotacao)} votos vieram
                  de seções sem local no cadastro do TSE e ficam fora do recorte
                  por bairro.
                </p>
              )}
            </div>
          )}

          {!bairrosAtuais && (
            <p className="candidate-bairro-caption">
              O pleito selecionado não tem recorte por bairro (o TSE não
              publicou o cadastro de locais daquele ano).
              {comparacao
                ? ` A comparação abaixo usa os outros pleitos de ${cargoComparado}.`
                : ""}
            </p>
          )}

          {/* Cargo com um pleito só de recorte: a frase substitui a comparação
              — dizer "não há com o que comparar" é honesto; comparar com outro
              cargo seria mostrar uma variação que não mede nada. */}
          {pleitoUnicoComBairros && (
            <p className="candidate-bairro-caption">
              Só há um pleito de {cargoComparado} com recorte por bairro (
              {pleitoUnicoComBairros.electionYear}) — não há com o que comparar.
              A comparação só junta pleitos do mesmo cargo: disputar a
              prefeitura e disputar uma cadeira legislativa são corridas
              diferentes.
            </p>
          )}

          {comparacaoBairros && comparacao && (
            <div className="candidate-bairro-compare">
              <p className="candidate-bairro-caption">
                Onde a votação cresceu na capital entre pleitos de{" "}
                {cargoComparado}: {comparacao.anterior.electionYear} →{" "}
                {comparacao.recente.electionYear}, variação sobre{" "}
                {comparacao.anterior.electionYear}.
              </p>
              {/* Duas séries do MESMO tom (antes claro, depois cheio): é um
                  antes/depois por bairro, não duas identidades — validado como
                  rampa ordinal de 2 passos sobre a superfície branca. */}
              <div className="candidate-bairro-legend" aria-hidden="true">
                <span>
                  <i className="candidate-swatch candidate-swatch--anterior" />
                  {comparacao.anterior.electionYear} · {cargoComparado}
                </span>
                <span>
                  <i className="candidate-swatch candidate-swatch--recente" />
                  {comparacao.recente.electionYear} · {cargoComparado}
                </span>
              </div>
              {comparacaoBairros.map((row) => (
                <div className="candidate-bairro-pair" key={row.bairro}>
                  <span className="candidate-bairro-name">{row.bairro}</span>
                  <span className="candidate-bairro-values">
                    <em>
                      {row.votosAnterior !== null
                        ? formatInteger(row.votosAnterior)
                        : "—"}{" "}
                      →{" "}
                      {row.votosRecente !== null
                        ? formatInteger(row.votosRecente)
                        : "—"}
                    </em>
                    <strong>
                      {row.variacaoPct !== null
                        ? `${row.variacaoPct > 0 ? "+" : ""}${row.variacaoPct.toLocaleString("pt-BR")}%`
                        : row.votosAnterior === null
                          ? "novo"
                          : "sem base"}
                    </strong>
                  </span>
                  <span className="candidate-bairro-bars" aria-hidden="true">
                    <span
                      className="candidate-bairro-bar candidate-bairro-bar--anterior"
                      style={{
                        width: `${((row.votosAnterior ?? 0) / maxComparacao) * 100}%`,
                      }}
                    />
                    <span
                      className="candidate-bairro-bar candidate-bairro-bar--recente"
                      style={{
                        width: `${((row.votosRecente ?? 0) / maxComparacao) * 100}%`,
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {dataset.metadata.sourceUrl && (
        <a
          className="analysis-source candidate-source"
          href={dataset.metadata.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          <span>TSE · Votação nominal por seção</span>
          <strong>
            {dataset.metadata.pleitos} pleitos ·{" "}
            {dataset.metadata.anos.join(", ")}
          </strong>
          <ExternalLink size={13} />
        </a>
      )}

      <p className="comparison-note analysis-note">
        Voto nominal oficial e agregado, separado do voto de legenda. Percentual
        só existe onde há denominador apurado; município ou bairro sem dado fica
        fora dos rankings em vez de aparecer como zero.
      </p>
    </div>
  );
}
