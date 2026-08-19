import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import {
  AlertTriangle,
  Database,
  LoaderCircle,
  MapPin,
  MousePointer2,
  ScanLine,
  X,
} from "lucide-react";
import ageStructureJson from "../data/age-structure-go.json";
import candidatoJson from "../data/candidato/adriana-accorsi.json";
import electorateJson from "../data/electorate-go.json";
import electionHistoryJson from "../data/election-history-go.json";
import literacyJson from "../data/literacy-go.json";
import partySpectrumJson from "../data/party-spectrum.json";
import partyVotesJson from "../data/party-votes-go.json";
import socioeconomicJson from "../data/socioeconomic-go.json";
import {
  CENTRO_DO_ESTADO,
  MUNICIPAL_MESH_URL,
  MUNICIPALITIES_URL,
} from "../config/map";
import type {
  ElectorateDataset,
  MunicipalitySelection,
} from "../types/electorate";
import type { AgeStructureDataset } from "../types/ageStructure";
import type {
  CandidateDataset,
  ElectorateSource,
} from "../types/candidate";
import type { LiteracyDataset } from "../types/literacy";
import type { SocioeconomicDataset } from "../types/socioeconomic";
import type { ElectionDataset } from "../types/elections";
import type { PartySpectrumRegistry } from "../types/spectrum";
import type {
  MunicipalitySearchOption,
  PlaceSearchResolution,
  PlaceSearchTarget,
  SearchMarker,
  SelectedTerritorialLocation,
} from "../types/search";
import type {
  MapLayerId,
  MunicipalitySelectionEvent,
  SelectionSource,
} from "../types/workspace";
import { useTerritorialAnalysis } from "../hooks/useTerritorialAnalysis";
import { useElectionHistory } from "../hooks/useElectionHistory";
import { useCampaignRegistrations } from "../hooks/useCampaignRegistrations";
import { useRegistrationAnalysis } from "../hooks/useRegistrationAnalysis";
import { usePollingPlaces } from "../hooks/usePollingPlaces";
import { useSpectrumAnalysis } from "../hooks/useSpectrumAnalysis";
import { useTerritorialSelection } from "../hooks/useTerritorialSelection";
import { useCandidateLayer } from "../hooks/useCandidateLayer";
import {
  ALL_ANALYSIS_BANDS,
  buildAnalysisModel,
  formatAnalysisMetricValue,
  getAnalysisBand,
  getAnalysisMetricValue,
} from "../utils/analysis";
import {
  ELECTORATE_COLORS,
  MISSING_DATA_COLOR,
} from "../utils/electorate";
import {
  buildElectorateIndex,
  isCandidatePendente,
} from "../utils/candidate";
import {
  buildCandidateLayerModel,
  CANDIDATE_LAYER_COLORS,
  describeCandidateLayer,
  describeCandidateLayerItem,
  getCandidateLayerShortLabel,
} from "../utils/candidateLayer";
import {
  buildPollingModel,
  formatPollingValue,
  getPollingMetricColors,
  getPollingMetricShortLabel,
} from "../utils/pollingPlaces";
import {
  BASE_MUNICIPALITY_STYLE_FLAGS,
  buildMunicipalityStyle,
  type MunicipalityStyleFlags,
  type MunicipalityStyleInputs,
} from "../utils/mapStyle";
import { parseSharedWorkspaceUrl } from "../utils/selection";
import { buildTerritorialDataset } from "../utils/socioeconomic";
import {
  buildElectionModel,
  formatElectionMetricValue,
  isElectionDatasetPendente,
} from "../utils/elections";
import {
  buildRegistrationModel,
  formatRegistrationMetricValue,
} from "../utils/registrations";
import type { MapExportShape } from "../utils/mapExport";
import {
  buildPartySpectrumIndex,
  buildSpectrumContests,
  buildSpectrumModel,
  formatSpectrumValue,
  getSpectrumMetricColors,
  type PartyVotesDataset,
} from "../utils/spectrum";
import { CandidateLegend } from "./CandidateLegend";
import { ElectorateLegend } from "./ElectorateLegend";
import { ElectionLegend } from "./ElectionLegend";
import { MunicipalityPanel } from "./MunicipalityPanel";
import { PollingLegend } from "./PollingLegend";
import { RegistrationLegend } from "./RegistrationLegend";
import { SpectrumLegend } from "./SpectrumLegend";
import { loadPollingPlaces, loadPollingVotes } from "../utils/pollingData";
import { DataAgentChat } from "./DataAgentChat";
import { TerritorialSearch } from "./TerritorialSearch";

