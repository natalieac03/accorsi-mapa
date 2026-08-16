import assert from "node:assert/strict";
import test from "node:test";
import type { MunicipalityHistoryEntry } from "../../src/types/workspace.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";
import {
  addComparisonId,
  addHistoryEntry,
  getSelectionSourceLabel,
  getTopElectoratePercent,
  removeMunicipalityId,
  sanitizeHistoryEntries,
  sanitizeMunicipalityIds,
  toggleMunicipalityId,
} from "../../src/utils/workspace.ts";

const validIds = new Set(["1", "2", "3", "4"]);

test("limpa IDs inválidos, duplicados e respeita o limite", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.deepEqual(
    sanitizeMunicipalityIds(["1", "1", "x", 2, "2", "3"], validIds, 2),
    ["1", "2"],
  );
});

test("valida histórico persistido antes de exibi-lo", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.deepEqual(
    sanitizeHistoryEntries(
      [
        { id: "1", source: "map", visitedAt: 100 },
        { id: "1", source: "cep", visitedAt: 90 },
        { id: "x", source: "map", visitedAt: 80 },
        { id: "2", source: "invalid", visitedAt: 70 },
        { id: "3", source: "place", visitedAt: 60 },
      ],
      validIds,
    ),
    [
      { id: "1", source: "map", visitedAt: 100 },
      { id: "3", source: "place", visitedAt: 60 },
    ],
  );
});

test("nova visita move o município para o início sem duplicar", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const history: MunicipalityHistoryEntry[] = [
    { id: "1", source: "map", visitedAt: 100 },
    { id: "2", source: "cep", visitedAt: 90 },
  ];
  const next = addHistoryEntry(history, {
    id: "2",
    source: "workspace",
    visitedAt: 200,
    sequence: 3,
  });

  assert.deepEqual(next, [
    { id: "2", source: "workspace", visitedAt: 200 },
    { id: "1", source: "map", visitedAt: 100 },
  ]);
});

test("favoritos alternam e comparação para em três municípios", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.deepEqual(toggleMunicipalityId(["1"], "1"), []);
  assert.deepEqual(toggleMunicipalityId(["1"], "2"), ["2", "1"]);
  assert.deepEqual(addComparisonId(["1", "2"], "3"), ["1", "2", "3"]);
  assert.deepEqual(addComparisonId(["1", "2", "3"], "4"), ["1", "2", "3"]);
  assert.deepEqual(removeMunicipalityId(["1", "2"], "1"), ["2"]);
});

test("gera leitura de posição relativa e rótulos de origem", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(getTopElectoratePercent(1, 246), 1);
  assert.equal(getTopElectoratePercent(50, 246), 11);
  assert.equal(getSelectionSourceLabel("cep"), "Busca por CEP");
  assert.equal(getSelectionSourceLabel("analysis"), "Análise territorial");
  assert.equal(getSelectionSourceLabel("election"), "Histórico eleitoral");
  assert.equal(getSelectionSourceLabel("selection"), "Recorte territorial");
  assert.equal(getSelectionSourceLabel("workspace"), "Painel lateral");
});
