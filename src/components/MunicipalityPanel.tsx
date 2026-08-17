import {
  BadgeDollarSign,
  BarChart3,
  GitCompareArrows,
  LayoutDashboard,
  PanelRightOpen,
  ScanLine,
  Scale,
  School,
  Share2,
  TrendingUp,
  UsersRound,
  Vote,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTerritorialWorkspace } from "../hooks/useTerritorialWorkspace";
import { assinarAbrirAba } from "../utils/uiBus";
import type {
  MunicipalitySelection,
  TerritorialDataset,
} from "../types/electorate";
import type {
  MapLayerId,
  MunicipalitySelectionEvent,
  SelectionSource,
  SidebarTab,
} from "../types/workspace";
import type { SelectedTerritorialLocation } from "../types/search";
import type {
  CandidateLayerModel,
  CandidateLayerState,
  CandidateRankingMetricId,
} from "../types/candidate";
import type {
  AnalysisBand,
  AnalysisMetricId,
  AnalysisModel,
  AnalysisSortDirection,
  AnalysisState,
} from "../types/analysis";
import type {
  ElectionDataset,
  ElectionMetricId,
  ElectionModel,
  ElectionState,
} from "../types/elections";
import type {
  RegistrationCreateInput,
  RegistrationDataMode,
  RegistrationFollowUpStatus,
  RegistrationMetricId,
  RegistrationModel,
  RegistrationSource,
  RegistrationState,
  RegistrationWindow,
} from "../types/registrations";
import type {
  PollingDataStatus,
  PollingModel,
  PollingPlacesMetadata,
  PollingState,
  PollingViewMode,
} from "../types/pollingPlaces";
import type {
  PartySpectrumRegistry,
  SpectrumBandMode,
  SpectrumMetricId,
  SpectrumModel,
  SpectrumSourceContest,
  SpectrumState,
} from "../types/spectrum";
import { percentage } from "../utils/electorate";
import { MAX_COMPARISON_ITEMS } from "../utils/workspace";
import { MAX_TERRITORIAL_SELECTION } from "../utils/selection";
import { AnalysisPanel } from "./panel/AnalysisPanel";
import { ComparisonPanel } from "./panel/ComparisonPanel";
import { HistoryPanel } from "./panel/HistoryPanel";
import { OverviewPanel } from "./panel/OverviewPanel";
import { SelectionPanel } from "./panel/SelectionPanel";
import { ElectionHistoryPanel } from "./panel/ElectionHistoryPanel";
import { CampaignRegistrationsPanel } from "./panel/CampaignRegistrationsPanel";
import { CandidatePanel } from "./panel/CandidatePanel";
import { PaidMediaPanel } from "./panel/PaidMediaPanel";
import { SocialMediaPanel } from "./panel/SocialMediaPanel";
import { SpectrumPanel } from "./panel/SpectrumPanel";
import { PollingPlacesPanel } from "./panel/PollingPlacesPanel";
import type { MapExportShape } from "../utils/mapExport";