const electorateData = buildTerritorialDataset(
  electorateJson as ElectorateDataset,
  socioeconomicJson as SocioeconomicDataset,
  ageStructureJson as AgeStructureDataset,
  literacyJson as LiteracyDataset,
);
const electionData = electionHistoryJson as unknown as ElectionDataset;
// Trajetória dela e o índice de eleitorado usado como denominador na camada
// "candidato". O índice é null enquanto o snapshot for placeholder, e null
// desliga a métrica de taxa inteira em vez de deixar 246 municípios sem valor.
const candidateData = candidatoJson as unknown as CandidateDataset;
const candidateElectorateIndex = buildElectorateIndex(
  electorateJson as unknown as ElectorateSource,
);
// Trajetória não gerada: a camada dela não é oferecida e o pedido cai na
// camada padrão. Mesma checagem que o painel usa, para não discordarem.
const candidatePendente = isCandidatePendente(candidateData);
// Histórico do TSE não gerado: a camada de eleições fica indisponível (sem
// legenda, sem pintura, sem virar ativa). O resto do app segue funcionando.
const electionPendente = isElectionDatasetPendente(electionData);
const spectrumRegistry = partySpectrumJson as unknown as PartySpectrumRegistry;
const spectrumIndex = buildPartySpectrumIndex(spectrumRegistry);
const spectrumContests = buildSpectrumContests(
  electionData,
  partyVotesJson as unknown as PartyVotesDataset,
  spectrumRegistry,
);
const validMunicipalityIds = new Set(
  Object.keys(electorateData.municipalities),
);
const municipalitySearchOptions: MunicipalitySearchOption[] = Object.values(
  electorateData.municipalities,
)
  .map((municipality) => ({
    id: municipality.ibgeCode,
    name: municipality.name,
    electorate: municipality.electorate,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
const municipalitySearchById = new Map(
  municipalitySearchOptions.map((municipality) => [
    municipality.id,
    municipality,
  ]),
);

type MunicipalityApiItem = {
  id: number;
  nome: string;
};

type GeoJsonFeature = {
  id?: string | number;
  properties?: Record<string, unknown>;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

function getFeatureCode(feature: google.maps.Data.Feature) {
  return String(
    feature.getProperty("codigo") ??
      feature.getProperty("codarea") ??
      feature.getId() ??
      "",
  );
}

function getMunicipality(
  feature: google.maps.Data.Feature,
): MunicipalitySelection {
  const id = getFeatureCode(feature);
  const metrics = electorateData.municipalities[id] ?? null;
  const name = String(
    feature.getProperty("nome") ?? metrics?.name ?? `Município ${id}`,
  );

  return { id, name, metrics };
}

function getFeatureBounds(feature: google.maps.Data.Feature) {
  const bounds = new google.maps.LatLngBounds();
  feature
    .getGeometry()
    ?.forEachLatLng((position) => bounds.extend(position));
  return bounds;
}

function getMapPadding() {
  return {
    top: window.innerWidth >= 760 ? 96 : 126,
    right: window.innerWidth >= 760 ? 420 : 24,
    bottom: 48,
    left: 48,
  };
}

function clampZoomKeepingFocus(
  map: google.maps.Map,
  focus: google.maps.LatLng,
  maxZoom: number,
) {
  google.maps.event.addListenerOnce(map, "idle", () => {
    const zoom = map.getZoom();
    if (!zoom || zoom <= maxZoom) return;
    map.setZoom(maxZoom);
    // O offset com que o fitBounds compensa o padding assimétrico só vale no
    // zoom ajustado: ao limitar o zoom ele encolhe e a área focada some atrás
    // do painel. Recentraliza na mão com panTo (foco no centro da tela) e
    // panBy, que move o CENTRO DO MAPA em pixels no zoom atual. O centro da
    // área visível fica a (left - right) / 2 e (top - bottom) / 2 do centro da
    // tela, então o mapa move o oposto: dx = (right - left) / 2 e
    // dy = (bottom - top) / 2.
    const padding = getMapPadding();
    map.panTo(focus);
    map.panBy(
      (padding.right - padding.left) / 2,
      (padding.bottom - padding.top) / 2,
    );
  });
}

function pointOnSegment(
  point: google.maps.LatLngLiteral,
  start: google.maps.LatLng,
  end: google.maps.LatLng,
) {
  const cross =
    (point.lat - start.lat()) * (end.lng() - start.lng()) -
    (point.lng - start.lng()) * (end.lat() - start.lat());
  if (Math.abs(cross) > 1e-9) return false;

  const dot =
    (point.lng - start.lng()) * (end.lng() - start.lng()) +
    (point.lat - start.lat()) * (end.lat() - start.lat());
  if (dot < 0) return false;

  const squaredLength =
    (end.lng() - start.lng()) ** 2 + (end.lat() - start.lat()) ** 2;
  return dot <= squaredLength;
}

function pointInRing(
  point: google.maps.LatLngLiteral,
  ring: google.maps.Data.LinearRing,
) {
  const vertices = ring.getArray();
  if (vertices.length < 3) return false;

  let inside = false;

  for (
    let currentIndex = 0, previousIndex = vertices.length - 1;
    currentIndex < vertices.length;
    previousIndex = currentIndex++
  ) {
    const current = vertices[currentIndex];
    const previous = vertices[previousIndex];

    if (pointOnSegment(point, previous, current)) return true;

    const intersects =
      current.lat() > point.lat !== previous.lat() > point.lat &&
      point.lng <
        ((previous.lng() - current.lng()) *
          (point.lat - current.lat())) /
          (previous.lat() - current.lat()) +
          current.lng();

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygon(
  point: google.maps.LatLngLiteral,
  polygon: google.maps.Data.Polygon,
) {
  const rings = polygon.getArray();
  if (rings.length === 0 || !pointInRing(point, rings[0])) return false;

  return !rings.slice(1).some((ring) => pointInRing(point, ring));
}

function geometryContainsPoint(
  geometry: google.maps.Data.Geometry,
  point: google.maps.LatLngLiteral,
): boolean {
  if (geometry.getType() === "Polygon") {
    return pointInPolygon(point, geometry as google.maps.Data.Polygon);
  }

  if (geometry.getType() === "MultiPolygon") {
    return (geometry as google.maps.Data.MultiPolygon)
      .getArray()
      .some((polygon) => pointInPolygon(point, polygon));
  }

  if (geometry.getType() === "GeometryCollection") {
    return (geometry as google.maps.Data.GeometryCollection)
      .getArray()
      .some((item) => geometryContainsPoint(item, point));
  }

  return false;
}

function extractPolygonRings(polygon: google.maps.Data.Polygon) {
  return polygon.getArray().map((ring) =>
    ring.getArray().map((position) => ({
      lat: position.lat(),
      lng: position.lng(),
    })),
  );
}

/**
 * Anéis de coordenadas de uma geometria do `map.data`, para o export em PNG.
 * A malha vem em runtime e a extração roda uma única vez, depois do
 * carregamento: nunca refazemos o fetch da malha para exportar.
 */
function extractGeometryRings(
  geometry: google.maps.Data.Geometry,
): Array<Array<{ lat: number; lng: number }>> {
  const type = geometry.getType();
  if (type === "Polygon") {
    return extractPolygonRings(geometry as google.maps.Data.Polygon);
  }
  if (type === "MultiPolygon") {
    return (geometry as google.maps.Data.MultiPolygon)
      .getArray()
      .flatMap((polygon) => extractPolygonRings(polygon));
  }
  if (type === "GeometryCollection") {
    return (geometry as google.maps.Data.GeometryCollection)
      .getArray()
      .flatMap((item) => extractGeometryRings(item));
  }
  return [];
}

function extractExportShapes(
  features: google.maps.Data.Feature[],
): MapExportShape[] {
  return features
    .map((feature) => {
      const geometry = feature.getGeometry();
      return {
        id: getFeatureCode(feature),
        rings: geometry ? extractGeometryRings(geometry) : [],
      };
    })
    .filter((shape) => shape.rings.length > 0);
}

export function MunicipalityLayer() {
  const map = useMap();
  const sharedWorkspace = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : parseSharedWorkspaceUrl(window.location.href, validMunicipalityIds),
    [],
  );
  const analysis = useTerritorialAnalysis(sharedWorkspace?.analysisState);
  const electionHistory = useElectionHistory(electionData);
  const registrations = useCampaignRegistrations();
  const registrationAnalysis = useRegistrationAnalysis();

  /**
   * Entrada do agente de dados: os mesmos conjuntos que alimentam o mapa, sem
   * segunda fonte, para o chat e a tela nunca divergirem.
   */
  const agentData = useMemo(
    () => ({
      eleitorado: electorateJson as ElectorateDataset,
      socioeconomico: socioeconomicJson as SocioeconomicDataset,
      estruturaEtaria: ageStructureJson as AgeStructureDataset,
      alfabetizacao: literacyJson as LiteracyDataset,
      eleicoes: electionData,
      registroPartidos: spectrumRegistry,
      votosPorPartido: partyVotesJson as unknown as PartyVotesDataset,
      // Trajetória da candidata: o MESMO arquivo da aba "Accorsi" e do cartão.
      trajetoriaCandidata: candidateData,
      // O hook devolve campos soltos; o agente espera formato de snapshot. O
      // limiar de privacidade vem daqui e o motor do agente impõe o piso de 5
      // por cima, nunca abaixo, mesmo que a base declare menos.
      cadastros: {
        metadata: {
          mode: "synthetic-demo" as const,
          state: "GO" as const,
          referenceDate: registrations.referenceDate,
          privacyThreshold: registrations.privacyThreshold,
          recordCount: registrations.records.length,
          municipalityCount: new Set(
            registrations.records.map((registro) => registro.municipalityId),
          ).size,
          generatedAt: registrations.referenceDate,
          warning: "Recorte agregado; nunca expõe cadastro individual.",
        },
        records: registrations.records,
      },
      carregarLocais: loadPollingPlaces,
      carregarVotosPorLocal: loadPollingVotes,
    }),
    [registrations.records, registrations.referenceDate, registrations.privacyThreshold],
  );
  const spectrumAnalysis = useSpectrumAnalysis(spectrumContests);
  // Pleito e métrica da aba "Accorsi" moram aqui, não no painel: mapa e painel
  // leem o MESMO par, e a escolha sobrevive ao desmonte do painel.
  const candidateLayer = useCandidateLayer(
    candidateData,
    candidateElectorateIndex,
  );
  const territorialSelection = useTerritorialSelection(
    validMunicipalityIds,
    sharedWorkspace?.selectionIds ?? null,
  );
  const setSelectionMapMode = territorialSelection.setMapMode;
  const featureByCodeRef = useRef(
    new Map<string, google.maps.Data.Feature>(),
  );
  const selectionMapModeRef = useRef(false);
  const activeLayerRef = useRef<MapLayerId>("analysis");
  const toggleSelectionIdRef = useRef(territorialSelection.toggleId);
  const pollingMunicipalityRef = useRef<(id: string | null) => void>(() => {});
  const selectionSequenceRef = useRef(0);
  const [selected, setSelected] = useState<MunicipalitySelection | null>(null);
  const [selectionEvent, setSelectionEvent] =
    useState<MunicipalitySelectionEvent | null>(null);
  const [hovered, setHovered] = useState<MunicipalitySelection | null>(null);
  const [searchMarker, setSearchMarker] = useState<SearchMarker | null>(null);
  const [territorialLocation, setTerritorialLocation] =
    useState<SelectedTerritorialLocation | null>(null);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [analysisOpenRequest, setAnalysisOpenRequest] = useState(0);
  const [electionOpenRequest, setElectionOpenRequest] = useState(0);
  const [registrationOpenRequest, setRegistrationOpenRequest] = useState(0);
  const [spectrumOpenRequest, setSpectrumOpenRequest] = useState(0);
  const [pollingOpenRequest, setPollingOpenRequest] = useState(0);
  const [candidateOpenRequest, setCandidateOpenRequest] = useState(0);
  const [hoveredPollingId, setHoveredPollingId] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<MapLayerId>("analysis");
  // Camada sem dado gerado cai para a padrão (eleitorado). Vale para o
  // histórico do TSE e para a trajetória da candidata.
  const changeActiveLayer = useCallback((layer: MapLayerId) => {
    const semDado =
      (layer === "election" && electionPendente) ||
      (layer === "candidato" && candidatePendente);
    setActiveLayer(semDado ? "analysis" : layer);
  }, []);
  // Carregamento sob demanda: os arquivos da camada submunicipal só descem
  // quando ela vira a camada ativa pela primeira vez.
  const polling = usePollingPlaces(spectrumContests, activeLayer === "polling");
  const [selectionOpenRequest] = useState(() =>
    sharedWorkspace && sharedWorkspace.selectionIds.length > 0 ? 1 : 0,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapShapes, setMapShapes] = useState<MapExportShape[] | null>(null);
  const municipalityValues = useMemo(
    () => Object.values(electorateData.municipalities),
    [],
  );
  const analysisModel = useMemo(
    () =>
      buildAnalysisModel(
        municipalityValues,
        analysis.state,
        electorateData.metadata.stateElectorate,
      ),
    [analysis.state, municipalityValues],
  );
  const electionModel = useMemo(
    () =>
      buildElectionModel(
        electionData,
        municipalityValues,
        electionHistory.state,
      ),
    [electionHistory.state, municipalityValues],
  );
  const registrationModel = useMemo(
    () =>
      buildRegistrationModel(
        registrations.records,
        municipalityValues,
        registrationAnalysis.state,
        registrations.referenceDate,
        registrations.privacyThreshold,
      ),
    [
      municipalityValues,
      registrationAnalysis.state,
      registrations.privacyThreshold,
      registrations.records,
      registrations.referenceDate,
    ],
  );
  const spectrumModel = useMemo(
    () =>
      buildSpectrumModel(
        spectrumContests,
        municipalityValues,
        spectrumIndex,
        spectrumAnalysis.state,
      ),
    [municipalityValues, spectrumAnalysis.state],
  );
  const pollingModel = useMemo(
    () =>
      buildPollingModel({
        places: polling.places,
        votes: polling.votes,
        index: spectrumIndex,
        registry: spectrumRegistry,
        contest: polling.contest,
        // A MESMA trajetória da aba dela: fonte dos votos nominais por local, e
        // não passa pelo carregamento sob demanda porque já vem no bundle.
        candidate: candidateData,
        state: polling.state,
      }),
    [polling.contest, polling.places, polling.state, polling.votes],
  );
  const pollingItemById = useMemo(
    () =>
      new Map(
        pollingModel.municipalityAggregates.map((item) => [item.ibgeCode, item]),
      ),
    [pollingModel.municipalityAggregates],
  );
  const pollingBubbleById = useMemo(
    () => new Map(pollingModel.bubbles.map((bubble) => [bubble.id, bubble])),
    [pollingModel.bubbles],
  );
  const candidateModel = useMemo(
    () =>
      buildCandidateLayerModel({
        dataset: candidateData,
        // O universo é a malha inteira: é ele que decide quem fica cinza por
        // estar fora da disputa e quem fica cinza por falta de denominador.
        municipios: municipalityValues,
        electorateIndex: candidateElectorateIndex,
        state: candidateLayer.state,
      }),
    [candidateLayer.state, municipalityValues],
  );
  const candidateItemById = useMemo(
    () =>
      new Map(
        (candidateModel?.allItems ?? []).map((item) => [item.ibgeCode, item]),
      ),
    [candidateModel],
  );
  const electionItemById = useMemo(
    () =>
      new Map(
        (electionModel?.allItems ?? []).map((item) => [
          item.municipality.ibgeCode,
          item,
        ]),
      ),
    [electionModel],
  );
  const registrationItemById = useMemo(
    () =>
      new Map(
        registrationModel.allItems.map((item) => [
          item.municipality.ibgeCode,
          item,
        ]),
      ),
    [registrationModel.allItems],
  );
  const spectrumItemById = useMemo(
    () =>
      new Map(
        spectrumModel.allItems.map((item) => [
          item.municipality.ibgeCode,
          item,
        ]),
      ),
    [spectrumModel.allItems],
  );
  const territorialSelectionSet = useMemo(
    () => new Set(territorialSelection.ids),
    [territorialSelection.ids],
  );

  useEffect(() => {
    selectionMapModeRef.current = territorialSelection.mapMode;
    toggleSelectionIdRef.current = territorialSelection.toggleId;
  }, [territorialSelection.mapMode, territorialSelection.toggleId]);

  useEffect(() => {
    activeLayerRef.current = activeLayer;
    // Trocar de camada não pode deixar um tooltip de bolha órfão na tela.
    setHoveredPollingId(null);
  }, [activeLayer]);

  useEffect(() => {
    pollingMunicipalityRef.current = polling.setMunicipalityId;
  }, [polling.setMunicipalityId]);

  const focusFeature = useCallback(
    (
      feature: google.maps.Data.Feature,
      source: SelectionSource,
      position?: google.maps.LatLngLiteral,
      viewport?: google.maps.LatLngBounds | null,
    ) => {
      if (!map) return;

      setSelectionMapMode(false);

      const municipality = getMunicipality(feature);
      selectionSequenceRef.current += 1;
      setSelected(municipality);
      setSelectionEvent({
        id: municipality.id,
        source,
        visitedAt: Date.now(),
        sequence: selectionSequenceRef.current,
      });
      setHovered(null);

      if (position) {
        if (viewport && !viewport.isEmpty()) {
          map.fitBounds(viewport, getMapPadding());
          clampZoomKeepingFocus(map, viewport.getCenter(), 16);
        } else {
          map.panTo(position);
          map.setZoom(14);
        }
        return;
      }

      const bounds = getFeatureBounds(feature);
      if (bounds.isEmpty()) return;

      map.fitBounds(bounds, getMapPadding());
      clampZoomKeepingFocus(map, bounds.getCenter(), 11);
    },
    [map, setSelectionMapMode],
  );

  const clearMapSelection = useCallback(() => {
    if (!map) return;

    setSelected(null);
    setSelectionEvent(null);
    setHovered(null);
    setSearchMarker(null);
    setTerritorialLocation(null);
    map.panTo(CENTRO_DO_ESTADO);
    map.setZoom(6);
  }, [map]);

  const resetMap = useCallback(() => {
    clearMapSelection();
    setSearchResetKey((current) => current + 1);
  }, [clearMapSelection]);

  const handleMunicipalitySearch = useCallback(
    (
      municipality: MunicipalitySearchOption,
      source: "municipality" | "cep",
    ) => {
      const feature = featureByCodeRef.current.get(municipality.id);
      if (!feature) return;

      setSearchMarker(null);
      setTerritorialLocation(null);
      if (activeLayerRef.current === "registration") {
        registrationAnalysis.setGeography(municipality.id);
      }
      if (activeLayerRef.current === "polling") {
        pollingMunicipalityRef.current(municipality.id);
      }
      focusFeature(feature, source);
    },
    [focusFeature, registrationAnalysis],
  );

  const handlePlaceSearch = useCallback(
    (target: PlaceSearchTarget): PlaceSearchResolution => {
      let feature = target.municipalityId
        ? featureByCodeRef.current.get(target.municipalityId)
        : undefined;

      if (!feature && target.position) {
        feature = Array.from(featureByCodeRef.current.values()).find(
          (candidate) => {
            const geometry = candidate.getGeometry();
            return geometry
              ? geometryContainsPoint(geometry, target.position as google.maps.LatLngLiteral)
              : false;
          },
        );
      }

      if (!feature) {
        return {
          municipality: null,
          error: "O local não pertence a um município coberto pela malha de Goiás.",
        };
      }

      const municipality = municipalitySearchById.get(getFeatureCode(feature));
      if (!municipality) {
        return {
          municipality: null,
          error: "O local não possui dados eleitorais municipais associados.",
        };
      }

      if (target.position) {
        setSearchMarker({
          kind: target.kind,
          title: target.title,
          address: target.address,
          position: target.position,
        });
      } else {
        setSearchMarker(null);
      }
      setTerritorialLocation({
        ...target,
        municipalityId: municipality.id,
        municipalityName: municipality.name,
      });
      if (activeLayerRef.current === "registration") {
        // O filtro sai dos próprios registros (normalizados dentro de
        // buildRegistrationModel), não da lista de clusters truncada por
        // privacidade: "Cidade Baixa" do ViaCEP casa com "CIDADE BAIXA".
        const cepPrefix = (target.cep ?? "").replace(/\D/g, "").slice(0, 5);
        const neighborhood = target.neighborhood?.trim() ?? "";
        registrationAnalysis.setGeography(
          municipality.id,
          neighborhood || null,
          /^\d{5}$/.test(cepPrefix) ? cepPrefix : null,
        );
      }
      focusFeature(
        feature,
        target.kind === "cep" ? "cep" : "place",
        target.position ?? undefined,
        target.viewport,
      );

      return { municipality, error: null };
    },
    [focusFeature, registrationAnalysis],
  );

  const handlePanelSelection = useCallback(
    (
      id: string,
      source:
        | "workspace"
        | "analysis"
        | "election"
        | "registration"
        | "spectrum"
        | "polling"
        | "selection" = "workspace",
    ) => {
      const feature = featureByCodeRef.current.get(id);
      if (!feature) return;

      setSearchMarker(null);
      setTerritorialLocation(null);
      setSearchResetKey((current) => current + 1);
      focusFeature(feature, source);
    },
    [focusFeature],
  );

  useEffect(() => {
    if (!map) return;

    const controller = new AbortController();
    const dataLayer = map.data;

    const clearLayer = () => {
      dataLayer.forEach((feature) => dataLayer.remove(feature));
      featureByCodeRef.current.clear();
      setMapShapes(null);
    };

    clearLayer();
    setLoading(true);
    setError(null);

    const loadMunicipalities = async () => {
      try {
        const [meshResponse, municipalitiesResponse] = await Promise.all([
          fetch(MUNICIPAL_MESH_URL, { signal: controller.signal }),
          fetch(MUNICIPALITIES_URL, { signal: controller.signal }),
        ]);

        if (!meshResponse.ok || !municipalitiesResponse.ok) {
          throw new Error("O IBGE não respondeu como esperado.");
        }

        const mesh = (await meshResponse.json()) as GeoJsonFeatureCollection;
        const municipalities =
          (await municipalitiesResponse.json()) as MunicipalityApiItem[];

        if (controller.signal.aborted) return;

        const namesById = new Map(
          municipalities.map((municipality) => [
            String(municipality.id),
            municipality.nome,
          ]),
        );

        mesh.features.forEach((feature) => {
          const code = String(
            feature.properties?.codarea ?? feature.id ?? "",
          );

          feature.properties = {
            ...feature.properties,
            codigo: code,
            nome:
              namesById.get(code) ??
              electorateData.municipalities[code]?.name ??
              `Município ${code}`,
          };
        });

        const features = dataLayer.addGeoJson(mesh);
        const mapCodes = new Set(features.map(getFeatureCode));
        const missingElectorate = Object.keys(
          electorateData.municipalities,
        ).filter((code) => !mapCodes.has(code));

        if (
          features.length !== electorateData.metadata.municipalityCount ||
          missingElectorate.length > 0
        ) {
          throw new Error(
            `Cobertura geográfica incompleta: ${features.length} polígonos e ` +
              `${missingElectorate.length} municípios eleitorais sem polígono.`,
          );
        }

        featureByCodeRef.current = new Map(
          features.map((feature) => [getFeatureCode(feature), feature]),
        );
        setMapShapes(extractExportShapes(features));
        setLoading(false);
      } catch (loadError) {
        if (controller.signal.aborted) return;

        console.error(loadError);
        clearLayer();
        setError("Não foi possível carregar e validar a malha municipal.");
        setLoading(false);
      }
    };

    void loadMunicipalities();

    const mouseOverListener = dataLayer.addListener(
      "mouseover",
      (event: google.maps.Data.MouseEvent) => {
        setHovered(getMunicipality(event.feature));
        map.getDiv().style.cursor = selectionMapModeRef.current
          ? "copy"
          : "pointer";
      },
    );

    const mouseOutListener = dataLayer.addListener("mouseout", () => {
      setHovered(null);
      map.getDiv().style.cursor = "";
    });

    const clickListener = dataLayer.addListener(
      "click",
      (event: google.maps.Data.MouseEvent) => {
        if (selectionMapModeRef.current) {
          toggleSelectionIdRef.current(getFeatureCode(event.feature));
          setHovered(getMunicipality(event.feature));
          return;
        }

        setSearchMarker(null);
        setTerritorialLocation(null);
        setSearchResetKey((current) => current + 1);
        if (activeLayerRef.current === "polling") {
          // Na camada submunicipal, abrir um município também recorta o
          // ranking e o resumo do painel para os locais daquele município.
          pollingMunicipalityRef.current(getFeatureCode(event.feature));
        }
        focusFeature(
          event.feature,
          activeLayerRef.current === "registration"
            ? "registration"
            : activeLayerRef.current === "polling"
              ? "polling"
              : "map",
        );
      },
    );

    return () => {
      controller.abort();
      mouseOverListener.remove();
      mouseOutListener.remove();
      clickListener.remove();
      map.getDiv().style.cursor = "";
      clearLayer();
    };
  }, [focusFeature, map]);

  /**
   * Parte do estilo que NÃO depende do ponteiro: cor da faixa, destaque do
   * recorte e seleção territorial. Em callback para servir ao `setStyle`
   * (todas as features) e ao destaque de hover/seleção (uma só).
   */
  const getMunicipalityStyleInputs = useCallback(
    (featureId: string): MunicipalityStyleInputs => {
      const metrics = electorateData.municipalities[featureId];
      const electionItem = electionItemById.get(featureId);
      const registrationItem = registrationItemById.get(featureId);
      const spectrumItem = spectrumItemById.get(featureId);
      // Na camada submunicipal o polígono recebe o índice AGREGADO dos seus
      // locais (soma dos votos antes do índice); o detalhe vive nas bolhas.
      const pollingItem = pollingItemById.get(featureId);
      // Na camada dela o município chega classificado pelo motor: valor, faixa
      // e o MOTIVO da ausência (fora da disputa × sem denominador).
      const candidateItem = candidateItemById.get(featureId);
      const value =
        activeLayer === "candidato"
          ? candidateItem?.value ?? null
        : activeLayer === "election"
          ? electionItem?.value ?? null
          : activeLayer === "registration"
            ? registrationItem?.value ?? null
          : activeLayer === "spectrum"
            ? spectrumItem?.value ?? null
          : activeLayer === "polling"
            ? pollingItem?.value ?? null
          : metrics
            ? getAnalysisMetricValue(metrics, analysis.state.metricId)
            : null;
      // Sem valor no recorte não existe faixa: o município fica cinza, nunca
      // pintado como se o índice fosse zero.
      const band =
        activeLayer === "candidato"
          ? candidateItem?.band ?? null
        : activeLayer === "election"
          ? electionItem?.band ?? null
          : activeLayer === "registration"
            ? registrationItem?.band ?? null
          : activeLayer === "spectrum"
            ? spectrumItem && spectrumItem.value !== null
              ? spectrumItem.band
              : null
          : activeLayer === "polling"
            ? pollingItem && pollingItem.value !== null
              ? pollingItem.band
              : null
          : value === null
            ? null
            : getAnalysisBand(value, analysisModel.thresholds);
      const activeBands =
        activeLayer === "candidato"
          ? candidateModel?.activeBands ?? ALL_ANALYSIS_BANDS
        : activeLayer === "election"
          ? electionHistory.state.activeBands
          : activeLayer === "registration"
            ? registrationAnalysis.state.activeBands
          : activeLayer === "spectrum"
            ? spectrumAnalysis.state.activeBands
          : activeLayer === "polling"
            ? polling.state.activeBands
          : analysis.state.activeBands;

      return {
        dataColor:
          band === null
            ? MISSING_DATA_COLOR
            : activeLayer === "candidato"
              ? CANDIDATE_LAYER_COLORS[band]
            : activeLayer === "spectrum"
              ? getSpectrumMetricColors(spectrumModel.metricId)[band]
            : activeLayer === "polling"
              ? getPollingMetricColors(pollingModel.metric)[band]
              : ELECTORATE_COLORS[band],
        isFocused: band !== null && activeBands.includes(band),
        isInTerritorialSelection: territorialSelectionSet.has(featureId),
      };
    },
    [
      analysis.state.activeBands,
      analysis.state.metricId,
      analysisModel.thresholds,
      activeLayer,
      candidateItemById,
      candidateModel,
      electionHistory.state.activeBands,
      electionItemById,
      registrationAnalysis.state.activeBands,
      registrationItemById,
      spectrumAnalysis.state.activeBands,
      spectrumItemById,
      spectrumModel.metricId,
      polling.state.activeBands,
      pollingItemById,
      pollingModel.metric,
      territorialSelectionSet,
    ],
  );

  // `setStyle` reavalia os 246 polígonos a cada chamada: só pode reagir a
  // mudança real de camada, métrica ou faixa, nunca ao ponteiro do mouse.
  useEffect(() => {
    if (!map) return;

    map.data.setStyle((feature) =>
      buildMunicipalityStyle(
        getMunicipalityStyleInputs(getFeatureCode(feature)),
        BASE_MUNICIPALITY_STYLE_FLAGS,
      ),
    );
  }, [getMunicipalityStyleInputs, map]);

  const hoveredId = hovered?.id ?? null;
  const selectedId = selected?.id ?? null;

  // Hover e seleção pintam só a feature afetada (overrideStyle) e desfazem no
  // cleanup (revertStyle): duas features por transição, não 246 reavaliações.
  // `mapShapes` está nas dependências como sinal de "malha carregada"; sem ele
  // uma seleção restaurada por link não acharia a feature.
  useEffect(() => {
    if (!map) return;

    const dataLayer = map.data;
    const decorated: google.maps.Data.Feature[] = [];
    const decorate = (id: string, flags: MunicipalityStyleFlags) => {
      const feature = featureByCodeRef.current.get(id);
      if (!feature) return;
      dataLayer.overrideStyle(
        feature,
        buildMunicipalityStyle(getMunicipalityStyleInputs(id), flags),
      );
      decorated.push(feature);
    };

    if (selectedId) {
      decorate(selectedId, {
        isSelected: true,
        isHovered: selectedId === hoveredId,
      });
    }
    if (hoveredId && hoveredId !== selectedId) {
      decorate(hoveredId, { isSelected: false, isHovered: true });
    }

    return () => {
      decorated.forEach((feature) => dataLayer.revertStyle(feature));
    };
  }, [getMunicipalityStyleInputs, hoveredId, map, mapShapes, selectedId]);

  // Pleito municipal na camada dela: a disputa foi em UMA cidade e o resto do
  // estado fica cinza, então o mapa enquadra a cidade. Só reenquadra quando a
  // cidade muda, nunca a cada render, para não brigar com quem moveu o mapa.
  const candidateFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!map) return;
    const cidade =
      activeLayer === "candidato"
        ? candidateModel?.escopoMunicipal ?? null
        : null;
    if (!cidade) {
      // Saindo de um pleito municipal que NÓS enquadramos, o mapa volta ao
      // estado inteiro: leitura estadual não abre no zoom de uma cidade.
      if (candidateFocusRef.current !== null && activeLayer === "candidato") {
        map.panTo(CENTRO_DO_ESTADO);
        map.setZoom(6);
      }
      candidateFocusRef.current = null;
      return;
    }
    if (candidateFocusRef.current === cidade.ibgeCode) return;
    // Sem malha não há o que enquadrar; `mapShapes` reexecuta o efeito quando
    // os polígonos chegam.
    const feature = featureByCodeRef.current.get(cidade.ibgeCode);
    if (!feature) return;
    const bounds = getFeatureBounds(feature);
    if (bounds.isEmpty()) return;
    candidateFocusRef.current = cidade.ibgeCode;
    map.fitBounds(bounds, getMapPadding());
    clampZoomKeepingFocus(map, bounds.getCenter(), 11);
  }, [activeLayer, candidateModel, map, mapShapes]);

  const formatSpectrumHoverValue = (municipalityId: string) => {
    const item = spectrumItemById.get(municipalityId);
    if (!item || item.value === null) {
      return spectrumModel.metricId === "shift"
        ? "Sem índice em um dos pleitos"
        : "Sem índice neste pleito";
    }
    return formatSpectrumValue(spectrumModel.metricId, item.value);
  };

  // Opções de texto da medida ativa: nome de urna e escala do voto dela.
  const pollingLabelOptions = {
    rate: pollingModel.candidateRate,
    nome: pollingModel.candidate?.nomeUrna,
  };

  const formatPollingHoverValue = (municipalityId: string) => {
    const item = pollingItemById.get(municipalityId);
    if (!item || item.value === null) {
      // Na medida da candidata, município sem valor não é "sem dado": é
      // município onde ela não era candidata.
      return pollingModel.metric === "votosCandidata"
        ? `${pollingModel.candidate?.nomeUrna ?? "A candidata"} não disputou neste município`
        : pollingModel.metric === "votoPartido"
          ? "Sem voto apurado por local neste pleito"
          : "Sem índice por local neste pleito";
    }
    return `${formatPollingValue(pollingModel.metric, item.value, { ...pollingLabelOptions, inScope: item.candidateInScope })} · ${item.placeCount} locais`;
  };

  // Rótulo curto da métrica ativa, usado no title, no aria-label e no tooltip
  // das bolhas.
  const pollingMetricLabel = getPollingMetricShortLabel(
    pollingModel.metric,
    pollingModel.partyCode,
    pollingLabelOptions,
  );

  const hoveredBubble =
    activeLayer === "polling" && hoveredPollingId
      ? pollingBubbleById.get(hoveredPollingId) ?? null
      : null;

  if (loading) {
    return (
      <div className="map-message" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={18} />
        Carregando mapa e indicadores territoriais…
      </div>
    );
  }

  if (error) {
    return (
      <div className="map-message map-message--error" role="alert">
        <AlertTriangle size={18} />
        <span>{error}</span>
        <button type="button" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <>
      <DataAgentChat dados={agentData} />

      <TerritorialSearch
        municipalities={municipalitySearchOptions}
        disabled={loading}
        resetKey={searchResetKey}
        onMunicipalitySelect={handleMunicipalitySearch}
        onPlaceSelect={handlePlaceSearch}
        onClear={clearMapSelection}
      />

      {searchMarker && (
        <AdvancedMarker
          position={searchMarker.position}
          title={`${searchMarker.title} — ${searchMarker.address}`}
          zIndex={10}
        >
          <div className="address-marker" aria-label={searchMarker.title}>
            <MapPin size={22} fill="currentColor" />
          </div>
        </AdvancedMarker>
      )}

      {activeLayer === "registration" &&
        !territorialSelection.mapMode &&
        registrationModel.clusters.map((cluster) => (
          <AdvancedMarker
            key={cluster.id}
            position={{ lat: cluster.latitude, lng: cluster.longitude }}
            title={`${cluster.neighborhood}, ${cluster.municipalityName}: ${cluster.count} cadastros agregados`}
            zIndex={8 + cluster.count}
          >
            <button
              className="registration-map-cluster"
              type="button"
              aria-label={`${cluster.count} cadastros agregados em ${cluster.neighborhood}, ${cluster.municipalityName}`}
              onClick={(event) => {
                event.stopPropagation();
                const feature = featureByCodeRef.current.get(cluster.municipalityId);
                if (feature) {
                  registrationAnalysis.setGeography(
                    cluster.municipalityId,
                    cluster.neighborhood,
                    cluster.cepPrefix,
                  );
                  focusFeature(feature, "registration", {
                    lat: cluster.latitude,
                    lng: cluster.longitude,
                  });
                }
              }}
            >
              {cluster.count}
            </button>
          </AdvancedMarker>
        ))}

      {activeLayer === "polling" &&
        !territorialSelection.mapMode &&
        pollingModel.bubbles.map((bubble) => (
          <AdvancedMarker
            key={bubble.id}
            position={{ lat: bubble.latitude, lng: bubble.longitude }}
            title={`${bubble.name} — ${pollingMetricLabel} ${formatPollingValue(pollingModel.metric, bubble.value, { ...pollingLabelOptions, inScope: bubble.candidateInScope })} · ${bubble.electorate} eleitores`}
            zIndex={bubble.focused ? 9 : 6}
          >
            <button
              className={`polling-map-bubble ${bubble.focused ? "" : "polling-map-bubble--muted"}`}
              type="button"
              style={{
                width: `${bubble.radius * 2}px`,
                height: `${bubble.radius * 2}px`,
                backgroundColor: bubble.color,
              }}
              aria-label={`${bubble.name}, ${bubble.municipalityName}: ${pollingMetricLabel} ${formatPollingValue(pollingModel.metric, bubble.value, { ...pollingLabelOptions, inScope: bubble.candidateInScope })}, ${bubble.electorate} eleitores`}
              onMouseEnter={() => setHoveredPollingId(bubble.id)}
              onMouseLeave={() =>
                setHoveredPollingId((current) =>
                  current === bubble.id ? null : current,
                )
              }
              onFocus={() => setHoveredPollingId(bubble.id)}
              onBlur={() =>
                setHoveredPollingId((current) =>
                  current === bubble.id ? null : current,
                )
              }
              onClick={(event) => {
                event.stopPropagation();
                const feature = featureByCodeRef.current.get(bubble.ibgeCode);
                if (!feature) return;
                polling.setMunicipalityId(bubble.ibgeCode);
                focusFeature(feature, "polling", {
                  lat: bubble.latitude,
                  lng: bubble.longitude,
                });
              }}
            />
          </AdvancedMarker>
        ))}

      {hoveredBubble && (
        <div className="municipality-tooltip polling-tooltip" aria-live="polite">
          <strong>{hoveredBubble.name}</strong>
          <span>
            {pollingMetricLabel}{" "}
            {formatPollingValue(pollingModel.metric, hoveredBubble.value, {
              ...pollingLabelOptions,
              inScope: hoveredBubble.candidateInScope,
            })}{" "}
            · {hoveredBubble.electorate.toLocaleString("pt-BR")} eleitores
            {pollingModel.metric === "indice"
              ? ` · cobertura ${hoveredBubble.coveragePct.toFixed(1)}%`
              : ""}
          </span>
          <span>
            {hoveredBubble.kind === "neighborhood"
              ? `${hoveredBubble.neighborhood}, ${hoveredBubble.municipalityName} · ${hoveredBubble.placeCount} locais agregados (não é polígono de bairro)`
              : `${hoveredBubble.neighborhood}, ${hoveredBubble.municipalityName}`}
          </span>
        </div>
      )}

      <button
        className="active-layer active-layer--interactive"
        type="button"
        aria-label={
          activeLayer === "candidato" && candidateModel
            ? `Abrir a aba de ${candidateModel.contest.candidatura.nomeUrna} · ${candidateModel.metric.label}`
          : activeLayer === "election" && electionModel
            ? `Abrir histórico da camada ${electionModel.candidate.ballotName}`
            : activeLayer === "registration"
              ? `Abrir cadastros da camada ${registrationModel.metricLabel}`
            : activeLayer === "spectrum"
              ? `Abrir espectro da camada ${spectrumModel.metricLabel}`
            : activeLayer === "polling"
              ? `Abrir camada de locais de votação · ${pollingMetricLabel}`
            : `Abrir análise da camada ${analysisModel.metric.label}`
        }
        onClick={() => {
          if (activeLayer === "candidato") {
            setCandidateOpenRequest((current) => current + 1);
          } else if (activeLayer === "election") {
            setElectionOpenRequest((current) => current + 1);
          } else if (activeLayer === "registration") {
            setRegistrationOpenRequest((current) => current + 1);
          } else if (activeLayer === "spectrum") {
            setSpectrumOpenRequest((current) => current + 1);
          } else if (activeLayer === "polling") {
            setPollingOpenRequest((current) => current + 1);
          } else {
            setAnalysisOpenRequest((current) => current + 1);
          }
        }}
      >
        <div className="active-layer-icon">
          <Database size={18} />
        </div>
        <div>
          <span>Camada ativa</span>
          <strong>
            {activeLayer === "candidato" && candidateModel
              ? getCandidateLayerShortLabel(candidateModel)
            : activeLayer === "election" && electionModel
              ? `${electionModel.candidate.ballotName} · ${electionModel.metricShortLabel}`
              : activeLayer === "registration"
                ? registrationModel.metricShortLabel
              : activeLayer === "spectrum"
                ? `Espectro · ${spectrumModel.metricShortLabel}`
              : activeLayer === "polling"
                ? `Locais · ${pollingMetricLabel}`
              : analysisModel.metric.shortLabel}
          </strong>
          {activeLayer === "candidato" && candidateModel ? (
            <small>
              {/* O denominador vai escrito: "por 1.000" sozinho leva a supor
                  "por 1.000 habitantes". */}
              {describeCandidateLayer(candidateModel)}
            </small>
          ) : activeLayer === "election" && electionModel ? (
            <small>
              TSE {electionModel.contest.electionYear} · {electionModel.contest.officeName} · {electionModel.contest.round}º turno
            </small>
          ) : activeLayer === "registration" ? (
            <small>
              {registrationModel.validRecordCount} cadastros · {registrationModel.coveredMunicipalityCount} municípios
            </small>
          ) : activeLayer === "spectrum" ? (
            <small>
              {spectrumModel.contest.electionYear} ·{" "}
              {spectrumModel.contest.officeName} ·{" "}
              {spectrumModel.contest.round}º turno · onda{" "}
              {spectrumModel.wave.year} do survey
            </small>
          ) : activeLayer === "polling" ? (
            <small>
              {/* A medida da candidata só precisa dos locais; o arquivo de votos
                  por sigla é de outra medida e não a bloqueia. */}
              {polling.placesStatus === "ready" &&
              (polling.votesStatus === "ready" ||
                pollingModel.metric === "votosCandidata")
                ? `${pollingModel.bubbles.length} bolhas · ${pollingModel.contestLabel}`
                : polling.placesStatus === "loading" ||
                    polling.votesStatus === "loading"
                  ? "Carregando dados sob demanda…"
                  : "Dados por local de votação ainda não gerados"}
            </small>
          ) : (
            <small>
              {analysisModel.metric.source} {analysisModel.metric.referenceYear} ·{" "}
              {analysisModel.filteredItems.length} de {analysisModel.allItems.length}{" "}em foco
            </small>
          )}
        </div>
      </button>

      {!territorialSelection.mapMode && hovered && hovered.id !== selected?.id && (
        <div className="municipality-tooltip" aria-live="polite">
          <strong>{hovered.name}</strong>
          <span>
            {activeLayer === "candidato" && candidateModel
              ? describeCandidateLayerItem(
                  candidateModel,
                  candidateItemById.get(hovered.id),
                )
              : activeLayer === "election" && electionModel
              ? formatElectionMetricValue(
                  electionModel.metricId,
                  electionItemById.get(hovered.id)?.value ?? 0,
                )
              : activeLayer === "registration"
                ? formatRegistrationMetricValue(
                    registrationAnalysis.state.metricId,
                    registrationItemById.get(hovered.id)?.value ?? 0,
                  )
              : activeLayer === "spectrum"
                ? formatSpectrumHoverValue(hovered.id)
              : activeLayer === "polling"
                ? formatPollingHoverValue(hovered.id)
              : hovered.metrics
                ? formatAnalysisMetricValue(
                    analysis.state.metricId,
                    getAnalysisMetricValue(
                      hovered.metrics,
                      analysis.state.metricId,
                    ),
                  )
                : "Sem dados territoriais"}
          </span>
        </div>
      )}

      {territorialSelection.mapMode ? (
        <button
          className="selection-mode-banner"
          type="button"
          onClick={() => territorialSelection.setMapMode(false)}
          aria-label="Encerrar seleção pelo mapa"
        >
          <ScanLine size={16} />
          <span>
            Modo recorte · {territorialSelection.ids.length}/30
          </span>
          <X size={14} />
        </button>
      ) : (
        <div className="map-instructions">
          <MousePointer2 size={16} />
          Clique ou pesquise para abrir um município
        </div>
      )}

      {/* Sem modelo (histórico pendente) a legenda não aparece: nada de faixas
          calculadas sobre dado inexistente. */}
      {activeLayer === "candidato" && candidateModel ? (
        <CandidateLegend
          model={candidateModel}
          onToggleBand={candidateLayer.toggleBand}
          onShowAllBands={candidateLayer.showAllBands}
        />
      ) : activeLayer === "election" && electionModel ? (
        <ElectionLegend
          metricId={electionModel.metricId}
          metricLabel={
            electionModel.metricId === "swing" && electionModel.comparisonCandidate
              ? `${electionModel.candidate.ballotName} · ${electionModel.metricShortLabel} vs ${electionModel.comparisonCandidate.ballotName} (${electionModel.comparisonContest.electionYear})`
              : `${electionModel.candidate.ballotName} · ${electionModel.metricShortLabel}`
          }
          thresholds={electionModel.thresholds}
          bandCounts={electionModel.bandCounts}
          activeBands={electionHistory.state.activeBands}
          year={electionModel.contest.electionYear}
          round={electionModel.contest.round}
          onToggleBand={electionHistory.toggleBand}
          onShowAllBands={electionHistory.showAllBands}
        />
      ) : activeLayer === "registration" ? (
        <RegistrationLegend
          metricId={registrationAnalysis.state.metricId}
          metricLabel={registrationModel.metricShortLabel}
          thresholds={registrationModel.thresholds}
          bandCounts={registrationModel.bandCounts}
          zeroMunicipalityCount={registrationModel.allItems.filter((item) => item.band === null).length}
          activeBands={registrationAnalysis.state.activeBands}
          privacyThreshold={registrationModel.privacyThreshold}
          onToggleBand={registrationAnalysis.toggleBand}
          onShowAllBands={registrationAnalysis.showAllBands}
        />
      ) : activeLayer === "polling" ? (
        <PollingLegend
          viewMode={pollingModel.viewMode}
          thresholds={pollingModel.thresholds}
          bandCounts={pollingModel.bandCounts}
          metric={pollingModel.metric}
          partyCode={pollingModel.partyCode}
          candidateName={pollingModel.candidate?.nomeUrna ?? ""}
          candidateRate={pollingModel.candidateRate}
          candidateUnmatchedPlaceCount={
            pollingModel.candidate?.unmatchedPlaceCount ?? 0
          }
          candidateUnmatchedVotes={pollingModel.candidate?.unmatchedVotes ?? 0}
          missingValueCount={pollingModel.missingValueCount}
          placesWithoutCoordinateCount={pollingModel.placesWithoutCoordinateCount}
          activeBands={polling.state.activeBands}
          waveYear={pollingModel.waveYear}
          bubbleCount={pollingModel.bubbles.length}
          hiddenBubbleCount={pollingModel.hiddenBubbleCount}
          onToggleBand={polling.toggleBand}
          onShowAllBands={polling.showAllBands}
        />
      ) : activeLayer === "spectrum" ? (
        <SpectrumLegend
          metricId={spectrumModel.metricId}
          metricLabel={
            spectrumModel.metricId === "shift" && spectrumModel.comparisonContest
              ? `Espectro · Deslocamento ${spectrumModel.comparisonContest.electionYear} → ${spectrumModel.contest.electionYear}`
              : `Espectro · ${spectrumModel.metricShortLabel}`
          }
          thresholds={spectrumModel.thresholds}
          bandCounts={spectrumModel.bandCounts}
          missingMunicipalityCount={spectrumModel.missingMunicipalityCount}
          activeBands={spectrumAnalysis.state.activeBands}
          bandMode={spectrumModel.bandMode}
          waveYear={spectrumModel.wave.year}
          waveRespondents={spectrumModel.wave.respondents}
          onToggleBand={spectrumAnalysis.toggleBand}
          onShowAllBands={spectrumAnalysis.showAllBands}
        />
      ) : (
        <ElectorateLegend
          metricId={analysis.state.metricId}
          metricLabel={analysisModel.metric.shortLabel}
          thresholds={analysisModel.thresholds}
          bandCounts={analysisModel.bandCounts}
          source={analysisModel.metric.source}
          referenceYear={analysisModel.metric.referenceYear}
          missingMunicipalityCount={analysisModel.missingMunicipalityCount}
          activeBands={analysis.state.activeBands}
          onToggleBand={analysis.toggleBand}
          onShowAllBands={analysis.showAllBands}
        />
      )}
      <MunicipalityPanel
        dataset={electorateData}
        selected={selected}
        selectionEvent={selectionEvent}
        analysisState={analysis.state}
        analysisModel={analysisModel}
        analysisOpenRequest={analysisOpenRequest}
        electionDataset={electionData}
        electionState={electionHistory.state}
        electionModel={electionModel}
        electionOpenRequest={electionOpenRequest}
        registrationState={registrationAnalysis.state}
        registrationModel={registrationModel}
        registrationMode={registrations.mode}
        registrationLoading={registrations.loading}
        registrationError={registrations.error}
        registrationLocalRecordCount={registrations.localRecordCount}
        registrationOpenRequest={registrationOpenRequest}
        spectrumContests={spectrumContests}
        spectrumRegistry={spectrumRegistry}
        spectrumState={spectrumAnalysis.state}
        spectrumModel={spectrumModel}
        spectrumOpenRequest={spectrumOpenRequest}
        pollingState={polling.state}
        pollingModel={pollingModel}
        pollingPlacesStatus={polling.placesStatus}
        pollingVotesStatus={polling.votesStatus}
        pollingPlacesMetadata={polling.placesMetadata}
        pollingOpenRequest={pollingOpenRequest}
        candidateState={candidateLayer.state}
        candidateModel={candidateModel}
        candidateOpenRequest={candidateOpenRequest}
        mapShapes={mapShapes}
        selectionIds={territorialSelection.ids}
        territorialLocation={territorialLocation}
        selectionMapMode={territorialSelection.mapMode}
        selectionOpenRequest={selectionOpenRequest}
        onAnalysisMetricChange={analysis.setMetricId}
        onAnalysisBandToggle={analysis.toggleBand}
        onAnalysisShowAllBands={analysis.showAllBands}
        onAnalysisSortChange={analysis.setSortDirection}
        onAnalysisReset={analysis.resetAnalysis}
        onElectionContestChange={electionHistory.setContestId}
        onElectionCandidateChange={electionHistory.setCandidateId}
        onElectionMetricChange={electionHistory.setMetricId}
        onElectionComparisonContestChange={electionHistory.setComparisonContestId}
        onElectionComparisonCandidateChange={electionHistory.setComparisonCandidateId}
        onElectionBandToggle={electionHistory.toggleBand}
        onElectionShowAllBands={electionHistory.showAllBands}
        onElectionSortChange={electionHistory.setSortDirection}
        onElectionReset={electionHistory.reset}
        onRegistrationMetricChange={registrationAnalysis.setMetricId}
        onRegistrationWindowChange={registrationAnalysis.setWindow}
        onRegistrationGeographyChange={registrationAnalysis.setGeography}
        onRegistrationSourceToggle={registrationAnalysis.toggleSource}
        onRegistrationStatusToggle={registrationAnalysis.toggleStatus}
        onRegistrationBandToggle={registrationAnalysis.toggleBand}
        onRegistrationShowAllBands={registrationAnalysis.showAllBands}
        onRegistrationSortChange={registrationAnalysis.setSortDirection}
        onRegistrationReset={registrationAnalysis.reset}
        onRegistrationAdd={registrations.addRegistration}
        onRegistrationImport={registrations.importRegistrations}
        onRegistrationClearLocal={registrations.clearLocalAdditions}
        onRegistrationReload={registrations.reload}
        onSpectrumContestChange={spectrumAnalysis.setContestId}
        onSpectrumComparisonContestChange={spectrumAnalysis.setComparisonContestId}
        onSpectrumMetricChange={spectrumAnalysis.setMetricId}
        onSpectrumBandModeChange={spectrumAnalysis.setBandMode}
        onSpectrumBandToggle={spectrumAnalysis.toggleBand}
        onSpectrumShowAllBands={spectrumAnalysis.showAllBands}
        onSpectrumSortChange={spectrumAnalysis.setSortDirection}
        onSpectrumReset={spectrumAnalysis.reset}
        onPollingContestChange={polling.setContestId}
        onPollingViewModeChange={polling.setViewMode}
        onPollingPartyChange={polling.setPartyCode}
        onPollingCandidateContestChange={polling.setCandidateContestId}
        onPollingCandidateRateChange={polling.setCandidateRate}
        onPollingMunicipalityChange={polling.setMunicipalityId}
        onPollingBandToggle={polling.toggleBand}
        onPollingShowAllBands={polling.showAllBands}
        onPollingSortChange={polling.setSortDirection}
        onPollingReset={polling.reset}
        onCandidateContestChange={candidateLayer.setContestId}
        onCandidateMetricChange={candidateLayer.setMetricId}
        onMapLayerChange={changeActiveLayer}
        onSelectionSetMapMode={territorialSelection.setMapMode}
        onSelectionToggleId={territorialSelection.toggleId}
        onSelectionAddIds={territorialSelection.addIds}
        onSelectionRemoveId={territorialSelection.removeId}
        onSelectionClear={territorialSelection.clear}
        onReset={resetMap}
        onSelectMunicipality={handlePanelSelection}
      />
    </>
  );
}
