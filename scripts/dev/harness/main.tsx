/**
 * HARNESS VISUAL descartável — monta componentes reais com dados SINTÉTICOS
 * para screenshot. Nunca entra no bundle de produção (ver vite.config.ts ao
 * lado). Escolha a vista pela query string:
 *
 *   /?view=stats     janela Estatísticas (fixtures no lugar dos snapshots)
 *   /?view=chat      painel do agente aberto (status do agente é mockado)
 *   /?view=login     tela de login (contexto de auth mockado)
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

function Raiz() {
  if (vista === "login") return <VistaLogin />;
  if (vista === "chat") return <VistaChat />;
  if (vista === "municipio") return <VistaMunicipio />;
  return <StatsWindow onClose={() => {}} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Raiz />
  </StrictMode>,
);
