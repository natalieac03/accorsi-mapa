import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgeStructureDataset } from "../../src/types/ageStructure.ts";
import type { LiteracyDataset } from "../../src/types/literacy.ts";
import type { ElectionDataset } from "../../src/types/elections.ts";
import type { ElectorateDataset } from "../../src/types/electorate.ts";
import type { SocioeconomicDataset } from "../../src/types/socioeconomic.ts";
import type { PartySpectrumRegistry } from "../../src/types/spectrum.ts";
import {
  buildBandStyleMap,
  buildSpectrumMapExport,
  computeExportLayout,
  computeShapeBounds,
  createEquirectangularProjection,
  MAP_EXPORT_ATTRIBUTION,
  type MapExportShape,
} from "../../src/utils/mapExport.ts";
import { MISSING_DATA_COLOR } from "../../src/utils/electorate.ts";
import { buildTerritorialDataset } from "../../src/utils/socioeconomic.ts";
import { ELEICOES_PENDENTES, INSTRUCAO_GERAR } from "./dadosPendentes.ts";
import {
  buildContestsFromElections,
  buildPartySpectrumIndex,
  buildSpectrumModel,
  getDefaultSpectrumState,
  SPECTRUM_COLORS,
  SPECTRUM_SHIFT_COLORS,
} from "../../src/utils/spectrum.ts";

function loadJson<T>(relative: string): T {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
  ) as T;
}

const CLOSE = 1e-9;

test("bounding box e projeção mapeiam um quadrado conhecido no equador", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  // Quadrado de 2°×2° centrado no equador: cos(latitude média) = 1, então a
  // projeção equiretangular vira um mapeamento linear exato.
  const square: MapExportShape[] = [
    {
      id: "q",
      rings: [
        [
          { lat: -1, lng: 10 },
          { lat: -1, lng: 12 },
          { lat: 1, lng: 12 },
          { lat: 1, lng: 10 },
        ],
      ],
    },
  ];
  const bounds = computeShapeBounds(square);
  assert.ok(bounds);
  assert.deepEqual(bounds, { minLat: -1, maxLat: 1, minLng: 10, maxLng: 12 });

  const project = createEquirectangularProjection(bounds, 200, 200, 0);
  const topLeft = project({ lat: 1, lng: 10 });
  const bottomRight = project({ lat: -1, lng: 12 });
  const center = project({ lat: 0, lng: 11 });
  // Norte em cima: y cresce para o sul.
  assert.ok(Math.abs(topLeft.x - 0) < CLOSE);
  assert.ok(Math.abs(topLeft.y - 0) < CLOSE);
  assert.ok(Math.abs(bottomRight.x - 200) < CLOSE);
  assert.ok(Math.abs(bottomRight.y - 200) < CLOSE);
  assert.ok(Math.abs(center.x - 100) < CLOSE);
  assert.ok(Math.abs(center.y - 100) < CLOSE);
});

test("correção cos(latitude média) encolhe a longitude e centraliza", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  // Em latitude média 60°, cos = 0,5: 2° de longitude valem 1° projetado,
  // metade dos 2° de latitude. Num canvas quadrado o mapa é letterboxed e
  // centralizado no eixo x.
  const bounds = { minLat: 59, maxLat: 61, minLng: 0, maxLng: 2 };
  const project = createEquirectangularProjection(bounds, 100, 100, 0);
  const northWest = project({ lat: 61, lng: 0 });
  const southEast = project({ lat: 59, lng: 2 });
  assert.ok(Math.abs(northWest.x - 25) < CLOSE);
  assert.ok(Math.abs(northWest.y - 0) < CLOSE);
  assert.ok(Math.abs(southEast.x - 75) < CLOSE);
  assert.ok(Math.abs(southEast.y - 100) < CLOSE);
});

test("layout do export soma as seções e mantém a proporção do recorte", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  // No equador, recorte 1° de latitude por 2° de longitude: mapa duas vezes
  // mais largo que alto.
  const bounds = { minLat: -0.5, maxLat: 0.5, minLng: 0, maxLng: 2 };
  const layout = computeExportLayout(bounds, 6);
  assert.equal(layout.width, 2000);
  assert.equal(
    layout.totalHeight,
    layout.headerHeight + layout.mapHeight + layout.legendHeight + layout.footerHeight,
  );
  const innerWidth = layout.width - 2 * layout.padding;
  assert.equal(layout.mapHeight - layout.padding, Math.round(innerWidth / 2));
  assert.equal(layout.legendRows, Math.ceil(6 / layout.legendColumns));
  assert.ok(layout.legendHeight >= layout.legendRows * 40);
});

