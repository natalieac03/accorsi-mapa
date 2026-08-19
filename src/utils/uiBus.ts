import type { SidebarTab } from "../types/workspace";

/**
 * Canal mínimo entre o cabeçalho e o painel lateral: pub/sub de UM evento
 * tipado. O menu mora no App e as abas moram no painel, carregado sob demanda
 * com o mapa (React.lazy). Só eventos de interface entram aqui; dados têm seus
 * hooks.
 */

type AssinanteAbrirAba = (aba: SidebarTab) => void;

const assinantes = new Set<AssinanteAbrirAba>();

/** Pedido pendente feito antes de o painel montar (mapa ainda carregando). */
let pendente: SidebarTab | null = null;

export function pedirAbrirAba(aba: SidebarTab): void {
  if (assinantes.size === 0) {
    // Painel ainda não montou: guarda o último pedido para entregar na
    // assinatura, senão clicar no menu durante o carregamento cai no vazio.
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