type MunicipalityPanelProps = {
  dataset: TerritorialDataset;
  selected: MunicipalitySelection | null;
  selectionEvent: MunicipalitySelectionEvent | null;
  analysisState: AnalysisState;
  analysisModel: AnalysisModel;
  analysisOpenRequest: number;
  electionDataset: ElectionDataset;
  electionState: ElectionState;
  /** null enquanto o histórico do TSE for placeholder ("pendente"). */
  electionModel: ElectionModel | null;
  electionOpenRequest: number;
  registrationState: RegistrationState;
  registrationModel: RegistrationModel;
  registrationMode: RegistrationDataMode;
  registrationLoading: boolean;
  registrationError: string | null;
  registrationLocalRecordCount: number;
  registrationOpenRequest: number;
  spectrumContests: SpectrumSourceContest[];
  spectrumRegistry: PartySpectrumRegistry;
  spectrumState: SpectrumState;
  spectrumModel: SpectrumModel;
  spectrumOpenRequest: number;
  pollingState: PollingState;
  pollingModel: PollingModel;
  pollingPlacesStatus: PollingDataStatus;
  pollingVotesStatus: PollingDataStatus;
  pollingPlacesMetadata: PollingPlacesMetadata | null;
  pollingOpenRequest: number;
  /** pleito e métrica da aba dela — o mesmo par que pinta a camada do mapa */
  candidateState: CandidateLayerState;
  /** null quando a trajetória ainda é placeholder: a camada não é oferecida */
  candidateModel: CandidateLayerModel | null;
  candidateOpenRequest: number;
  /** geometrias do map.data para o export em PNG; null enquanto o mapa não carregou */
  mapShapes: MapExportShape[] | null;
  selectionIds: string[];
  territorialLocation: SelectedTerritorialLocation | null;
  selectionMapMode: boolean;
  selectionOpenRequest: number;
  onAnalysisMetricChange: (metricId: AnalysisMetricId) => void;
  onAnalysisBandToggle: (band: AnalysisBand) => void;
  onAnalysisShowAllBands: () => void;
  onAnalysisSortChange: (direction: AnalysisSortDirection) => void;
  onAnalysisReset: () => void;
  onElectionContestChange: (contestId: string) => void;
  onElectionCandidateChange: (candidateId: string) => void;
  onElectionMetricChange: (metricId: ElectionMetricId) => void;
  onElectionComparisonContestChange: (contestId: string) => void;
  onElectionComparisonCandidateChange: (candidateId: string) => void;
  onElectionBandToggle: (band: AnalysisBand) => void;
  onElectionShowAllBands: () => void;
  onElectionSortChange: (direction: AnalysisSortDirection) => void;
  onElectionReset: () => void;
  onRegistrationMetricChange: (metricId: RegistrationMetricId) => void;
  onRegistrationWindowChange: (window: RegistrationWindow) => void;
  onRegistrationGeographyChange: (
    municipalityId: string | null,
    neighborhood?: string | null,
    cepPrefix?: string | null,
  ) => void;
  onRegistrationSourceToggle: (source: RegistrationSource) => void;
  onRegistrationStatusToggle: (status: RegistrationFollowUpStatus) => void;
  onRegistrationBandToggle: (band: AnalysisBand) => void;
  onRegistrationShowAllBands: () => void;
  onRegistrationSortChange: (direction: AnalysisSortDirection) => void;
  onRegistrationReset: () => void;
  onRegistrationAdd: (input: RegistrationCreateInput) => Promise<unknown>;
  onRegistrationImport: (inputs: RegistrationCreateInput[]) => Promise<number>;
  onRegistrationClearLocal: () => void;
  onRegistrationReload: () => void;
  onSpectrumContestChange: (contestId: string) => void;
  onSpectrumComparisonContestChange: (contestId: string | null) => void;
  onSpectrumMetricChange: (metricId: SpectrumMetricId) => void;
  onSpectrumBandModeChange: (bandMode: SpectrumBandMode) => void;
  onSpectrumBandToggle: (band: AnalysisBand) => void;
  onSpectrumShowAllBands: () => void;
  onSpectrumSortChange: (direction: AnalysisSortDirection) => void;
  onSpectrumReset: () => void;
  onPollingContestChange: (contestId: string) => void;
  onPollingViewModeChange: (viewMode: PollingViewMode) => void;
  onPollingPartyChange: (partyCode: string) => void;
  onPollingCandidateContestChange: (contestId: string | null) => void;
  onPollingCandidateRateChange: (rate: boolean) => void;
  onPollingMunicipalityChange: (municipalityId: string | null) => void;
  onPollingBandToggle: (band: AnalysisBand) => void;
  onPollingShowAllBands: () => void;
  onPollingSortChange: (direction: AnalysisSortDirection) => void;
  onPollingReset: () => void;
  onCandidateContestChange: (contestId: string) => void;
  onCandidateMetricChange: (metricId: CandidateRankingMetricId) => void;
  onMapLayerChange: (layer: MapLayerId) => void;
  onSelectionSetMapMode: (active: boolean) => void;
  onSelectionToggleId: (id: string) => void;
  onSelectionAddIds: (ids: string[]) => void;
  onSelectionRemoveId: (id: string) => void;
  onSelectionClear: () => void;
  onReset: () => void;
  onSelectMunicipality: (
    id: string,
    source?:
      | "workspace"
      | "analysis"
      | "election"
      | "registration"
      | "spectrum"
      | "polling"
      | "selection",
  ) => void;
};