test("mapeamento de cores por banda respeita nulos e faixas fora de foco", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const styleById = buildBandStyleMap(
    [
      { id: "a", name: "Alfa", value: 4.5, band: 0, valueLabel: "4,5", focused: true },
      { id: "b", name: "Beta", value: 6.1, band: 3, valueLabel: "6,1", focused: false },
      { id: "c", name: "Gama", value: null, band: 0, valueLabel: "Sem índice", focused: false },
    ],
    SPECTRUM_COLORS,
  );
  assert.equal(styleById.get("a")?.fillColor, SPECTRUM_COLORS[0]);
  assert.equal(styleById.get("a")?.muted, false);
  assert.equal(styleById.get("b")?.fillColor, SPECTRUM_COLORS[3]);
  assert.equal(styleById.get("b")?.muted, true);
  // Valor nulo: cinza de "sem dado", nunca pintado como faixa 0 nem esmaecido.
  assert.equal(styleById.get("c")?.fillColor, MISSING_DATA_COLOR);
  assert.equal(styleById.get("c")?.muted, false);
  assert.equal(styleById.get("c")?.name, "Gama");
});

test("montagem do export do espectro usa cores por banda e nome descritivo", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const registry = loadJson<PartySpectrumRegistry>(
    "../../src/data/party-spectrum.json",
  );
  const elections = loadJson<ElectionDataset>(
    "../../src/data/election-history-go.json",
  );
  const electorate = loadJson<ElectorateDataset>(
    "../../src/data/electorate-go.json",
  );
  const socioeconomic = loadJson<SocioeconomicDataset>(
    "../../src/data/socioeconomic-go.json",
  );
  const ageStructure = loadJson<AgeStructureDataset>(
    "../../src/data/age-structure-go.json",
  );
  const literacy = loadJson<LiteracyDataset>("../../src/data/literacy-go.json");
  const index = buildPartySpectrumIndex(registry);
  const municipalities = Object.values(
    buildTerritorialDataset(electorate, socioeconomic, ageStructure, literacy)
      .municipalities,
  );
  let contests = buildContestsFromElections(elections, registry);
  const model = buildSpectrumModel(
    contests,
    municipalities,
    index,
    getDefaultSpectrumState(contests),
  );
  const data = buildSpectrumMapExport(model);
  assert.equal(data.styleById.size, 246);
  assert.equal(data.attribution, MAP_EXPORT_ATTRIBUTION);
  assert.match(data.filename, /^espectro-\d{4}-[a-z0-9-]+-\dt\.png$/);
  assert.equal(data.legend.length, 5 + (model.missingMunicipalityCount > 0 ? 1 : 0));
  for (const item of model.allItems) {
    const style = data.styleById.get(item.municipality.ibgeCode);
    assert.ok(style);
    if (item.value === null) {
      assert.equal(style.fillColor, MISSING_DATA_COLOR);
    } else {
      assert.equal(style.fillColor, SPECTRUM_COLORS[item.band]);
    }
  }

  // Com a métrica de deslocamento, a paleta divergente própria assume. O pleito
  // anterior é sintético (clone com ano - 4) para o teste valer com qualquer
  // conjunto de anos no snapshot.
  const current = contests[0]!;
  const comparison = {
    ...current,
    id: `${current.id}-anterior`,
    electionYear: current.electionYear - 4,
  };
  contests = [...contests, comparison];
  const shiftModel = buildSpectrumModel(contests, municipalities, index, {
    ...getDefaultSpectrumState(contests),
    contestId: current.id,
    metricId: "shift",
    comparisonContestId: comparison.id,
  });
  const shiftData = buildSpectrumMapExport(shiftModel);
  assert.match(
    shiftData.filename,
    new RegExp(
      `^espectro-deslocamento-${comparison.electionYear}-${current.electionYear}-[a-z0-9-]+-${current.round}t\\.png$`,
    ),
  );
  const shiftColors = new Set<string>([...SPECTRUM_SHIFT_COLORS, MISSING_DATA_COLOR]);
  for (const style of shiftData.styleById.values()) {
    assert.ok(shiftColors.has(style.fillColor), style.fillColor);
  }
});
