import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PollingDataStatus } from "../../src/types/pollingPlaces.ts";
import {
  reducePollingLoadStatus,
  resetPollingLoadKey,
  runPollingLoad,
} from "../../src/utils/pollingLoad.ts";

type Dataset = { places: string[] } | null;

function createProbe() {
  const statusRef = { current: "idle" as PollingDataStatus };
  const published: PollingDataStatus[] = [];
  let received: Dataset | undefined;
  let rejected = 0;
  return {
    statusRef,
    published,
    get received() {
      return received;
    },
    get rejected() {
      return rejected;
    },
    handlers: {
      publish: (status: PollingDataStatus) => {
        published.push(status);
      },
      receive: (dataset: Dataset) => {
        received = dataset;
        return dataset !== null && dataset.places.length > 0;
      },
      reject: () => {
        rejected += 1;
        received = null;
      },
    },
  };
}

test("a máquina de carregamento só dispara a partir de idle", () => {
  assert.equal(reducePollingLoadStatus("idle", { type: "start" }), "loading");
  assert.equal(reducePollingLoadStatus("loading", { type: "start" }), "loading");
  assert.equal(reducePollingLoadStatus("ready", { type: "start" }), "ready");
  assert.equal(reducePollingLoadStatus("missing", { type: "start" }), "missing");
  assert.equal(reducePollingLoadStatus("error", { type: "start" }), "error");
});

test("um resultado em voo sempre encerra o loading", () => {
  assert.equal(
    reducePollingLoadStatus("loading", { type: "settle", hasData: true }),
    "ready",
  );
  assert.equal(
    reducePollingLoadStatus("loading", { type: "settle", hasData: false }),
    "missing",
  );
  assert.equal(reducePollingLoadStatus("loading", { type: "fail" }), "error");
});

test("cancelar desfaz apenas um pedido em voo", () => {
  assert.equal(reducePollingLoadStatus("loading", { type: "cancel" }), "idle");
  assert.equal(reducePollingLoadStatus("ready", { type: "cancel" }), "ready");
  assert.equal(reducePollingLoadStatus("missing", { type: "cancel" }), "missing");
  assert.equal(reducePollingLoadStatus("error", { type: "cancel" }), "error");
});

test("o status sai de loading quando os locais chegam", async () => {
  const probe = createProbe();
  let calls = 0;
  const cleanup = runPollingLoad(
    probe.statusRef,
    () => {
      calls += 1;
      return Promise.resolve<Dataset>({ places: ["a", "b"] });
    },
    probe.handlers,
  );

  assert.equal(probe.statusRef.current, "loading");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls, 1);
  assert.equal(probe.statusRef.current, "ready");
  assert.deepEqual(probe.published, ["loading", "ready"]);
  cleanup();
  assert.equal(probe.statusRef.current, "ready");
});

test("conjunto vazio vira missing e falha vira error, nunca loading eterno", async () => {
  const empty = createProbe();
  runPollingLoad(
    empty.statusRef,
    () => Promise.resolve<Dataset>({ places: [] }),
    empty.handlers,
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(empty.statusRef.current, "missing");

  const failed = createProbe();
  runPollingLoad(
    failed.statusRef,
    () => Promise.reject(new Error("rede")),
    failed.handlers,
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(failed.statusRef.current, "error");
  assert.equal(failed.rejected, 1);
});

// Regressão do spinner eterno: o efeito que baixa os locais era refeito porque
// dependia do próprio status. React rodava o cleanup do ciclo anterior — que
// era dono da promessa em voo — e o segundo ciclo saía cedo pelo guarda de
// status. Resultado: o status ficava preso em "loading". Reencenamos ciclo,
// cleanup e novo ciclo: o carregamento tem de chegar a "ready".
test("remonte do efeito não deixa o status preso em loading", async () => {
  const probe = createProbe();
  let calls = 0;
  const load = () => {
    calls += 1;
    return Promise.resolve<Dataset>({ places: ["a"] });
  };

  const firstCleanup = runPollingLoad(probe.statusRef, load, probe.handlers);
  assert.equal(probe.statusRef.current, "loading");
  firstCleanup();
  assert.equal(probe.statusRef.current, "idle");

  runPollingLoad(probe.statusRef, load, probe.handlers);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(probe.statusRef.current, "ready");
  assert.equal(calls, 2);
  assert.equal(probe.received?.places.length, 1);
});

test("religar a camada não rebaixa dados já carregados", async () => {
  const probe = createProbe();
  let calls = 0;
  const load = () => {
    calls += 1;
    return Promise.resolve<Dataset>({ places: ["a"] });
  };

  const cleanup = runPollingLoad(probe.statusRef, load, probe.handlers);
  await Promise.resolve();
  await Promise.resolve();
  cleanup();
  assert.equal(probe.statusRef.current, "ready");

  const secondCleanup = runPollingLoad(probe.statusRef, load, probe.handlers);
  secondCleanup();
  assert.equal(calls, 1);
  assert.equal(probe.statusRef.current, "ready");
  assert.deepEqual(probe.published, ["loading", "ready"]);
});

test("trocar de pleito reabre o carregamento dos votos", () => {
  const statusRef = { current: "ready" as PollingDataStatus };
  const keyRef = { current: "2022-governador" };

  assert.equal(resetPollingLoadKey(statusRef, keyRef, "2022-governador"), false);
  assert.equal(statusRef.current, "ready");

  assert.equal(resetPollingLoadKey(statusRef, keyRef, "2022-presidente"), true);
  assert.equal(statusRef.current, "idle");
  assert.equal(keyRef.current, "2022-presidente");
});

// Guarda estrutural: qualquer volta de `placesStatus` para as dependências do
// efeito de carregamento reintroduz o spinner eterno.
test("o efeito dos locais não depende do status que ele mesmo altera", () => {
  const source = readFileSync(
    new URL("../../src/hooks/usePollingPlaces.ts", import.meta.url),
    "utf8",
  );
  const effect = source.slice(source.indexOf("runPollingLoad(placesStatusRef"));
  const deps = /\}, \[([^\]]*)\]\);/.exec(effect);

  assert.ok(deps, "efeito de carregamento dos locais não encontrado");
  const names = deps[1].split(",").map((item) => item.trim()).filter(Boolean);
  assert.deepEqual(names, ["active"]);
  assert.ok(!source.includes('placesStatus !== "idle"'));
});
