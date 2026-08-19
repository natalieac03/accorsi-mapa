import { APIProvider, Map } from "@vis.gl/react-google-maps";
import { BarChart3, Compass, History, LoaderCircle, Menu } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/context";
import { LoginScreen } from "./components/auth/LoginScreen";
import { UserMenu } from "./components/auth/UserMenu";
import { CENTRO_DO_ESTADO, LIMITES_DO_ESTADO } from "./config/map";
import { pedirAbrirAba } from "./utils/uiBus";

/**
 * Lazy: a camada territorial arrasta mais de 1,4 MB de JSON e monta o dataset
 * em escopo de módulo. Como import estático, isso era baixado já na tela de
 * login; agora vira chunk pedido só depois da sessão validada.
 */
const MunicipalityLayer = lazy(() =>
  import("./components/MunicipalityLayer").then((module) => ({
    default: module.MunicipalityLayer,
  })),
);

/** Overlay "Estatísticas", lazy pelo mesmo motivo: importa os snapshots da candidata e do eleitorado. */
const StatsWindow = lazy(() =>
  import("./components/stats/StatsWindow").then((module) => ({
    default: module.StatsWindow,
  })),
);

/**
 * Overlay "Oportunidades". Lazy com mais razão ainda que os anteriores: além
 * dos mesmos snapshots, esta janela arrasta os motores de similaridade,
 * clusterização e validação cruzada. Nada disso pode entrar no bundle da tela
 * de login.
 */
const OpportunitiesWindow = lazy(() =>
  import("./components/opportunities/OpportunitiesWindow").then((module) => ({
    default: module.OpportunitiesWindow,
  })),
);

export default function App() {
  const auth = useAuth();
  // Cobre o app inteiro, então o estado mora aqui (as abas do painel vão pelo uiBus).
  const [estatisticasAbertas, setEstatisticasAbertas] = useState(false);
  const [oportunidadesAbertas, setOportunidadesAbertas] = useState(false);
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
            {/* Áreas que não cabem na fileira de abas do painel. */}
            <HeaderMenu
              onAbrirEstatisticas={() => setEstatisticasAbertas(true)}
              onAbrirOportunidades={() => setOportunidadesAbertas(true)}
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

        {oportunidadesAbertas && (
          <Suspense
            fallback={
              <div
                className="stats-window stats-window--loading"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle className="spin" size={18} />
                Carregando oportunidades…
              </div>
            }
          >
            <OpportunitiesWindow
              onClose={() => setOportunidadesAbertas(false)}
            />
          </Suspense>
        )}
      </div>
    </APIProvider>
  );
}

/**
 * Menu do cabeçalho. Abre abas do painel via uiBus, que segura o pedido
 * enquanto o painel (lazy) ainda não montou.
 */
function HeaderMenu({
  onAbrirEstatisticas,
  onAbrirOportunidades,
}: {
  onAbrirEstatisticas: () => void;
  onAbrirOportunidades: () => void;
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
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAberto(false);
              onAbrirOportunidades();
            }}
          >
            <Compass size={15} aria-hidden />
            <span>Oportunidades</span>
            <small>onde investir, por tipo de território</small>
          </button>
        </div>
      )}
    </div>
  );
}
