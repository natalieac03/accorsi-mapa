import {
  BarChart3,
  Download,
  FileSpreadsheet,
  FileText,
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
import socioeconomicJson from "../../data/socioeconomic-go.json";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateRankingMetricId,
  GrowthGroupId,
  ElectorateSource,
  StatsIndicatorId,
  StatsIndicatorSource,
} from "../../types/candidate";
import { ContestCards } from "../ContestCards";
import { GrowthView, MAX_RECORTES } from "./GrowthView";
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
  buildGrowthModel,
  buildScatter,
  buildStatsProfiles,
  getMunicipalScope,
  createGrowthCsv,
  createScatterCsv,
  createTrajectoryCsv,
  getGrowthCsvFilename,
  getScatterCsvFilename,
  getTrajectoryCsvFilename,
  groupContests,
  isMunicipalContest,
  PEARSON_MIN_N,
  STATS_INDICATORS,
} from "../../utils/candidateStats";
import { formatInteger, formatPercent } from "../../utils/electorate";
import { svgToReportImage } from "../../utils/chartImage";
import { exportReportAsExcel } from "../../utils/exportExcel";
import { exportReportAsPdf } from "../../utils/exportPdf";
import type {
  ReportDocument,
  ReportImage,
  ReportVariant,
} from "../../utils/reportModel";
import { buildReportDataset } from "../../utils/reportDataset";
import {
  buildContestReport,
  buildGrowthReport,
  buildTrajectoryReport,
} from "../../utils/reportStats";

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
/*
 * Os quatro snapshots territoriais. O socioeconômico entrou aqui junto com o
 * motor do relatório: sem ele, renda, PIB, densidade, saneamento,
 * escolarização e população ficavam de fora do PDF mesmo com o arquivo
 * gerado no disco — o perfil dos municípios era montado com todos esses
 * campos em null. Enquanto o arquivo for placeholder ("pendente"), o motor
 * simplesmente não oferece esses indicadores; nenhum deles entra zerado.
 */
const indicatorSource: StatsIndicatorSource = {
  electorate: electorateJson as unknown as StatsIndicatorSource["electorate"],
  age: ageStructureJson as unknown as StatsIndicatorSource["age"],
  literacy: literacyJson as unknown as StatsIndicatorSource["literacy"],
  socioeconomic:
    socioeconomicJson as unknown as StatsIndicatorSource["socioeconomic"],
};

const RANKING_SIZE = 15;

/*
 * Cores das duas categorias da trajetória (municipal × federal/estadual),
 * validadas com o validador da skill de dataviz sobre a superfície BRANCA
 * da janela: CVD ΔE 26,9 (deutan) e visão normal ΔE 33,7 — muito acima dos
 * pisos 8/15 — e ambas ≥ 3:1 de contraste sobre o branco. A identidade nunca
 * é só cor: o cargo está escrito sob cada barra e a legenda acompanha o
 * gráfico.
 */
const COR_MUNICIPAL = "#2a78d6";
const COR_FEDERAL = "#c1121f";

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

/**
 * Os formatos de entrega da barra de exportação.
 *
 * O PDF tem duas versões e elas convivem: a completa é o documento inteiro,
 * com um capítulo por indicador; a resumida é o mesmo dado em oito ou nove
 * páginas, para levar a uma reunião curta. Nenhuma substitui a outra, e o
 * arquivo gerado diz no nome e na capa qual delas é.
 */
type FormatoExport = "excel" | "pdfResumido" | "pdfCompleto";

const ROTULO_FORMATO: Record<FormatoExport, string> = {
  excel: "Excel",
  pdfResumido: "PDF resumido",
  pdfCompleto: "PDF completo",
};