type SidebarTabDefinition = {
  id: SidebarTab;
  label: string;
  icon: typeof LayoutDashboard;
};

// Abas exibidas na fileira principal da barra do painel.
const tabs: SidebarTabDefinition[] = [
  { id: "overview", label: "Resumo", icon: LayoutDashboard },
  { id: "analysis", label: "Análise", icon: BarChart3 },
  { id: "elections", label: "Eleições", icon: Vote },
  { id: "candidate", label: "Accorsi", icon: TrendingUp },
  { id: "registrations", label: "Cadastros", icon: UsersRound },
  // Anúncios e Redes ficam junto de Cadastros porque são as três abas de
  // operação da campanha; as duas ainda não têm dado e dizem isso na cara.
  { id: "ads", label: "Anúncios", icon: BadgeDollarSign },
  { id: "social", label: "Redes", icon: Share2 },
  { id: "spectrum", label: "Espectro", icon: Scale },
  { id: "polling", label: "Locais", icon: School },
  { id: "selection", label: "Seleção", icon: ScanLine },
  { id: "compare", label: "Comparar", icon: GitCompareArrows },
];

// A aba "history" não tem botão na fileira do painel: ela é aberta pelo menu
// "três linhas" do cabeçalho (ao lado da marca), que chega aqui pelo uiBus.

// Fontes de seleção que representam ação direta no mapa ou na busca. Só elas
// contam para a adição automática à comparação: fontes vindas de listas dos
// próprios painéis (workspace, analysis, selection…) trocam de aba de
// propósito e não devem ser interceptadas. "registration" e "polling" entram
// porque o clique no mapa usa essas fontes quando essas camadas estão ativas.
/**
 * Abas que trazem a PRÓPRIA camada para o mapa ao serem abertas. Serve para
 * saber quando sair da aba dela deve devolver o mapa à camada padrão: indo
 * para uma destas, quem manda é a camada da aba de destino.
 */
const TABS_COM_CAMADA: ReadonlySet<SidebarTab> = new Set([
  "analysis",
  "elections",
  "registrations",
  "spectrum",
  "polling",
  "candidate",
]);

const MAP_OR_SEARCH_SOURCES: ReadonlySet<SelectionSource> = new Set([
  "map",
  "municipality",
  "cep",
  "place",
  "registration",
  "polling",
]);

