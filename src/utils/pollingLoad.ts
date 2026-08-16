import type { PollingDataStatus } from "../types/pollingPlaces";

/**
 * MÁQUINA DE ESTADOS DO CARREGAMENTO SOB DEMANDA (locais e votos).
 *
 * Vive fora do React de propósito: o efeito que baixa os dados NÃO pode
 * depender do próprio status, senão a troca "idle" → "loading" muda as
 * dependências, React roda o cleanup do efeito anterior, o `cancelled` da
 * promessa em voo vira `true` e o status fica preso em "loading" para sempre
 * (spinner eterno). Mantendo o status em uma referência e a transição aqui,
 * o efeito depende só de `active` e a promessa sempre chega ao fim.
 */
export type PollingLoadEvent =
  | { type: "start" }
  | { type: "settle"; hasData: boolean }
  | { type: "fail" }
  | { type: "cancel" };

export function reducePollingLoadStatus(
  status: PollingDataStatus,
  event: PollingLoadEvent,
): PollingDataStatus {
  switch (event.type) {
    // Só sai de "idle": um pedido já concluído (ready/missing/error) não é
    // refeito, é isso que mantém o cache de módulo valendo a pena.
    case "start":
      return status === "idle" ? "loading" : status;
    case "settle":
      return status === "loading"
        ? event.hasData
          ? "ready"
          : "missing"
        : status;
    case "fail":
      return status === "loading" ? "error" : status;
    // Cancelar só desfaz um pedido EM VOO. Um resultado já obtido sobrevive a
    // desligar e religar a camada — nada é baixado de novo.
    case "cancel":
      return status === "loading" ? "idle" : status;
  }
}

export type PollingLoadStatusRef = { current: PollingDataStatus };

export type PollingLoadHandlers<T> = {
  /** Espelha o status da referência no estado do React. */
  publish: (status: PollingDataStatus) => void;
  /** Guarda o payload e diz se o conjunto tem dados úteis. */
  receive: (dataset: T | null) => boolean;
  /** Limpa o payload quando o carregamento falha. */
  reject: () => void;
};

/**
 * Dispara um carregamento no máximo uma vez por status "idle" e devolve o
 * cancelamento que o efeito usa no cleanup (desmontagem ou camada desligada).
 */
export function runPollingLoad<T>(
  statusRef: PollingLoadStatusRef,
  load: () => Promise<T | null>,
  handlers: PollingLoadHandlers<T>,
): () => void {
  const apply = (event: PollingLoadEvent) => {
    const next = reducePollingLoadStatus(statusRef.current, event);
    if (next === statusRef.current) return false;
    statusRef.current = next;
    handlers.publish(next);
    return true;
  };

  // Já carregado (ou carregando): nada a iniciar e nada a cancelar depois.
  if (!apply({ type: "start" })) return () => {};

  let cancelled = false;

  void load()
    .then((dataset) => {
      if (cancelled) return;
      apply({ type: "settle", hasData: handlers.receive(dataset) });
    })
    .catch(() => {
      if (cancelled) return;
      handlers.reject();
      apply({ type: "fail" });
    });

  return () => {
    cancelled = true;
    apply({ type: "cancel" });
  };
}

/**
 * Devolve o status inicial de um pedido cuja chave mudou (outro pleito):
 * volta para "idle" para que o próximo `runPollingLoad` busque os dados novos.
 */
export function resetPollingLoadKey(
  statusRef: PollingLoadStatusRef,
  keyRef: { current: string },
  key: string,
) {
  if (keyRef.current === key) return false;
  keyRef.current = key;
  statusRef.current = "idle";
  return true;
}