export function StatsWindow({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<StatsView>("overview");
  const [rankingMetric, setRankingMetric] =
    useState<CandidateRankingMetricId>("votos");
  const [indicatorId, setIndicatorId] = useState<StatsIndicatorId>("female");
  const [exportMessage, setExportMessage] = useState("");
  /* Qual formato está sendo gerado agora: as bibliotecas de .xlsx e .pdf são
     carregadas por import dinâmico, então o primeiro clique tem uma espera
     real de rede e precisa aparecer no botão. O PDF tem DOIS botões, e o
     estado guarda qual deles está rodando: os dois demoram, e "Gerando…" no
     botão errado é pior do que nenhum aviso. */
  const [exportando, setExportando] = useState<FormatoExport | null>(null);
  /**
   * Anexo municipal do PDF — DESLIGADO por padrão, e é assim que ele tem de
   * chegar na mão de quem clica: o relatório é documento de leitura, e a base
   * municipal inteira já sai completa no Excel e no CSV. Quem precisa dela
   * impressa liga a opção aqui.
   *
   * A opção vale para a versão COMPLETA. Anexar centenas de linhas de tabela
   * a um resumo de oito páginas desmontaria a única coisa que a versão
   * resumida promete, que é caber numa leitura curta.
   */
  const [comAnexo, setComAnexo] = useState(false);
  const conteudoRef = useRef<HTMLDivElement | null>(null);
  /* Recortes comparados na visão Geral, guardados POR GRUPO: trocar de
     municipal para federal e voltar não deve perder a seleção anterior — e os
     ids de bairro e de município nem sequer são do mesmo universo. */
  const [recortes, setRecortes] = useState<Record<GrowthGroupId, string[]>>({
    municipais: [],
    federaisEstaduais: [],
  });
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

  const grupoGeral: GrowthGroupId | null =
    view === "geral:municipais"
      ? "municipais"
      : view === "geral:federaisEstaduais"
        ? "federaisEstaduais"
        : null;

  const contest =
    view === "overview" || grupoGeral
      ? null
      : (dataset.contests.find((item) => item.id === view) ?? null);

  const growth = useMemo(
    () =>
      grupoGeral ? buildGrowthModel(dataset, grupoGeral, recortes[grupoGeral]) : null,
    [grupoGeral, recortes],
  );

  const alternarRecorte = (id: string) => {
    if (!grupoGeral) return;
    setRecortes((atual) => {
      const lista = atual[grupoGeral];
      const proxima = lista.includes(id)
        ? lista.filter((item) => item !== id)
        : lista.length >= MAX_RECORTES
          ? lista
          : [...lista, id];
      return { ...atual, [grupoGeral]: proxima };
    });
  };

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

  /*
   * O universo COMPLETO do relatório, reconstruído do zero a partir do pleito
   * e dos snapshots. Repare que `indicatorId` e `rankingMetric` NÃO estão nas
   * dependências: o que está selecionado na tela não pode alterar uma linha
   * deste conjunto. Era exatamente esse o defeito antigo — o PDF herdava o
   * scatter de um indicador só e saía parcial com cara de completo.
   */
  const reportDataset = useMemo(
    () => (contest ? buildReportDataset({ contest, source: indicatorSource }) : null),
    [contest],
  );

  const anunciarExport = (linhas: number) =>
    setExportMessage(`${formatInteger(linhas)} linhas exportadas em CSV.`);

  /* Título do gráfico embutido no PDF, por visão. O texto alternativo do
     próprio SVG vira a legenda: ele já descreve o gráfico para leitor de tela
     e serve igualmente bem a quem lê o relatório impresso. */
  const tituloGrafico = grupoGeral
    ? "Votos por eleição"
    : contest
      ? "Cruzamento com indicadores municipais"
      : "Trajetória completa";

  /**
   * Monta o relatório do RECORTE VISÍVEL — o que estiver na tela é o que vai
   * para o arquivo. Nenhuma visão exporta dados de outra: quem está olhando um
   * pleito recebe aquele pleito, não a carreira inteira.
   */
  const montarRelatorio = async (
    comImagens: boolean,
    variante: ReportVariant,
  ): Promise<ReportDocument | null> => {
    const generatedAt = new Date();
    const images: ReportImage[] = [];
    // O relatório de um PLEITO não rasteriza mais o gráfico da tela: o PDF
    // desenha os seus próprios gráficos em vetor, com escala, legenda e
    // descrição textual. Rasterizar por cima disso só acrescentaria um PNG
    // redundante — e páginas em imagem, que era justamente o que se queria
    // evitar. As demais visões continuam levando o gráfico da tela.
    const rasterizar = comImagens && !(contest && reportDataset);
    if (rasterizar) {
      const graficos =
        conteudoRef.current?.querySelectorAll<SVGSVGElement>("svg.stats-chart") ??
        [];
      for (const grafico of graficos) {
        const imagem = await svgToReportImage(grafico, {
          title: tituloGrafico,
          caption: grafico.getAttribute("aria-label") ?? undefined,
        });
        if (imagem) images.push(imagem);
      }
    }
    if (grupoGeral && growth) {
      return buildGrowthReport({
        dataset,
        grupo: grupoGeral,
        model: growth,
        generatedAt,
        images,
      });
    }
    if (contest && reportDataset) {
      return buildContestReport({
        dataset,
        contest,
        reportDataset,
        // O filtro da tela chega ao relatório apenas como DESTAQUE: ele
        // decide a ordem dos capítulos e qual indicador ganha as tabelas de
        // detalhe. Todo indicador com dado entra no arquivo de qualquer jeito.
        activeViewFilter: { featuredIndicatorId: indicatorId },
        generatedAt,
        images,
        variante,
      });
    }
    return buildTrajectoryReport({
      dataset,
      overview,
      trajectory,
      generatedAt,
      images,
    });
  };

  const exportarRelatorio = async (formato: FormatoExport) => {
    if (exportando) return;
    const resumido = formato === "pdfResumido";
    setExportando(formato);
    setExportMessage(
      formato === "excel"
        ? "Gerando a pasta de trabalho…"
        : `Gerando o relatório em PDF (versão ${resumido ? "resumida" : "completa"})…`,
    );
    try {
      // O Excel não embute imagem (a planilha é para trabalhar os números);
      // rasterizar o gráfico à toa custaria segundos no clique.
      const relatorio = await montarRelatorio(
        formato !== "excel",
        resumido ? "resumido" : "completo",
      );
      if (!relatorio) {
        setExportMessage("Não há dados neste recorte para exportar.");
        return;
      }
      const gerado =
        formato === "excel"
          ? await exportReportAsExcel(relatorio)
          : await exportReportAsPdf(relatorio, {
              // O anexo municipal é da versão completa: a resumida existe
              // para caber numa leitura curta, e centenas de linhas de tabela
              // desmontariam exatamente isso.
              incluirAnexoMunicipal: comAnexo && !resumido,
            });
      setExportMessage(
        gerado
          ? formato === "excel"
            ? "Pasta de trabalho .xlsx baixada."
            : `Relatório em PDF baixado (versão ${resumido ? "resumida" : "completa"}).`
          : "Este recorte não tem nenhuma tabela com linhas para exportar.",
      );
    } catch {
      // Falha de rede no import dinâmico ou de memória na geração: a janela
      // segue viva e a pessoa sabe o que aconteceu.
      setExportMessage(
        "Não foi possível gerar o arquivo. Tente novamente em instantes.",
      );
    } finally {
      setExportando(null);
    }
  };

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
                {groups.municipais.length > 1 && (
                  <NavGeral
                    id="geral:municipais"
                    active={view === "geral:municipais"}
                    onSelect={setView}
                  />
                )}
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
                {groups.federaisEstaduais.length > 1 && (
                  <NavGeral
                    id="geral:federaisEstaduais"
                    active={view === "geral:federaisEstaduais"}
                    onSelect={setView}
                  />
                )}
              </>
            )}
          </nav>

          <div className="stats-content" ref={conteudoRef}>
            <BarraRelatorio
              exportando={exportando}
              onExportar={exportarRelatorio}
              comAnexo={comAnexo}
              onAlternarAnexo={setComAnexo}
            />
            {grupoGeral && growth ? (
              <GrowthView
                model={growth}
                selecionados={recortes[grupoGeral]}
                onToggle={alternarRecorte}
                onLimpar={() =>
                  setRecortes((atual) => ({ ...atual, [grupoGeral]: [] }))
                }
                onExport={() => {
                  downloadTextFile(
                    createGrowthCsv(growth),
                    getGrowthCsvFilename(dataset, grupoGeral),
                    "text/csv;charset=utf-8",
                  );
                  anunciarExport(
                    growth.series.reduce(
                      (soma, serie) => soma + serie.points.length,
                      0,
                    ),
                  );
                }}
              />
            ) : contest === null ? (
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

/**
 * Exportação do recorte visível em arquivo de entrega: planilha formatada e
 * relatório. O CSV continua onde sempre esteve — no cabeçalho de cada seção —
 * porque é outro público: quem vai cruzar os números em outra ferramenta.
 */
function BarraRelatorio({
  exportando,
  onExportar,
  comAnexo,
  onAlternarAnexo,
}: {
  exportando: FormatoExport | null;
  onExportar: (formato: FormatoExport) => void;
  comAnexo: boolean;
  onAlternarAnexo: (valor: boolean) => void;
}) {
  return (
    <div className="stats-report-bar">
      <p>
        <strong>Exportar este recorte</strong>
        <span>
          Planilha com capa de procedência, uma aba por conjunto e filtros
          prontos; relatório em PDF em duas versões — a resumida para levar a
          uma reunião curta, a completa com um capítulo por indicador. As duas
          saem do mesmo dado e trazem a tabela com todos os indicadores.
        </span>
      </p>
      <div className="stats-report-bar__actions">
        <label className="stats-report-option">
          <input
            type="checkbox"
            checked={comAnexo}
            onChange={(evento) => onAlternarAnexo(evento.target.checked)}
          />
          <span>
            Anexar a tabela municipal completa ao PDF
            <small>
              Só na versão completa. Desligado por padrão: a base inteira já sai
              no Excel e no CSV.
            </small>
          </span>
        </label>
        <button
          type="button"
          className="stats-report-button"
          onClick={() => onExportar("excel")}
          disabled={exportando !== null}
        >
          <FileSpreadsheet size={15} aria-hidden />
          {exportando === "excel" ? "Gerando…" : ROTULO_FORMATO.excel}
        </button>
        {/* Duas versões, dois botões — e não um botão com um seletor
            escondido: quem clica precisa ver, sem abrir nada, que existe uma
            resumida e uma completa, e o que cada uma é. O título de cada botão
            diz o tamanho aproximado para a escolha não depender de tentativa. */}
        <button
          type="button"
          className="stats-report-button stats-report-button--pdf"
          onClick={() => onExportar("pdfResumido")}
          disabled={exportando !== null}
          title="Versão de leitura curta: leituras principais, os cruzamentos de associação mais forte e a tabela com todos os indicadores."
        >
          <FileText size={15} aria-hidden />
          {exportando === "pdfResumido" ? "Gerando…" : ROTULO_FORMATO.pdfResumido}
        </button>
        <button
          type="button"
          className="stats-report-button stats-report-button--pdf"
          onClick={() => onExportar("pdfCompleto")}
          disabled={exportando !== null}
          title="Documento inteiro: um capítulo por indicador com dado, os quatro recortes do território, os rankings e a metodologia completa."
        >
          <FileText size={15} aria-hidden />
          {exportando === "pdfCompleto" ? "Gerando…" : ROTULO_FORMATO.pdfCompleto}
        </button>
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

/**
 * Fecha cada grupo da navegação: a leitura que atravessa TODAS as eleições
 * daquele universo, em vez de uma eleição por vez. Só aparece com dois pleitos
 * ou mais — com um só não existe crescimento para comparar.
 */
function NavGeral({
  id,
  active,
  onSelect,
}: {
  id: string;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? "stats-nav__item stats-nav__item--geral stats-nav__item--active"
          : "stats-nav__item stats-nav__item--geral"
      }
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(id)}
    >
      <strong>
        <TrendingUp size={13} aria-hidden /> Geral
      </strong>
      <span>crescimento entre as eleições</span>
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
        Um resumo da carreira inteira. Cada eleição é um universo próprio —
        eleitores, cargo e regras diferentes —, então os votos de pleitos
        distintos <strong>nunca são somados</strong> num total único: o que
        atravessa campanhas é comparação e contagem, não soma.
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
          className="stats-chart"
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
                  {/* resultadoLabel vem vazio quando não é para carimbar. */}
                  {`${point.electionYear} · ${point.officeName}${turno} · ${formatInteger(point.votos)} votos${point.resultadoLabel ? ` · ${point.resultadoLabel}` : ""} — clique para abrir o pleito`}
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
                {point.resultadoShort && (
                  <text
                    x={center}
                    y={TRAJ_TOP + plotH + 38}
                    className="stats-chart-office"
                    textAnchor="middle"
                  >
                    {point.resultadoShort}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <p className="stats-note">
          Cada barra é uma eleição disputada pela Dra. Adriana: a altura é o
          total de votos que ela recebeu naquele ano. Barras azuis são disputas
          de uma cidade só; vermelhas, do estado inteiro — universos diferentes,
          por isso as barras não se somam. Clique numa barra para abrir o
          pleito.
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
  const escopo = getMunicipalScope(contest);
  const metric = getCandidateRankingMetric(rankingMetric);
  const maxRanking = ranking.length > 0 ? ranking[0].value : 0;

  return (
    <section aria-label={`Dashboard do pleito ${getContestLabel(contest)}`}>
      <p className="stats-lede">
        <strong>{getContestLabel(contest)}</strong> ·{" "}
        {contest.candidatura.nomeUrna} · {contest.candidatura.partido}{" "}
        {contest.candidatura.numero}
      </p>

      <p className="stats-note stats-note--intro">
        {escopo
          ? `Prefeitura se disputa dentro de uma cidade só, então os cartões abaixo são de ${escopo.nome}: quantos votos ela fez ali, em que posição terminou entre as candidaturas da cidade e quanto isso representa dos votos válidos.`
          : "Os cartões resumem o pleito: quantos votos ela fez, em que posição terminou entre as candidaturas do cargo e quanto da votação veio das maiores cidades."}
      </p>

      <ContestCards
        contest={contest}
        className="stats-cards"
        cardClassName="stats-card"
      />

      {/* Ranking de municípios num pleito de uma cidade só seria uma tabela de
          UMA linha repetindo o cartão logo acima. Onde a disputa é municipal, o
          recorte que informa alguma coisa é o de bairros. */}
      {escopo ? (
        <div className="stats-panel">
          <div className="stats-panel__heading">
            <span>
              <ListOrdered size={14} aria-hidden /> Onde ela foi mais forte
            </span>
          </div>
          <p className="stats-note">
            Um ranking de municípios aqui teria uma linha só — {escopo.nome} —,
            porque a disputa foi inteira dentro da cidade. O recorte que mostra
            onde ela foi bem é o de <strong>bairros</strong>: veja em{" "}
            <strong>Geral</strong>, no fim deste grupo, para comparar o
            crescimento de cada bairro entre as eleições, ou na aba{" "}
            <strong>Accorsi</strong> do painel do mapa, para o retrato deste
            pleito.
          </p>
        </div>
      ) : (
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
      )}

      {/* Correlação entre municípios só faz sentido com cobertura estadual:
          um pleito de Prefeita de Goiânia tem UM município — não existe
          dispersão nem Pearson possível ali, e nada é fabricado no lugar. */}
      {municipal ? (
        <div className="stats-panel">
          <div className="stats-panel__heading">
            <span>
              <ScatterChart size={14} aria-hidden /> Cruzamento com indicadores
            </span>
          </div>
          <p className="stats-note">
            Esta disputa aconteceu em uma cidade só, então não existe
            comparação entre municípios para este pleito. Para ver onde a
            Dra. Adriana foi mais forte dentro da cidade, use o recorte por
            bairros na aba <strong>Accorsi</strong> do painel do mapa.
          </p>
        </div>
      ) : (
        scatter &&
        contest.municipiosComVoto >= PEARSON_MIN_N && (
          <ScatterSection
            scatter={scatter}
            indicatorId={indicatorId}
            onIndicator={onIndicator}
            onExport={onExportScatter}
          />
        )
      )}
    </section>
  );
}

/**
 * Tradução do coeficiente de Pearson para linguagem de campanha: a força em
 * palavras + a direção. O número exato continua ao lado — isto é legenda,
 * não substituto.
 */
function descreverPearson(r: number): string {
  const forca = Math.abs(r);
  const direcao =
    r >= 0
      ? "quanto maior o indicador, maior tende a ser o percentual dela"
      : "quanto maior o indicador, menor tende a ser o percentual dela";
  if (forca < 0.2) return "praticamente nada a ver uma coisa com a outra";
  if (forca < 0.5) return `relação fraca: ${direcao}, mas com muitas exceções`;
  if (forca < 0.8) return `relação moderada: ${direcao}`;
  return `relação forte: ${direcao}, na maioria das cidades`;
}

function ScatterSection({
  scatter,
  indicatorId,
  onIndicator,
  onExport,
}: {
  scatter: NonNullable<ReturnType<typeof buildScatter>>;
  indicatorId: StatsIndicatorId;
  onIndicator: (id: StatsIndicatorId) => void;
  onExport: () => void;
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
        Ela foi melhor em cidades com mais mulheres? Mais alfabetizadas? Mais
        idosas? Cada ponto é um município de Goiás: quanto mais para cima,
        maior o percentual dela na cidade; quanto mais para a direita, maior o
        indicador escolhido abaixo.
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
          className="stats-chart"
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

      {/* Legenda do gráfico: a contagem de municípios faz parte dela (nada
          de número solto flutuando no canto). */}
      {points.length > 0 && (
        <p className="stats-chart-caption">
          Cada ponto é um município de Goiás · {formatInteger(points.length)}{" "}
          municípios no gráfico
          {semDado > 0 &&
            ` · ${formatInteger(semDado)} fora por falta de dado (${[
              scatter.semIndicador > 0
                ? `${formatInteger(scatter.semIndicador)} sem o indicador`
                : "",
              scatter.semPercentual > 0
                ? `${formatInteger(scatter.semPercentual)} sem % dos válidos`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")})`}
          .
        </p>
      )}

      <div className="stats-pearson">
        <Sigma size={14} aria-hidden />
        {scatter.amostraInsuficiente ? (
          <span>
            Correlação: <strong>amostra insuficiente</strong> — só{" "}
            {formatInteger(points.length)} municípios no gráfico (mínimo{" "}
            {PEARSON_MIN_N}). Com poucos pontos o número viraria ruído.
          </span>
        ) : scatter.pearson === null ? (
          <span>
            Correlação: <strong>indefinida</strong> — um dos eixos não varia
            entre as cidades, então não há relação para medir.
          </span>
        ) : (
          <span>
            Correlação: <strong>r = {pearsonPt.format(scatter.pearson)}</strong>{" "}
            — {descreverPearson(scatter.pearson)}. O “r” vai de −1 a 1: quanto
            mais perto de 1 (ou de −1), mais as duas coisas andam juntas; perto
            de 0, nada a ver uma com a outra
            {indicator.logScale ? " (calculado sobre o log10 do indicador)" : ""}
            .
          </span>
        )}
      </div>
      <p className="stats-note stats-note--warning">
        Atenção na leitura: o gráfico compara <strong>cidades</strong>, não
        eleitores. Se cidades com mais mulheres votaram mais nela, isso NÃO
        prova que as mulheres votaram mais nela — e relação não é causa.
      </p>
    </div>
  );
}