export function MunicipalityPanel({
  dataset,
  selected,
  selectionEvent,
  analysisState,
  analysisModel,
  analysisOpenRequest,
  electionDataset,
  electionState,
  electionModel,
  electionOpenRequest,
  registrationState,
  registrationModel,
  registrationMode,
  registrationLoading,
  registrationError,
  registrationLocalRecordCount,
  registrationOpenRequest,
  spectrumContests,
  spectrumRegistry,
  spectrumState,
  spectrumModel,
  spectrumOpenRequest,
  pollingState,
  pollingModel,
  pollingPlacesStatus,
  pollingVotesStatus,
  pollingPlacesMetadata,
  pollingOpenRequest,
  candidateState,
  candidateModel,
  candidateOpenRequest,
  mapShapes,
  selectionIds,
  territorialLocation,
  selectionMapMode,
  selectionOpenRequest,
  onAnalysisMetricChange,
  onAnalysisBandToggle,
  onAnalysisShowAllBands,
  onAnalysisSortChange,
  onAnalysisReset,
  onElectionContestChange,
  onElectionCandidateChange,
  onElectionMetricChange,
  onElectionComparisonContestChange,
  onElectionComparisonCandidateChange,
  onElectionBandToggle,
  onElectionShowAllBands,
  onElectionSortChange,
  onElectionReset,
  onRegistrationMetricChange,
  onRegistrationWindowChange,
  onRegistrationGeographyChange,
  onRegistrationSourceToggle,
  onRegistrationStatusToggle,
  onRegistrationBandToggle,
  onRegistrationShowAllBands,
  onRegistrationSortChange,
  onRegistrationReset,
  onRegistrationAdd,
  onRegistrationImport,
  onRegistrationClearLocal,
  onRegistrationReload,
  onSpectrumContestChange,
  onSpectrumComparisonContestChange,
  onSpectrumMetricChange,
  onSpectrumBandModeChange,
  onSpectrumBandToggle,
  onSpectrumShowAllBands,
  onSpectrumSortChange,
  onSpectrumReset,
  onPollingContestChange,
  onPollingViewModeChange,
  onPollingPartyChange,
  onPollingCandidateContestChange,
  onPollingCandidateRateChange,
  onPollingMunicipalityChange,
  onPollingBandToggle,
  onPollingShowAllBands,
  onPollingSortChange,
  onPollingReset,
  onCandidateContestChange,
  onCandidateMetricChange,
  onMapLayerChange,
  onSelectionSetMapMode,
  onSelectionToggleId,
  onSelectionAddIds,
  onSelectionRemoveId,
  onSelectionClear,
  onReset,
  onSelectMunicipality,
}: MunicipalityPanelProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  // Histórico do TSE ainda não gerado: a aba continua acessível (é onde a
  // pessoa lê o porquê e o que rodar), mas não pede a camada de eleições ao
  // mapa — camada sem dado não é camada.
  const electionsPendente = electionModel === null;
  // Trajetória ainda não gerada: a aba dela continua acessível (é onde a
  // pessoa lê o que rodar), mas não pede a camada dela ao mapa.
  const candidatePendente = candidateModel === null;
  // Nonce > 0 exibe o aviso de limite da comparação; cada tentativa reinicia
  // o cronômetro de ocultação (por isso um contador, não um booleano).
  const [compareLimitNotice, setCompareLimitNotice] = useState(0);
  const handledSelectionSequenceRef = useRef(0);
  // Última seleção já considerada pela aba de comparação. Fica sincronizada
  // enquanto a aba está fechada para nunca adicionar retroativamente o
  // município que já estava selecionado quando a pessoa abriu a aba.
  const compareHandledSequenceRef = useRef(0);
  const validIds = useMemo(
    () => new Set(Object.keys(dataset.municipalities)),
    [dataset.municipalities],
  );
  const workspace = useTerritorialWorkspace(validIds);
  const recordVisit = workspace.recordVisit;
  const municipalityValues = useMemo(
    () => Object.values(dataset.municipalities),
    [dataset.municipalities],
  );
  const stateBiometricsPct = useMemo(
    () =>
      percentage(
        municipalityValues.reduce(
          (total, municipality) => total + municipality.biometrics,
          0,
        ),
        dataset.metadata.stateElectorate,
      ),
    [dataset.metadata.stateElectorate, municipalityValues],
  );
  const comparisonMunicipalities = workspace.comparison
    .map((id) => dataset.municipalities[id])
    .filter(Boolean);
  const selectedId = selected?.id ?? null;
  const isFavorite = selectedId
    ? workspace.favorites.includes(selectedId)
    : false;
  const isCompared = selectedId
    ? workspace.comparison.includes(selectedId)
    : false;
  const comparisonFull =
    workspace.comparison.length >= MAX_COMPARISON_ITEMS;
  const selectionFull =
    selectionIds.length >= MAX_TERRITORIAL_SELECTION;
  const isInSelection = selectedId
    ? selectionIds.includes(selectedId)
    : false;

  useEffect(() => {
    if (
      !selectionEvent ||
      selectionEvent.sequence === handledSelectionSequenceRef.current
    ) {
      return;
    }

    handledSelectionSequenceRef.current = selectionEvent.sequence;
    recordVisit(selectionEvent);
    // Com a aba de comparação aberta, cliques no mapa e buscas não trocam de
    // aba: o município é adicionado à comparação pelo efeito dedicado abaixo.
    if (activeTab === "compare" && MAP_OR_SEARCH_SOURCES.has(selectionEvent.source)) {
      setMobileOpen(true);
      return;
    }
    setActiveTab(
      selectionEvent.source === "election"
        ? "elections"
        : selectionEvent.source === "registration"
          ? "registrations"
          : selectionEvent.source === "spectrum"
            ? "spectrum"
            : selectionEvent.source === "polling"
              ? "polling"
              : "overview",
    );
    setMobileOpen(true);
  }, [activeTab, recordVisit, selectionEvent]);

  const addToComparison = workspace.addToComparison;
  const comparisonIds = workspace.comparison;

  useEffect(() => {
    const sequence = selectionEvent?.sequence ?? 0;
    if (activeTab !== "compare") {
      // Fora da aba, só mantém o ponteiro em dia: eventos anteriores à
      // abertura da aba nunca são reprocessados (proteção contra o mount e
      // contra idas e voltas entre abas).
      compareHandledSequenceRef.current = sequence;
      return;
    }
    if (!selectionEvent || sequence === compareHandledSequenceRef.current) {
      return;
    }
    compareHandledSequenceRef.current = sequence;
    if (!MAP_OR_SEARCH_SOURCES.has(selectionEvent.source)) return;
    // Não duplica: quem já está na comparação é ignorado em silêncio.
    if (comparisonIds.includes(selectionEvent.id)) return;
    if (comparisonIds.length >= MAX_COMPARISON_ITEMS) {
      // Cheio: em vez de adicionar, mostra um aviso discreto por alguns
      // segundos dentro do painel de comparação.
      setCompareLimitNotice((nonce) => nonce + 1);
      return;
    }
    addToComparison(selectionEvent.id);
  }, [activeTab, addToComparison, comparisonIds, selectionEvent]);

  useEffect(() => {
    if (compareLimitNotice === 0) return;
    // O aviso de limite some sozinho depois de alguns segundos.
    const timer = window.setTimeout(() => setCompareLimitNotice(0), 6000);
    return () => window.clearTimeout(timer);
  }, [compareLimitNotice]);

  useEffect(() => {
    if (analysisOpenRequest <= 0) return;
    setActiveTab("analysis");
    setMobileOpen(true);
  }, [analysisOpenRequest]);

  useEffect(() => {
    if (electionOpenRequest <= 0) return;
    setActiveTab("elections");
    setMobileOpen(true);
  }, [electionOpenRequest]);

  useEffect(() => {
    if (registrationOpenRequest <= 0) return;
    setActiveTab("registrations");
    setMobileOpen(true);
  }, [registrationOpenRequest]);

  useEffect(() => {
    if (spectrumOpenRequest <= 0) return;
    setActiveTab("spectrum");
    setMobileOpen(true);
  }, [spectrumOpenRequest]);

  useEffect(() => {
    if (pollingOpenRequest <= 0) return;
    setActiveTab("polling");
    setMobileOpen(true);
  }, [pollingOpenRequest]);

  useEffect(() => {
    if (candidateOpenRequest <= 0) return;
    setActiveTab("candidate");
    setMobileOpen(true);
  }, [candidateOpenRequest]);

  useEffect(() => {
    if (selectionOpenRequest <= 0) return;
    setActiveTab("selection");
    setMobileOpen(true);
  }, [selectionOpenRequest]);

  // Pedidos do menu "três linhas" do cabeçalho chegam por aqui. openTabRef
  // evita reassinar o bus a cada render (openTab é recriada sempre).
  const openTabRef = useRef<(tab: SidebarTab) => void>(() => {});
  useEffect(() => assinarAbrirAba((aba) => openTabRef.current(aba)), []);

  const openTab = (tab: SidebarTab) => {
    if (tab === "analysis") onMapLayerChange("analysis");
    if (tab === "elections" && !electionsPendente) onMapLayerChange("election");
    if (tab === "registrations") onMapLayerChange("registration");
    if (tab === "spectrum") onMapLayerChange("spectrum");
    if (tab === "polling") onMapLayerChange("polling");
    // Abrir a aba dela pinta o mapa pelo desempenho dela, no pleito e na
    // métrica escolhidos aqui. Com a trajetória pendente o MunicipalityLayer
    // rebaixa o pedido para a camada padrão — camada sem dado não é camada.
    // A aba de eleições com o histórico pendente não traz camada nenhuma:
    // para efeito de saída da aba dela, conta como aba sem camada.
    const destinoTemCamada =
      TABS_COM_CAMADA.has(tab) && !(tab === "elections" && electionsPendente);
    if (tab === "candidate") {
      onMapLayerChange("candidato");
    } else if (activeTab === "candidate" && !destinoTemCamada) {
      // Sair da aba dela POR ESCOLHA devolve o mapa à camada padrão: a camada
      // dela vive presa aos controles do painel dela. Trocas de aba causadas
      // por clique no mapa não passam por aqui de propósito — abrir um
      // município não pode apagar a camada que a pessoa acabou de pedir.
      onMapLayerChange("analysis");
    }
    setActiveTab(tab);
    setMobileOpen(true);
  };
  openTabRef.current = openTab;

  const selectFromWorkspace = (id: string) => {
    setActiveTab("overview");
    setMobileOpen(true);
    onSelectMunicipality(id, "workspace");
  };

  const selectFromAnalysis = (id: string) => {
    setActiveTab("overview");
    setMobileOpen(true);
    onSelectMunicipality(id, "analysis");
  };

  const selectFromSelection = (id: string) => {
    setActiveTab("overview");
    setMobileOpen(true);
    onSelectMunicipality(id, "selection");
  };

  const selectFromElection = (id: string) => {
    setActiveTab("elections");
    setMobileOpen(true);
    onSelectMunicipality(id, "election");
  };

  const selectFromRegistration = (id: string) => {
    setActiveTab("registrations");
    setMobileOpen(true);
    onSelectMunicipality(id, "registration");
  };

  const selectFromSpectrum = (id: string) => {
    setActiveTab("spectrum");
    setMobileOpen(true);
    onSelectMunicipality(id, "spectrum");
  };

  const selectFromPolling = (id: string) => {
    setActiveTab("polling");
    setMobileOpen(true);
    onSelectMunicipality(id, "polling");
  };

  const handleClose = () => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      setMobileOpen(false);
      return;
    }

    setActiveTab("overview");
    onReset();
  };

  const handleReset = () => {
    setActiveTab("overview");
    setMobileOpen(false);
    onReset();
  };

  // Badge de contagem de cada aba, compartilhado entre a fileira principal e
  // os itens do menu hambúrguer (o item "Histórico e salvos" mantém o mesmo
  // badge que a aba Histórico tinha).
  const tabBadgeCount = (tabId: SidebarTab) =>
    tabId === "compare"
      ? workspace.comparison.length
      : tabId === "selection"
        ? selectionIds.length
        : tabId === "history"
          ? workspace.history.length
          : tabId === "registrations"
            ? registrationModel.coveredMunicipalityCount
            : 0;

  // O hambúrguer herda o estilo "ativo" quando a aba aberta vive dentro dele.

  return (
    <>
      <aside
        className={[
          "municipality-panel",
          selected ? "municipality-panel--open" : "",
          mobileOpen ? "municipality-panel--mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Painel territorial"
      >
        <div className="sidebar-toolbar">
          <div className="sidebar-tabs" role="tablist" aria-label="Painel lateral">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const count = tabBadgeCount(tab.id);

              return (
                <button
                  id={`sidebar-${tab.id}-tab`}
                  className={activeTab === tab.id ? "sidebar-tab--active" : ""}
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`sidebar-${tab.id}-panel`}
                  title={
                    tab.id === "elections" && electionsPendente
                      ? "Histórico do TSE ainda não gerado — rode bash gerar_dados.sh"
                    : tab.id === "candidate" && candidatePendente
                      ? "Trajetória da candidata ainda não gerada — rode bash gerar_dados.sh"
                      : undefined
                  }
                  onClick={() => openTab(tab.id)}
                >
                  <Icon size={15} />
                  <span>{tab.label}</span>
                  {count > 0 && <small>{count}</small>}
                </button>
              );
            })}

          </div>

          {(selected || activeTab !== "overview" || mobileOpen) && (
            <button
              className="panel-close"
              type="button"
              onClick={handleClose}
              aria-label="Fechar painel lateral"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {activeTab === "overview" && (
          <OverviewPanel
            metadata={dataset.metadata}
            socioeconomicMetadata={dataset.socioeconomicMetadata}
            selected={selected}
            territorialLocation={territorialLocation}
            stateBiometricsPct={stateBiometricsPct}
            favoritesCount={workspace.favorites.length}
            historyCount={workspace.history.length}
            comparisonCount={workspace.comparison.length}
            selectionCount={selectionIds.length}
            isFavorite={isFavorite}
            isCompared={isCompared}
            isInSelection={isInSelection}
            comparisonFull={comparisonFull}
            selectionFull={selectionFull}
            onToggleFavorite={() => {
              if (selectedId) workspace.toggleFavorite(selectedId);
            }}
            onAddToComparison={() => {
              if (selectedId) workspace.addToComparison(selectedId);
            }}
            onOpenComparison={() => openTab("compare")}
            onOpenHistory={() => openTab("history")}
            onToggleSelection={() => {
              if (selectedId) onSelectionToggleId(selectedId);
            }}
            onOpenSelection={() => openTab("selection")}
            onReset={handleReset}
          />
        )}

        {activeTab === "compare" && (
          <ComparisonPanel
            municipalities={comparisonMunicipalities}
            limitNoticeVisible={compareLimitNotice > 0}
            onSelect={selectFromWorkspace}
            onRemove={workspace.removeFromComparison}
            onClear={workspace.clearComparison}
            onBackToOverview={() => openTab("overview")}
          />
        )}

        {activeTab === "analysis" && (
          <AnalysisPanel
            model={analysisModel}
            state={analysisState}
            mapShapes={mapShapes}
            municipalityCount={dataset.metadata.municipalityCount}
            onMetricChange={onAnalysisMetricChange}
            onToggleBand={onAnalysisBandToggle}
            onShowAllBands={onAnalysisShowAllBands}
            onSortChange={onAnalysisSortChange}
            onReset={onAnalysisReset}
            onSelect={selectFromAnalysis}
          />
        )}

        {activeTab === "elections" && (
          <ElectionHistoryPanel
            dataset={electionDataset}
            model={electionModel}
            state={electionState}
            mapShapes={mapShapes}
            selectedMunicipalityId={selectedId}
            onContestChange={onElectionContestChange}
            onCandidateChange={onElectionCandidateChange}
            onMetricChange={onElectionMetricChange}
            onComparisonContestChange={onElectionComparisonContestChange}
            onComparisonCandidateChange={onElectionComparisonCandidateChange}
            onToggleBand={onElectionBandToggle}
            onShowAllBands={onElectionShowAllBands}
            onSortChange={onElectionSortChange}
            onReset={onElectionReset}
            onSelect={selectFromElection}
          />
        )}

        {activeTab === "candidate" && (
          <CandidatePanel
            state={candidateState}
            layerModel={candidateModel}
            onContestChange={onCandidateContestChange}
            onMetricChange={onCandidateMetricChange}
          />
        )}

        {/* Anúncios e Redes não pedem camada ao mapa nem recebem props: são
            módulos ainda sem fonte de dado, e o painel só explica isso. */}
        {activeTab === "ads" && <PaidMediaPanel />}

        {activeTab === "social" && <SocialMediaPanel />}

        {activeTab === "registrations" && (
          <CampaignRegistrationsPanel
            model={registrationModel}
            state={registrationState}
            mode={registrationMode}
            loading={registrationLoading}
            error={registrationError}
            localRecordCount={registrationLocalRecordCount}
            municipalityById={dataset.municipalities}
            selectedMunicipalityId={selectedId}
            onMetricChange={onRegistrationMetricChange}
            onWindowChange={onRegistrationWindowChange}
            onGeographyChange={onRegistrationGeographyChange}
            onToggleSource={onRegistrationSourceToggle}
            onToggleStatus={onRegistrationStatusToggle}
            onToggleBand={onRegistrationBandToggle}
            onShowAllBands={onRegistrationShowAllBands}
            onSortChange={onRegistrationSortChange}
            onReset={onRegistrationReset}
            onSelect={selectFromRegistration}
            onAdd={onRegistrationAdd}
            onImport={onRegistrationImport}
            onClearLocal={onRegistrationClearLocal}
            onReload={onRegistrationReload}
          />
        )}

        {activeTab === "spectrum" && (
          <SpectrumPanel
            contests={spectrumContests}
            registry={spectrumRegistry}
            model={spectrumModel}
            state={spectrumState}
            mapShapes={mapShapes}
            selectedMunicipalityId={selectedId}
            onContestChange={onSpectrumContestChange}
            onComparisonContestChange={onSpectrumComparisonContestChange}
            onMetricChange={onSpectrumMetricChange}
            onBandModeChange={onSpectrumBandModeChange}
            onToggleBand={onSpectrumBandToggle}
            onShowAllBands={onSpectrumShowAllBands}
            onSortChange={onSpectrumSortChange}
            onReset={onSpectrumReset}
            onSelect={selectFromSpectrum}
          />
        )}

        {activeTab === "polling" && (
          <PollingPlacesPanel
            contests={spectrumContests}
            registry={spectrumRegistry}
            model={pollingModel}
            state={pollingState}
            placesStatus={pollingPlacesStatus}
            votesStatus={pollingVotesStatus}
            placesMetadata={pollingPlacesMetadata}
            mapShapes={mapShapes}
            selectedMunicipalityId={selectedId}
            onContestChange={onPollingContestChange}
            onViewModeChange={onPollingViewModeChange}
            onPartyChange={onPollingPartyChange}
            onCandidateContestChange={onPollingCandidateContestChange}
            onCandidateRateChange={onPollingCandidateRateChange}
            onMunicipalityChange={onPollingMunicipalityChange}
            onToggleBand={onPollingBandToggle}
            onShowAllBands={onPollingShowAllBands}
            onSortChange={onPollingSortChange}
            onReset={onPollingReset}
            onSelect={selectFromPolling}
          />
        )}

        {activeTab === "selection" && (
          <SelectionPanel
            municipalityById={dataset.municipalities}
            selectionIds={selectionIds}
            favoriteIds={workspace.favorites}
            stateElectorate={dataset.metadata.stateElectorate}
            year={dataset.metadata.year}
            analysisModel={analysisModel}
            analysisState={analysisState}
            mapMode={selectionMapMode}
            onSetMapMode={onSelectionSetMapMode}
            onSelect={selectFromSelection}
            onRemove={onSelectionRemoveId}
            onAddIds={onSelectionAddIds}
            onClear={onSelectionClear}
          />
        )}

        {activeTab === "history" && (
          <HistoryPanel
            municipalityById={dataset.municipalities}
            history={workspace.history}
            favorites={workspace.favorites}
            comparison={workspace.comparison}
            comparisonFull={comparisonFull}
            onSelect={selectFromWorkspace}
            onToggleFavorite={workspace.toggleFavorite}
            onAddToComparison={workspace.addToComparison}
            onOpenComparison={() => openTab("compare")}
            onClearHistory={workspace.clearHistory}
          />
        )}
      </aside>

      {!mobileOpen && (
        <button
          className="mobile-workspace-trigger"
          type="button"
          onClick={() => openTab("history")}
        >
          <PanelRightOpen size={17} />
          Territórios
          {workspace.history.length > 0 && (
            <span>{workspace.history.length}</span>
          )}
        </button>
      )}
    </>
  );
}
