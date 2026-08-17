/**
 * HARNESS VISUAL descartável — monta componentes reais com dados SINTÉTICOS
 * para screenshot. Nunca entra no bundle de produção (ver vite.config.ts ao
 * lado). Escolha a vista pela query string:
 *
 *   /?view=stats     janela Estatísticas (fixtures no lugar dos snapshots)
 *   /?view=chat      painel do agente aberto (status do agente é mockado)
 *   /?view=login     tela de login (contexto de auth mockado)
 *   /?view=accorsi   aba lateral "Accorsi" (trajetória + bairros de Goiânia)
 *   /?view=camada    camada "candidato" do mapa (legenda + malha simulada)
 *   /?view=locais    painel "Locais de votação" na medida de votos da candidata
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthContext } from "@src/auth/context";
// Cópias dos placeholders REAIS com nome alias-safe: o alias do harness troca
// os snapshots pelo sintético só para a janela Estatísticas; a vista do chat
// precisa dos placeholders originais coerentes entre si (mesmo recorte).
import ageStructureJson from "./fixtures/age-structure-go-pendente.json";
import electorateJson from "./fixtures/electorate-go-pendente.json";
import literacyJson from "./fixtures/literacy-go-pendente.json";
import electionHistoryJson from "@src/data/election-history-go.json";
import partySpectrumJson from "@src/data/party-spectrum.json";
import socioeconomicJson from "@src/data/socioeconomic-go.json";
import { DataAgentChat } from "@src/components/DataAgentChat";
import { LoginScreen } from "@src/components/auth/LoginScreen";
import { StatsWindow } from "@src/components/stats/StatsWindow";
import { CandidateMunicipioCard } from "@src/components/panel/CandidateMunicipioCard";
import { CandidatePanel } from "@src/components/panel/CandidatePanel";
import { PollingPlacesPanel } from "@src/components/panel/PollingPlacesPanel";
import { PollingLegend } from "@src/components/PollingLegend";
import { CandidateLegend } from "@src/components/CandidateLegend";
import { buildElectorateIndex } from "@src/utils/candidate";
import {
  buildCandidateLayerModel,
  CANDIDATE_LAYER_COLORS,
  describeCandidateLayer,
  describeCandidateLayerItem,
  getDefaultCandidateLayerState,
} from "@src/utils/candidateLayer";
import { MISSING_DATA_COLOR } from "@src/utils/electorate";
import { buildPollingModel } from "@src/utils/pollingPlaces";
import { buildPartySpectrumIndex } from "@src/utils/spectrum";
import type {
  CandidateDataset,
  CandidateLayerMunicipio,
  CandidateLayerState,
  ElectorateSource,
} from "@src/types/candidate";
import type { PollingPlace, PollingState } from "@src/types/pollingPlaces";
import type {
  PartySpectrumRegistry,
  SpectrumSourceContest,
} from "@src/types/spectrum";
import candidatoFixture from "./fixtures/adriana-accorsi.json";
// Eleitorado SINTÉTICO do harness: é o denominador da métrica "por 1.000
// eleitores" da camada dela (o snapshot real do checkout é placeholder).
import electorateGoJson from "./fixtures/electorate-go.json";
import { useState } from "react";
import "@src/index.css";

const vista = new URLSearchParams(window.location.search).get("view") ?? "stats";

// O painel do agente só se monta quando /api/v1/agent/status diz que existe
// chave no servidor; no harness não há backend, então o fetch é interceptado.
if (vista === "chat") {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (entrada, init) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.includes("/agent/status")) {
      return Promise.resolve(
        new Response(JSON.stringify({ enabled: true, model: "demo/harness" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return fetchOriginal(entrada, init);
  };
}

function VistaChat() {
  const dados = {
    // Snapshots reais do checkout (placeholders "pendente" são suportados
    // pelo motor); o harness só precisa do painel aberto para screenshot.
    eleitorado: electorateJson,
    socioeconomico: socioeconomicJson,
    estruturaEtaria: ageStructureJson,
    alfabetizacao: literacyJson,
    eleicoes: electionHistoryJson,
    registroPartidos: partySpectrumJson,
  } as unknown as Parameters<typeof DataAgentChat>[0]["dados"];
  return (
    <div className="app">
      <main className="map-container" style={{ background: "#e8e3e0" }}>
        <DataAgentChat dados={dados} />
        <AbrirChat />
      </main>
    </div>
  );
}

/** Clica no FAB assim que ele monta, para o screenshot pegar o painel aberto. */
function AbrirChat() {
  setTimeout(() => {
    const fab = document.querySelector<HTMLButtonElement>(".agent-fab");
    if (fab && fab.getAttribute("aria-expanded") === "false") fab.click();
  }, 300);
  return null;
}

