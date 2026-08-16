import { APIProvider, Map } from "@vis.gl/react-google-maps";
import { BarChart3, History, LoaderCircle, Menu } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/context";
import { LoginScreen } from "./components/auth/LoginScreen";
import { UserMenu } from "./components/auth/UserMenu";
import { CENTRO_DO_ESTADO, LIMITES_DO_ESTADO } from "./config/map";
import { pedirAbrirAba } from "./utils/uiBus";

/**
 * A camada territorial carrega junto com ela mais de 1,4 MB de JSON
 * (eleitorado, histórico eleitoral, socioeconômico, faixas etárias, espectro
 * partidário) e monta o dataset consolidado ainda em escopo de módulo. Sendo
 * um import estático, tudo isso era baixado e parseado por quem só tinha
 * chegado à TELA DE LOGIN. Com `lazy`, esse peso vira um chunk separado,
 * pedido apenas depois que a sessão é validada.
 */
const MunicipalityLayer = lazy(() =>
  import("./components/MunicipalityLayer").then((module) => ({
    default: module.MunicipalityLayer,
  })),
);

/**
 * Janela "Estatísticas" (overlay de tela inteira): também lazy, pelo mesmo
 * motivo — ela importa os snapshots da candidata e do eleitorado, e esse peso
 * só deve ser baixado quando alguém abre a janela pelo menu.
 */
const StatsWindow = lazy(() =>
  import("./components/stats/StatsWindow").then((module) => ({
    default: module.StatsWindow,
  })),
);

export default function App() {
  const auth = useAuth();
  // A janela de estatísticas cobre o app inteiro, então o estado mora aqui —
  // diferente das abas do painel, que são pedidas via uiBus.
  const [estatisticasAbertas, setEstatisticasAbertas] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

  if (auth.status === "loading") {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <span className="auth-loading-mark">ACCORSI</span>
        <span>Validando acesso…</span>
      </div>
    );
  }

  if (auth.status !== "authenticated") return <LoginScreen />;

  if (!apiKey) {
    return (
      <div className="error-screen">
        Chave do Google Maps não encontrada no .env.local
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} language="pt-BR" region="BR">
      <div className="app">
        <header className="header">
          <div className="header-left">
            {/* Menu "três linhas" ao lado da marca: reúne as áreas que não
                cabem (nem precisam morar) na fileira de abas do painel. */}
            <HeaderMenu
              onAbrirEstatisticas={() => setEstatisticasAbertas(true)}
            />
            <div>
              <strong>ACCORSI</strong>
              <span>Inteligência territorial</span>
            </div>
          </div>

          <div className="header-actions">
            <UserMenu />
          </div>
        </header>

        <main className="map-container">
          <Map
            defaultCenter={CENTRO_DO_ESTADO}
            defaultZoom={6}
            gestureHandling="greedy"
            clickableIcons={false}
            mapTypeControl={false}
            streetViewControl={false}
            fullscreenControl={true}
            mapId={mapId}
            restriction={{
              latLngBounds: LIMITES_DO_ESTADO,
              strictBounds: false,
            }}
            style={{
              width: "100%",
              height: "100%",
            }}
          />
          <Suspense
            fallback={
              <div className="map-message" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={18} />
                Carregando indicadores territoriais…
              </div>
            }
          >
            <MunicipalityLayer />
          </Suspense>
        </main>

        {estatisticasAbertas && (
          <Suspense
            fallback={
              <div
                className="stats-window stats-window--loading"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle className="spin" size={18} />
                Carregando estatísticas…
              </div>
            }
          >
            <StatsWindow onClose={() => setEstatisticasAbertas(false)} />
          </Suspense>
        )}
      </div>
    </APIProvider>
  );
}

/**
 * Menu do cabeçalho. Cada item abre uma aba do painel lateral via uiBus — o
 * painel pode nem ter montado ainda (é lazy), e o bus segura o pedido.
 */
function HeaderMenu({
  onAbrirEstatisticas,
}: {
  onAbrirEstatisticas: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (evento: MouseEvent) => {
      if (!raiz.current?.contains(evento.target as Node)) setAberto(false);
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <div className="header-menu" ref={raiz}>
      <button
        type="button"
        className="header-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls="menu-do-cabecalho"
        title="Mais áreas"
        onClick={() => setAberto((atual) => !atual)}
      >
        <Menu size={18} aria-hidden />
        <span className="sr-only">Abrir menu</span>
      </button>

      {aberto && (
        <div
          className="header-menu__list"
          id="menu-do-cabecalho"
          role="menu"
          aria-label="Mais áreas"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAberto(false);
              pedirAbrirAba("history");
            }}
          >
            <History size={15} aria-hidden />
            <span>Histórico e salvos</span>
            <small>municípios visitados e favoritos</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAberto(false);
              onAbrirEstatisticas();
            }}
          >
            <BarChart3 size={15} aria-hidden />
            <span>Estatísticas</span>
            <small>campanhas da Dra. Adriana Accorsi</small>
          </button>
        </div>
      )}
    </div>
  );
}
