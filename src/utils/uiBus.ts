import type { SidebarTab } from "../types/workspace";

/**
 * Canal mínimo entre o cabeçalho e o painel lateral.
 *
 * O menu "três linhas" mora no cabeçalho (App), mas as abas moram dentro do
 * painel, que é carregado sob demanda junto com o mapa (React.lazy). Elevar o
 * estado da aba até o App obrigaria a atravessar o MunicipalityLayer inteiro
 * com props que não são dele — e criaria acoplamento entre o carregamento do
 * mapa e um botão do cabeçalho. Um pub/sub de UM evento tipado resolve o
 * mesmo problema sem esse custo.
 *
 * Se um dia houver mais eventos de interface, é aqui que eles entram — sem
 * nunca virar um barramento genérico de dados (dados têm seus hooks).
 */

type AssinanteAbrirAba = (aba: SidebarTab) => void;

const assinantes = new Set<AssinanteAbrirAba>();

/** Pedido pendente feito antes de o painel montar (mapa ainda carregando). */
let pendente: SidebarTab | null = null;

export function pedirAbrirAba(aba: SidebarTab): void {
  if (assinantes.size === 0) {
    // O painel ainda não montou: guarda o último pedido para entregá-lo na
    // assinatura. Sem isso, clicar no menu durante o carregamento cai no vazio.
    pendente = aba;
    return;
  }
  for (const assinante of assinantes) assinante(aba);
}

export function assinarAbrirAba(assinante: AssinanteAbrirAba): () => void {
  assinantes.add(assinante);
  if (pendente !== null) {
    const aba = pendente;
    pendente = null;
    assinante(aba);
  }
  return () => {
    assinantes.delete(assinante);
  };
}