function VistaLogin() {
  return (
    <AuthContext.Provider
      value={{
        required: true,
        status: "anonymous",
        user: null,
        connectionError: null,
        login: async () => {},
        logout: async () => {},
        retry: async () => {},
      }}
    >
      <LoginScreen />
    </AuthContext.Provider>
  );
}

/* Cartão da candidata no município clicado, nos dois casos que importam:
   Goiânia (dois universos de disputa) e um município comum (um só). */
function VistaMunicipio() {
  return (
    <div className="app">
      <aside className="sidebar" style={{ padding: 18, overflow: "auto" }}>
        <span className="panel-eyebrow">Município selecionado</span>
        <h2 style={{ margin: "2px 0 14px" }}>Goiânia</h2>
        <CandidateMunicipioCard ibgeCode="5208707" />
        <hr style={{ margin: "26px 0", border: 0, borderTop: "1px solid #eee" }} />
        <span className="panel-eyebrow">Município selecionado</span>
        <h2 style={{ margin: "2px 0 14px" }}>Anápolis</h2>
        <CandidateMunicipioCard ibgeCode="5201108" />
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Aba "Accorsi" e a camada do mapa que ela pinta.
 *
 * As duas telas leem o MESMO estado (pleito + métrica) — é o ponto do
 * recorte —, então o harness monta esse estado uma vez e passa para as duas.
 * ------------------------------------------------------------------------- */
const candidatoHarness = candidatoFixture as unknown as CandidateDataset;
const eleitoradoHarness = buildElectorateIndex(
  electorateGoJson as unknown as ElectorateSource,
);
const municipiosHarness: CandidateLayerMunicipio[] = Object.entries(
  (electorateGoJson as unknown as {
    municipalities: Record<string, { name: string }>;
  }).municipalities,
).map(([ibgeCode, municipality]) => ({ ibgeCode, name: municipality.name }));

function useCamadaHarness() {
  const [estado, setEstado] = useState<CandidateLayerState>(() => {
    const padrao = getDefaultCandidateLayerState(candidatoHarness, eleitoradoHarness);
    // ?pleito=<id> abre direto num pleito — é assim que o screenshot pega o
    // caso do pleito municipal sem depender de clique.
    const pedido = new URLSearchParams(window.location.search).get("pleito");
    return pedido && candidatoHarness.contests.some((item) => item.id === pedido)
      ? { ...padrao, contestId: pedido }
      : padrao;
  });
  const modelo = buildCandidateLayerModel({
    dataset: candidatoHarness,
    municipios: municipiosHarness,
    electorateIndex: eleitoradoHarness,
    state: estado,
  });
  return { estado, setEstado, modelo };
}

/* Aba "Accorsi" inteira, na largura real da barra lateral: é onde mora a
   seção de bairros de Goiânia, que segue o cargo do pleito selecionado. */
function VistaAccorsi() {
  const { estado, setEstado, modelo } = useCamadaHarness();
  return (
    <div className="app">
      <aside className="sidebar" style={{ overflow: "auto" }}>
        <CandidatePanel
          state={estado}
          layerModel={modelo}
          onContestChange={(contestId) =>
            setEstado((atual) => ({ ...atual, contestId }))
          }
          onMetricChange={(metricId) =>
            setEstado((atual) => ({ ...atual, metricId }))
          }
        />
      </aside>
    </div>
  );
}

/* Camada "candidato": legenda real + uma "malha" simulada (um quadrado por
   município, na cor que o polígono receberia). Não há Google Maps no harness,
   e o que precisa ser conferido aqui é justamente a cor, o texto do tooltip e
   o caso do pleito municipal — quase todo cinza, com a explicação junto. */
function VistaCamada() {
  const { estado, setEstado, modelo } = useCamadaHarness();
  if (!modelo) return <p>Trajetória pendente: a camada não é oferecida.</p>;
  return (
    <div className="app">
      <main className="map-container" style={{ background: "#e8e3e0", padding: 18 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {candidatoHarness.contests.map((pleito) => (
            <button
              key={pleito.id}
              type="button"
              onClick={() => setEstado((atual) => ({ ...atual, contestId: pleito.id }))}
              style={{ fontWeight: pleito.id === modelo.contest.id ? 700 : 400 }}
            >
              {pleito.electionYear} · {pleito.officeName}
            </button>
          ))}
        </div>
        <p style={{ maxWidth: 640, margin: "0 0 14px" }}>
          {describeCandidateLayer(modelo)}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 58px)", gap: 4 }}>
          {modelo.allItems.map((item) => (
            <span
              key={item.ibgeCode}
              title={`${item.nome} — ${describeCandidateLayerItem(modelo, item)}`}
              style={{
                height: 58,
                borderRadius: 4,
                background:
                  item.band === null
                    ? MISSING_DATA_COLOR
                    : CANDIDATE_LAYER_COLORS[item.band],
                opacity: modelo.activeBands.includes(item.band ?? 0) ? 0.85 : 0.15,
              }}
            />
          ))}
        </div>
        <CandidateLegend
          model={modelo}
          onToggleBand={() => {}}
          onShowAllBands={() =>
            setEstado((atual) => ({ ...atual, activeBands: [0, 1, 2, 3, 4] }))
          }
        />
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Vista "locais": o painel da camada submunicipal na TERCEIRA medida — os
 * votos nominais da candidata por local de votação.
 *
 * Os locais e os votos por sigla são sintéticos e inline (o checkout tem
 * placeholder "pendente" em src/data/polling), e a trajetória vem da fixture
 * do harness. Serve só para conferir o texto renderizado, a rampa vermelha e
 * a coerência da tela; nada disso entra no bundle de produção.
 * ------------------------------------------------------------------------- */
const registroHarness = partySpectrumJson as unknown as PartySpectrumRegistry;
const indiceHarness = buildPartySpectrumIndex(registroHarness);

const pleitoEspectro: SpectrumSourceContest = {
  id: "elections:2022-1-1",
  electionYear: 2022,
  round: 1,
  officeCode: 1,
  officeName: "Presidente",
  origin: "candidates",
  waveYear: 2022,
  stateTotalVotes: 0,
  municipalities: {},
};

function localHarness(
  extra: Partial<PollingPlace> & { id: string },
): PollingPlace {
  return {
    ibgeCode: "5208707",
    municipalityName: "Goiânia",
    zone: 1,
    localCode: 1010,
    name: `Local ${extra.id}`,
    address: "Rua Exemplo, 100",
    neighborhood: "Setor Central",
    neighborhoodKey: "setor central",
    cep: "74000",
    latitude: -16.68,
    longitude: -49.25,
    sectionCount: 8,
    electorate: 1200,
    ...extra,
  };
}

const locaisHarness: PollingPlace[] = [
  localHarness({ id: "10010-1-1010", name: "Escola Estadual Central", electorate: 4200 }),
  localHarness({
    id: "10010-1-1020",
    name: "Colégio Setor Bueno",
    neighborhood: "Setor Bueno",
    neighborhoodKey: "setor bueno",
    electorate: 2600,
    latitude: -16.7,
    longitude: -49.27,
  }),
  localHarness({
    id: "10010-2-2010",
    name: "Ginásio do Setor Oeste",
    neighborhood: "Setor Oeste",
    neighborhoodKey: "setor oeste",
    zone: 2,
    electorate: 1800,
    latitude: -16.66,
    longitude: -49.28,
  }),
  localHarness({
    id: "10010-2-2020",
    name: "Escola Municipal Oeste",
    neighborhood: "Setor Oeste",
    neighborhoodKey: "setor oeste",
    zone: 2,
    electorate: 900,
    latitude: -16.65,
    longitude: -49.29,
  }),
  localHarness({
    id: "20020-3-1010",
    ibgeCode: "5201108",
    municipalityName: "Anápolis",
    name: "Escola Anápolis",
    neighborhood: "Centro",
    neighborhoodKey: "centro",
    electorate: 2000,
    latitude: -16.32,
    longitude: -48.95,
  }),
];

const votosHarness: Record<string, Record<string, number>> = {
  "10010-1-1010": { PT: 2100, PL: 1400 },
  "10010-1-1020": { PT: 700, PL: 1500 },
  "10010-2-2010": { PT: 900, PL: 600 },
  "20020-3-1010": { PT: 500, PL: 1100 },
};

function VistaLocais() {
  const [estado, setEstado] = useState<PollingState>({
    contestId: pleitoEspectro.id,
    viewMode: "places",
    municipalityId: null,
    partyCode: null,
    // ?pleito=2020-11-1 mostra o caso MUNICIPAL (Anápolis fora da disputa e um
    // local não casado); sem o parâmetro, o primeiro pleito dela com locais.
    candidateContestId:
      new URLSearchParams(window.location.search).get("pleito") ??
      (candidatoFixture as unknown as CandidateDataset).contests.find(
        (pleito) => pleito.locais && Object.keys(pleito.locais).length > 0,
      )?.id ??
      null,
    candidateRate:
      new URLSearchParams(window.location.search).get("taxa") === "1",
    activeBands: [0, 1, 2, 3, 4],
    sortDirection: "desc",
  });
  const modelo = buildPollingModel({
    places: locaisHarness,
    votes: votosHarness,
    index: indiceHarness,
    registry: registroHarness,
    contest: pleitoEspectro,
    candidate: candidatoFixture as unknown as CandidateDataset,
    state: estado,
  });
  return (
    <div className="app">
      <aside className="sidebar" style={{ overflow: "auto" }}>
        <PollingPlacesPanel
          contests={[pleitoEspectro]}
          registry={registroHarness}
          model={modelo}
          state={estado}
          placesStatus="ready"
          votesStatus="ready"
          placesMetadata={null}
          mapShapes={null}
          selectedMunicipalityId={null}
          onContestChange={(contestId) =>
            setEstado((atual) => ({ ...atual, contestId }))
          }
          onViewModeChange={(viewMode) =>
            setEstado((atual) => ({ ...atual, viewMode }))
          }
          onPartyChange={(partyCode) =>
            setEstado((atual) => ({ ...atual, partyCode: partyCode || null }))
          }
          onCandidateContestChange={(candidateContestId) =>
            setEstado((atual) => ({ ...atual, candidateContestId }))
          }
          onCandidateRateChange={(candidateRate) =>
            setEstado((atual) => ({ ...atual, candidateRate }))
          }
          onMunicipalityChange={(municipalityId) =>
            setEstado((atual) => ({ ...atual, municipalityId }))
          }
          onToggleBand={() => {}}
          onShowAllBands={() =>
            setEstado((atual) => ({ ...atual, activeBands: [0, 1, 2, 3, 4] }))
          }
          onSortChange={(sortDirection) =>
            setEstado((atual) => ({ ...atual, sortDirection }))
          }
          onReset={() => {}}
          onSelect={() => {}}
        />
      </aside>
      <main className="map-container" style={{ background: "#e8e3e0", padding: 18 }}>
        <PollingLegend
          viewMode={modelo.viewMode}
          metric={modelo.metric}
          partyCode={modelo.partyCode}
          candidateName={modelo.candidate?.nomeUrna ?? ""}
          candidateRate={modelo.candidateRate}
          candidateUnmatchedPlaceCount={modelo.candidate?.unmatchedPlaceCount ?? 0}
          candidateUnmatchedVotes={modelo.candidate?.unmatchedVotes ?? 0}
          thresholds={modelo.thresholds}
          bandCounts={modelo.bandCounts}
          missingValueCount={modelo.missingValueCount}
          placesWithoutCoordinateCount={modelo.placesWithoutCoordinateCount}
          activeBands={estado.activeBands}
          waveYear={modelo.waveYear}
          bubbleCount={modelo.bubbles.length}
          hiddenBubbleCount={modelo.hiddenBubbleCount}
          onToggleBand={() => {}}
          onShowAllBands={() => {}}
        />
      </main>
    </div>
  );
}

function Raiz() {
  if (vista === "login") return <VistaLogin />;
  if (vista === "locais") return <VistaLocais />;
  if (vista === "accorsi") return <VistaAccorsi />;
  if (vista === "camada") return <VistaCamada />;
  if (vista === "chat") return <VistaChat />;
  if (vista === "municipio") return <VistaMunicipio />;
  return <StatsWindow onClose={() => {}} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Raiz />
  </StrictMode>,
);
