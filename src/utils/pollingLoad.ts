import type { PollingDataStatus } from "../types/pollingPlaces";

/**
 * MÁQUINA DE ESTADOS DO CARREGAMENTO SOB DEMANDA (locais e votos).
 *
 * Vive fora do React: o efeito que baixa os dados não pode depender do próprio
 * status, senão a troca "idle" → "loading" muda as dependências, o cleanup
 * roda, o `cancelled` da promessa em voo vira `true` e o status fica preso em
 * "loading" (spinner eterno). Com o status numa referência, o efeito depende
 * só de `active`.
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
    // desligar e religar a camada, sem novo download.
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
 * cancelamento usado no cleanup do efeito (desmontagem ou camada desligada).
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
 * Devolve o status inicial de um pedido cuja chave mudou (outro pleito): volta
 * para "idle" para o próximo `runPollingLoad` buscar os dados novos.
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
