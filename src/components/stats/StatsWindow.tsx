import {
  BarChart3,
  Download,
  Landmark,
  ListOrdered,
  MapPin,
  ScatterChart,
  Sigma,
  TrendingUp,
  Vote,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ageStructureJson from "../../data/age-structure-go.json";
import candidatoJson from "../../data/candidato/adriana-accorsi.json";
import electorateJson from "../../data/electorate-go.json";
import literacyJson from "../../data/literacy-go.json";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateRankingMetricId,
  ElectorateSource,
  StatsIndicatorId,
  StatsIndicatorSource,
} from "../../types/candidate";
import { formatAnalysisMetricValue } from "../../utils/analysis";
import { downloadTextFile } from "../../utils/browser";
import {
  buildAxisTicks,
  buildElectorateIndex,
  buildMunicipioRanking,
  buildTrajectory,
  createCandidateRankingCsv,
  formatCompactPt,
  formatRankingValue,
  getCandidateCsvFilename,
  getCandidateRankingMetric,
  getContestLabel,
  getOfficeShort,
  isCandidatePendente,
} from "../../utils/candidate";
import {
  buildCareerOverview,
  buildScatter,
  buildStatsProfiles,
  createScatterCsv,
  createTrajectoryCsv,
  getScatterCsvFilename,
  getTrajectoryCsvFilename,
  groupContests,
  isMunicipalContest,
  pctValidosNoEstado,
  STATS_INDICATORS,
} from "../../utils/candidateStats";
import { formatInteger, formatPercent } from "../../utils/electorate";

/**
 * Janela "Estatísticas": overlay de tela inteira dedicado às campanhas da
 * Dra. Adriana Accorsi. Carregada por React.lazy a partir do App — os quatro
 * snapshots que ela importa só são baixados quando alguém abre a janela.
 *
 * Toda a aritmética mora em utils/candidateStats.ts (motor puro, testado);
 * aqui é só composição visual. Como no resto do projeto, os dados importados
 * podem ser placeholders "pendente" — a janela mostra o estado vazio com a
 * instrução do gerar_dados.sh e nunca quebra.
 */

const dataset = candidatoJson as unknown as CandidateDataset;
const electorateSource = electorateJson as unknown as ElectorateSource;
const indicatorSource: StatsIndicatorSource = {
  electorate: electorateJson as unknown as StatsIndicatorSource["electorate"],
  age: ageStructureJson as unknown as StatsIndicatorSource["age"],
  literacy: literacyJson as unknown as StatsIndicatorSource["literacy"],
};

const RANKING_SIZE = 15;

/*
 * Cores das duas categorias da trajetória (municipal × federal/estadual),
 * validadas com o validador da skill de dataviz sobre a superfície #0f0809:
 * CVD ΔE 25,0 (protan) e visão normal ΔE 34,1 — muito acima dos pisos 8/15 —
 * e ambas ≥ 3:1 de contraste. A identidade nunca é só cor: o cargo está
 * escrito sob cada barra e a legenda acompanha o gráfico.
 */
const COR_MUNICIPAL = "#3987e5";
const COR_FEDERAL = "#f0433b";

const decimalPt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});
const pearsonPt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Coluna com topo arredondado (4px) e base reta, mesma spec das demais. */
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

type StatsView = "overview" | string;

export function StatsWindow({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<StatsView>("overview");
  const [rankingMetric, setRankingMetric] =
    useState<CandidateRankingMetricId>("votos");
  const [indicatorId, setIndicatorId] = useState<StatsIndicatorId>("female");
  const [exportMessage, setExportMessage] = useState("");
  const fecharRef = useRef<HTMLButtonElement | null>(null);

  // Esc fecha; o foco nasce no botão de fechar para o teclado ter porta de saída.
  useEffect(() => {
    fecharRef.current?.focus();
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onClose();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onClose]);

  const pendente = isCandidatePendente(dataset);
  const groups = useMemo(() => groupContests(dataset), []);
  const overview = useMemo(() => buildCareerOverview(dataset), []);
  const trajectory = useMemo(() => buildTrajectory(dataset), []);
  const profiles = useMemo(() => buildStatsProfiles(indicatorSource), []);
  const electorateIndex = useMemo(
    () => buildElectorateIndex(electorateSource),
    [],
  );

  const contest =
    view === "overview"
      ? null
      : (dataset.contests.find((item) => item.id === view) ?? null);

  const ranking = useMemo(
    () =>
      contest
        ? buildMunicipioRanking(
            contest,
            rankingMetric,
            electorateIndex,
            RANKING_SIZE,
          )
        : [],
    [contest, rankingMetric, electorateIndex],
  );

  const scatter = useMemo(
    () => (contest ? buildScatter(contest, indicatorId, profiles) : null),
    [contest, indicatorId, profiles],
  );

  const anunciarExport = (linhas: number) =>
    setExportMessage(`${formatInteger(linhas)} linhas exportadas em CSV.`);

  return (
    <div
      className="stats-window"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stats-window-title"
    >
      <header className="stats-window__header">
        <div className="stats-window__title">
          <BarChart3 size={18} aria-hidden />
          <div>
            <h2 id="stats-window-title">Estatísticas</h2>
            <span>Campanhas da Dra. Adriana Accorsi · Goiás</span>
          </div>
        </div>
        <button
          type="button"
          className="stats-window__close"
          onClick={onClose}
          ref={fecharRef}
        >
          <X size={16} aria-hidden />
          <span>Fechar</span>
        </button>
      </header>

      {pendente ? (
        <div className="stats-window__body stats-window__body--empty">
          <div className="workspace-empty-state stats-empty-state">
            <BarChart3 size={26} aria-hidden />
            <strong>Estatísticas ainda não geradas</strong>
            <span>
              Esta janela lê a trajetória nominal da candidata direto dos dados
              abertos do TSE, que ainda não foram baixados nesta instalação.
              Rode <code>bash gerar_dados.sh</code> na raiz do projeto e volte
              aqui.
            </span>
          </div>
        </div>
      ) : (
        <div className="stats-window__body">
          <nav className="stats-nav" aria-label="Seções das estatísticas">
            <button
              type="button"
              className={view === "overview" ? "stats-nav__item stats-nav__item--active" : "stats-nav__item"}
              aria-current={view === "overview" ? "page" : undefined}
              onClick={() => setView("overview")}
            >
              <TrendingUp size={14} aria-hidden />
              <span>Visão geral</span>
            </button>

            {/* Grupos derivados do dado: uma eleição nova no JSON aparece no
                grupo certo sem tocar em código. */}
            {groups.municipais.length > 0 && (
              <>
                <span className="stats-nav__group">
                  <MapPin size={12} aria-hidden /> Municipais
                </span>
                {groups.municipais.map((item) => (
                  <NavItem
                    key={item.id}
                    id={item.id}
                    active={view === item.id}
                    year={item.electionYear}
                    office={getOfficeShort(item.officeCode, item.officeName)}
                    round={item.round}
                    onSelect={setView}
                  />
                ))}
              </>
            )}
            {groups.federaisEstaduais.length > 0 && (
              <>
                <span className="stats-nav__group">
                  <Landmark size={12} aria-hidden /> Federais e estaduais
                </span>
                {groups.federaisEstaduais.map((item) => (
                  <NavItem
                    key={item.id}
                    id={item.id}
                    active={view === item.id}
                    year={item.electionYear}
                    office={getOfficeShort(item.officeCode, item.officeName)}
                    round={item.round}
                    onSelect={setView}
                  />
                ))}
              </>
            )}
          </nav>

          <div className="stats-content">
            {contest === null ? (
              <OverviewView
                overview={overview}
                trajectory={trajectory}
                onSelectContest={setView}
                onExport={() => {
                  downloadTextFile(
                    createTrajectoryCsv(dataset),
                    getTrajectoryCsvFilename(dataset),
                    "text/csv;charset=utf-8",
                  );
                  anunciarExport(dataset.contests.length);
                }}
              />
            ) : (
              <ElectionView
                contest={contest}
                ranking={ranking}
                rankingMetric={rankingMetric}
                onRankingMetric={setRankingMetric}
                eleitoradoPendente={electorateIndex === null}
                scatter={scatter}
                indicatorId={indicatorId}
                onIndicator={setIndicatorId}
                onExportRanking={() => {
                  downloadTextFile(
                    createCandidateRankingCsv(rankingMetric, ranking),
                    getCandidateCsvFilename(contest, rankingMetric),
                    "text/csv;charset=utf-8",
                  );
                  anunciarExport(ranking.length);
                }}
                onExportScatter={() => {
                  if (!scatter) return;
                  downloadTextFile(
                    createScatterCsv(scatter),
                    getScatterCsvFilename(contest, indicatorId),
                    "text/csv;charset=utf-8",
                  );
                  anunciarExport(scatter.points.length);
                }}
              />
            )}
          </div>
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {exportMessage}
      </div>
    </div>
  );
}

function NavItem({
  id,
  active,
  year,
  office,
  round,
  onSelect,
}: {
  id: string;
  active: boolean;
  year: number;
  office: string;
  round: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={active ? "stats-nav__item stats-nav__item--active" : "stats-nav__item"}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(id)}
    >
      <strong>{year}</strong>
      <span>
        {office}
        {round > 1 ? ` · ${round}º turno` : ""}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Visão geral
 * ------------------------------------------------------------------------- */

/* Geometria do gráfico de trajetória (viewBox lógico; escala com a janela). */
const TRAJ_W = 640;
const TRAJ_H = 250;
const TRAJ_LEFT = 48;
const TRAJ_RIGHT = 10;
const TRAJ_TOP = 22;
const TRAJ_BOTTOM = 46;

function OverviewView({
  overview,
  trajectory,
  onSelectContest,
  onExport,
}: {
  overview: ReturnType<typeof buildCareerOverview>;
  trajectory: ReturnType<typeof buildTrajectory>;
  onSelectContest: (id: string) => void;
  onExport: () => void;
}) {
  const maxVotos = Math.max(...trajectory.map((point) => point.votos));
  const ticks = buildAxisTicks(maxVotos);
  const plotW = TRAJ_W - TRAJ_LEFT - TRAJ_RIGHT;
  const plotH = TRAJ_H - TRAJ_TOP - TRAJ_BOTTOM;
  const band = plotW / Math.max(1, trajectory.length);
  const barW = Math.min(44, Math.max(14, band - 26));
  const scaleY = (value: number) =>
    TRAJ_TOP + plotH - (maxVotos > 0 ? (value / maxVotos) * plotH : 0);
  const { best, growth } = overview;

  return (
    <section aria-label="Visão geral da carreira">
      <p className="stats-lede">
        Seis leituras que valem para a carreira inteira. Cada eleição é um
        universo próprio — eleitores, cargo e regras diferentes —, então os
        votos de pleitos distintos <strong>nunca são somados</strong> num total
        único: o que atravessa campanhas é comparação e contagem, não soma.
      </p>

      <div className="stats-cards">
        <div className="stats-card">
          <span>Melhor votação da carreira</span>
          <strong>{best ? formatInteger(best.votos) : "—"}</strong>
          <small>
            {best
              ? `${best.electionYear} · ${best.officeName}${best.round > 1 ? ` · ${best.round}º turno` : ""}`
              : "sem pleito apurado"}
          </small>
        </div>
        <div className="stats-card">
          <span>Crescimento municipal</span>
          <strong>
            {growth
              ? `${growth.variacaoPct > 0 ? "+" : ""}${decimalPt.format(growth.variacaoPct)}%`
              : "—"}
          </strong>
          <small>
            {growth
              ? `${growth.officeName}, ${growth.anoAnterior} → ${growth.anoRecente} (mesmo cargo e turno)`
              : "sem dois pleitos municipais comparáveis (mesmo cargo e turno)"}
          </small>
        </div>
        <div className="stats-card">
          <span>Municípios alcançados</span>
          <strong>{formatInteger(overview.municipiosAlcancados)}</strong>
          <small>com voto nominal em pelo menos um pleito</small>
        </div>
        <div className="stats-card">
          <span>Campanhas disputadas</span>
          <strong>{formatInteger(overview.campanhas)}</strong>
          <small>1º e 2º turno contam como a mesma campanha</small>
        </div>
      </div>

      <div className="stats-panel">
        <div className="stats-panel__heading">
          <span>
            <TrendingUp size={14} aria-hidden /> Trajetória completa
          </span>
          <button type="button" className="stats-export" onClick={onExport}>
            <Download size={14} aria-hidden /> CSV
          </button>
        </div>
        <div className="stats-legend" aria-hidden="true">
          <span>
            <i style={{ background: COR_MUNICIPAL }} /> Municipais (prefeita ·
            vereadora)
          </span>
          <span>
            <i style={{ background: COR_FEDERAL }} /> Federais e estaduais
          </span>
        </div>
        <svg
          viewBox={`0 0 ${TRAJ_W} ${TRAJ_H}`}
          role="img"
          aria-label={`Votos por eleição, de ${trajectory[0].electionYear} a ${trajectory[trajectory.length - 1].electionYear}, coloridos por tipo de disputa`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={TRAJ_LEFT}
                x2={TRAJ_W - TRAJ_RIGHT}
                y1={scaleY(tick)}
                y2={scaleY(tick)}
                className={tick === 0 ? "stats-chart-baseline" : "stats-chart-grid"}
              />
              <text
                x={TRAJ_LEFT - 6}
                y={scaleY(tick) + 3}
                className="stats-chart-tick"
                textAnchor="end"
              >
                {formatCompactPt(tick)}
              </text>
            </g>
          ))}
          {trajectory.map((point, index) => {
            const x = TRAJ_LEFT + band * index + (band - barW) / 2;
            const y = scaleY(point.votos);
            const height = TRAJ_TOP + plotH - y;
            const center = TRAJ_LEFT + band * index + band / 2;
            const municipal = isMunicipalContest(point);
            const turno = point.round > 1 ? ` · ${point.round}º turno` : "";
            return (
              <g
                key={point.id}
                className="stats-traj-bar"
                onClick={() => onSelectContest(point.id)}
              >
                <title>
                  {`${point.electionYear} · ${point.officeName}${turno} · ${formatInteger(point.votos)} votos · ${point.resultadoLabel} — clique para abrir o pleito`}
                </title>
                {/* alvo de clique maior que a marca */}
                <rect
                  x={TRAJ_LEFT + band * index}
                  y={TRAJ_TOP}
                  width={band}
                  height={plotH + TRAJ_BOTTOM}
                  fill="transparent"
                />
                <path
                  d={columnPath(x, y, barW, height)}
                  fill={municipal ? COR_MUNICIPAL : COR_FEDERAL}
                  className="stats-traj-fill"
                />
                <text
                  x={center}
                  y={y - 6}
                  className="stats-chart-value"
                  textAnchor="middle"
                >
                  {formatCompactPt(point.votos)}
                </text>
                <text
                  x={center}
                  y={TRAJ_TOP + plotH + 15}
                  className="stats-chart-year"
                  textAnchor="middle"
                >
                  {point.electionYear}
                </text>
                <text
                  x={center}
                  y={TRAJ_TOP + plotH + 27}
                  className="stats-chart-office"
                  textAnchor="middle"
                >
                  {point.officeShort}
                  {point.round > 1 ? ` · ${point.round}º t.` : ""}
                </text>
                <text
                  x={center}
                  y={TRAJ_TOP + plotH + 38}
                  className="stats-chart-office"
                  textAnchor="middle"
                >
                  {point.resultadoShort}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="stats-note">
          Alturas comparam a força de cada campanha isoladamente; universos de
          eleitores diferentes (uma cidade × o estado inteiro) tornam qualquer
          soma entre barras sem significado. Clique numa barra para abrir o
          dashboard do pleito.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Dashboard por eleição
 * ------------------------------------------------------------------------- */

/* Geometria do scatter (viewBox lógico). */
const SC_W = 640;
const SC_H = 330;
const SC_LEFT = 52;
const SC_RIGHT = 14;
const SC_TOP = 14;
const SC_BOTTOM = 40;

function ElectionView({
  contest,
  ranking,
  rankingMetric,
  onRankingMetric,
  eleitoradoPendente,
  scatter,
  indicatorId,
  onIndicator,
  onExportRanking,
  onExportScatter,
}: {
  contest: CandidateContest;
  ranking: ReturnType<typeof buildMunicipioRanking>;
  rankingMetric: CandidateRankingMetricId;
  onRankingMetric: (id: CandidateRankingMetricId) => void;
  eleitoradoPendente: boolean;
  scatter: ReturnType<typeof buildScatter> | null;
  indicatorId: StatsIndicatorId;
  onIndicator: (id: StatsIndicatorId) => void;
  onExportRanking: () => void;
  onExportScatter: () => void;
}) {
  const municipal = isMunicipalContest(contest);
  const pctEstado = pctValidosNoEstado(contest);
  const metric = getCandidateRankingMetric(rankingMetric);
  const maxRanking = ranking.length > 0 ? ranking[0].value : 0;

  return (
    <section aria-label={`Dashboard do pleito ${getContestLabel(contest)}`}>
      <p className="stats-lede">
        <strong>{getContestLabel(contest)}</strong> ·{" "}
        {contest.candidatura.nomeUrna} · {contest.candidatura.partido}{" "}
        {contest.candidatura.numero} · {contest.candidatura.resultado || "—"}
      </p>

      <div className="stats-cards">
        <div className="stats-card">
          <span>Votos no estado</span>
          <strong>{formatInteger(contest.votosNoEstado)}</strong>
          <small>
            em {formatInteger(contest.municipiosComVoto)} municípios com voto
          </small>
        </div>
        <div className="stats-card">
          <span>Posição no pleito</span>
          <strong>
            {contest.posicaoNoEstado !== null
              ? `${contest.posicaoNoEstado}º`
              : "—"}
          </strong>
          <small>
            de {formatInteger(contest.candidaturasNoPleito)} candidaturas do
            cargo
          </small>
        </div>
        {!municipal && (
          <div className="stats-card">
            <span>% dos válidos no estado</span>
            <strong>{pctEstado !== null ? formatPercent(pctEstado) : "—"}</strong>
            <small>sobre os válidos dos municípios onde teve voto</small>
          </div>
        )}
        <div className="stats-card">
          <span>Concentração top 5</span>
          <strong>{formatPercent(contest.concentracaoPercentual.top5)}</strong>
          <small>
            top 10 {formatPercent(contest.concentracaoPercentual.top10)} · top
            20 {formatPercent(contest.concentracaoPercentual.top20)}
          </small>
        </div>
      </div>

      <div className="stats-panel">
        <div className="stats-panel__heading">
          <span>
            <ListOrdered size={14} aria-hidden /> Top {RANKING_SIZE} municípios
          </span>
          <button
            type="button"
            className="stats-export"
            onClick={onExportRanking}
            disabled={ranking.length === 0}
          >
            <Download size={14} aria-hidden /> CSV
          </button>
        </div>

        {/* Alternância entre as duas leituras: força bruta × densidade. */}
        <div className="stats-toggle" role="group" aria-label="Métrica do ranking">
          <button
            type="button"
            className={rankingMetric === "votos" ? "stats-toggle--active" : ""}
            aria-pressed={rankingMetric === "votos"}
            onClick={() => onRankingMetric("votos")}
          >
            Votos absolutos
          </button>
          <button
            type="button"
            className={
              rankingMetric === "votosPorMilEleitores"
                ? "stats-toggle--active"
                : ""
            }
            aria-pressed={rankingMetric === "votosPorMilEleitores"}
            disabled={eleitoradoPendente}
            title={
              eleitoradoPendente
                ? "Eleitorado ainda não gerado — rode bash gerar_dados.sh"
                : "Votos a cada 1.000 eleitores aptos do município"
            }
            onClick={() => onRankingMetric("votosPorMilEleitores")}
          >
            Votos por 1.000 eleitores
          </button>
        </div>
        <p className="stats-note">{metric.description}</p>

        <div className="stats-ranking">
          {ranking.map((row, index) => (
            <div className="stats-ranking__row" key={row.ibgeCode}>
              <span className="stats-ranking__pos">#{index + 1}</span>
              <span className="stats-ranking__name">{row.nome}</span>
              <span className="stats-ranking__track" aria-hidden="true">
                <span
                  style={{
                    width: `${maxRanking > 0 ? Math.max(1.5, (row.value / maxRanking) * 100) : 0}%`,
                  }}
                />
              </span>
              <em className="stats-ranking__value">
                {formatRankingValue(rankingMetric, row.value)}
              </em>
            </div>
          ))}
          {ranking.length === 0 && (
            <p className="stats-note">
              Nenhum município tem denominador apurado para esta métrica neste
              pleito.
            </p>
          )}
        </div>
      </div>

      {scatter && (
        <ScatterSection
          scatter={scatter}
          indicatorId={indicatorId}
          onIndicator={onIndicator}
          onExport={onExportScatter}
          municipal={municipal}
        />
      )}
    </section>
  );
}

function ScatterSection({
  scatter,
  indicatorId,
  onIndicator,
  onExport,
  municipal,
}: {
  scatter: NonNullable<ReturnType<typeof buildScatter>>;
  indicatorId: StatsIndicatorId;
  onIndicator: (id: StatsIndicatorId) => void;
  onExport: () => void;
  municipal: boolean;
}) {
  const { indicator, points } = scatter;
  const semDado = scatter.semIndicador + scatter.semPercentual;

  // Escalas: X cobre o intervalo observado com folga de 4%; Y parte do zero —
  // % dos válidos é proporção e cortar a base exageraria diferenças.
  const xs = points.map((p) => p.x);
  const xMinRaw = xs.length > 0 ? Math.min(...xs) : 0;
  const xMaxRaw = xs.length > 0 ? Math.max(...xs) : 1;
  const pad = xMaxRaw > xMinRaw ? (xMaxRaw - xMinRaw) * 0.04 : 1;
  const xMin = xMinRaw - pad;
  const xMax = xMaxRaw + pad;
  const yMax = Math.max(1e-6, ...points.map((p) => p.y));
  const plotW = SC_W - SC_LEFT - SC_RIGHT;
  const plotH = SC_H - SC_TOP - SC_BOTTOM;
  const scaleX = (value: number) =>
    SC_LEFT + ((value - xMin) / (xMax - xMin)) * plotW;
  const scaleY = (value: number) => SC_TOP + plotH - (value / yMax) * plotH;
  const yTicks = buildAxisTicks(yMax).filter((tick) => tick <= yMax);
  const xTicks = [0, 1, 2, 3].map(
    (step) => xMinRaw + ((xMaxRaw - xMinRaw) * step) / 3,
  );

  const formatXTick = (value: number) => {
    if (indicator.logScale) return formatCompactPt(Math.round(10 ** value));
    if (indicator.id === "electorate") return formatCompactPt(Math.round(value));
    return `${decimalPt.format(value)}%`;
  };

  return (
    <div className="stats-panel">
      <div className="stats-panel__heading">
        <span>
          <ScatterChart size={14} aria-hidden /> Cruzamento com indicadores
        </span>
        <button
          type="button"
          className="stats-export"
          onClick={onExport}
          disabled={points.length === 0}
        >
          <Download size={14} aria-hidden /> CSV
        </button>
      </div>

      <p className="stats-note">
        Ela teve mais votos em cidades com mais mulheres? Mais alfabetizadas?
        Mais idosas? Cada ponto é um município: o eixo vertical é o % dos votos
        válidos da candidata ali; o horizontal, o indicador escolhido.
      </p>

      <label className="stats-indicator-control">
        <span>
          <Vote size={14} aria-hidden /> Indicador do eixo horizontal
        </span>
        <select
          value={indicatorId}
          onChange={(event) => onIndicator(event.target.value as StatsIndicatorId)}
        >
          {STATS_INDICATORS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
              {item.logScale ? " (escala log)" : ""}
            </option>
          ))}
        </select>
        <small>{indicator.description}</small>
      </label>

      {points.length === 0 ? (
        <p className="stats-note stats-note--warning">
          Nenhum município tem, ao mesmo tempo, % dos válidos apurado e este
          indicador — se os snapshots do eleitorado/Censo ainda são
          placeholders, rode <code>bash gerar_dados.sh</code>.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${SC_W} ${SC_H}`}
          role="img"
          aria-label={`Dispersão: % dos votos válidos por município × ${indicator.label}, ${points.length} municípios`}
        >
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={SC_LEFT}
                x2={SC_W - SC_RIGHT}
                y1={scaleY(tick)}
                y2={scaleY(tick)}
                className={tick === 0 ? "stats-chart-baseline" : "stats-chart-grid"}
              />
              <text
                x={SC_LEFT - 6}
                y={scaleY(tick) + 3}
                className="stats-chart-tick"
                textAnchor="end"
              >
                {formatPercent(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick, index) => (
            <text
              key={`x-${index}`}
              x={scaleX(tick)}
              y={SC_TOP + plotH + 16}
              className="stats-chart-tick"
              textAnchor="middle"
            >
              {formatXTick(tick)}
            </text>
          ))}
          <text
            x={SC_LEFT + plotW / 2}
            y={SC_H - 6}
            className="stats-chart-axis-title"
            textAnchor="middle"
          >
            {indicator.label}
            {indicator.logScale ? " — eixo em escala log10" : ""} →
          </text>
          {points.map((point) => (
            <g key={point.ibgeCode} className="stats-scatter-dot">
              <title>
                {`${point.nome} · ${formatPercent(point.y)} dos válidos · ${formatAnalysisMetricValue(indicator.id, point.indicadorValor)} · ${formatInteger(point.votos)} votos`}
              </title>
              {/* alvo de hover maior que a marca */}
              <circle cx={scaleX(point.x)} cy={scaleY(point.y)} r={9} fill="transparent" />
              <circle
                cx={scaleX(point.x)}
                cy={scaleY(point.y)}
                r={4}
                className="stats-scatter-mark"
              />
            </g>
          ))}
        </svg>
      )}

      <div className="stats-pearson">
        <Sigma size={14} aria-hidden />
        {scatter.amostraInsuficiente ? (
          <span>
            Correlação de Pearson: <strong>amostra insuficiente</strong> (
            {formatInteger(points.length)} municípios plotados; mínimo 10).
          </span>
        ) : scatter.pearson === null ? (
          <span>
            Correlação de Pearson: <strong>indefinida</strong> (sem variação em
            um dos eixos).
          </span>
        ) : (
          <span>
            Correlação de Pearson: <strong>r = {pearsonPt.format(scatter.pearson)}</strong>{" "}
            · {formatInteger(points.length)} municípios plotados
            {indicator.logScale ? " · calculada sobre o log10 do indicador" : ""}
            .
          </span>
        )}
      </div>
      {semDado > 0 && (
        <p className="stats-note">
          {formatInteger(semDado)} município{semDado > 1 ? "s" : ""} do pleito
          fora do gráfico:{" "}
          {scatter.semIndicador > 0 &&
            `${formatInteger(scatter.semIndicador)} sem dado do indicador`}
          {scatter.semIndicador > 0 && scatter.semPercentual > 0 && " · "}
          {scatter.semPercentual > 0 &&
            `${formatInteger(scatter.semPercentual)} sem % dos válidos apurado`}
          .
        </p>
      )}
      <p className="stats-note stats-note--warning">
        Leitura honesta: a correlação aqui é <strong>agregada por município</strong>{" "}
        e não diz nada sobre eleitores individuais — cidades com mais mulheres
        votarem mais nela não significa que mulheres votaram mais nela (falácia
        ecológica) — nem implica causa em nenhuma direção.
        {municipal &&
          " Neste pleito municipal, cada município é uma disputa diferente; o % dos válidos compara a força dela em disputas distintas."}
      </p>
    </div>
  );
}
