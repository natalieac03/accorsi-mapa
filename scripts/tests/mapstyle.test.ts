import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_MUNICIPALITY_STYLE_FLAGS,
  buildMunicipalityStyle,
  type MunicipalityStyleInputs,
} from "../../src/utils/mapStyle.ts";

const COLOR = "#2f6f68";

function inputs(overrides: Partial<MunicipalityStyleInputs> = {}) {
  return {
    dataColor: COLOR,
    isFocused: true,
    isInTerritorialSelection: false,
    ...overrides,
  };
}

test("município fora do recorte fica apagado, mas continua clicável", () => {
  const style = buildMunicipalityStyle(
    inputs({ isFocused: false }),
    BASE_MUNICIPALITY_STYLE_FLAGS,
  );
  assert.equal(style.clickable, true);
  assert.equal(style.fillColor, COLOR);
  assert.equal(style.fillOpacity, 0.08);
  assert.equal(style.strokeColor, "#52605e");
  assert.equal(style.strokeOpacity, 0.32);
  assert.equal(style.strokeWeight, 0.7);
  assert.equal(style.zIndex, 1);
});

test("município dentro do recorte recebe a cor da faixa", () => {
  const style = buildMunicipalityStyle(inputs(), BASE_MUNICIPALITY_STYLE_FLAGS);
  assert.equal(style.fillOpacity, 0.73);
  assert.equal(style.strokeColor, "#4f1717");
  assert.equal(style.strokeOpacity, 0.86);
  assert.equal(style.zIndex, 1);
});

test("hover destaca sem apagar a distinção de recorte", () => {
  const focused = buildMunicipalityStyle(inputs(), {
    isSelected: false,
    isHovered: true,
  });
  const dimmed = buildMunicipalityStyle(inputs({ isFocused: false }), {
    isSelected: false,
    isHovered: true,
  });

  assert.equal(focused.fillOpacity, 0.9);
  assert.equal(dimmed.fillOpacity, 0.28);
  assert.equal(focused.strokeColor, "#ffd7d4");
  assert.equal(dimmed.strokeColor, "#ffd7d4");
  assert.equal(focused.strokeWeight, 2);
  assert.equal(focused.zIndex, 2);
});

test("seleção vence hover e seleção territorial", () => {
  const style = buildMunicipalityStyle(
    inputs({ isInTerritorialSelection: true }),
    { isSelected: true, isHovered: true },
  );
  assert.equal(style.fillOpacity, 0.96);
  assert.equal(style.strokeColor, "#ffffff");
  assert.equal(style.strokeOpacity, 1);
  assert.equal(style.strokeWeight, 3);
  assert.equal(style.zIndex, 4);
});

test("seleção territorial mantém o contorno âmbar sob o hover", () => {
  const marked = buildMunicipalityStyle(
    inputs({ isInTerritorialSelection: true }),
    BASE_MUNICIPALITY_STYLE_FLAGS,
  );
  const hovered = buildMunicipalityStyle(
    inputs({ isInTerritorialSelection: true }),
    { isSelected: false, isHovered: true },
  );

  assert.equal(marked.strokeColor, "#f2c66d");
  assert.equal(marked.strokeOpacity, 1);
  assert.equal(marked.strokeWeight, 2.4);
  assert.equal(marked.zIndex, 3);
  assert.equal(hovered.strokeColor, "#f2c66d");
  assert.equal(hovered.fillOpacity, 0.9);
  assert.equal(hovered.zIndex, 3);
});

test("o estilo base não conhece ponteiro nem seleção", () => {
  assert.deepEqual(BASE_MUNICIPALITY_STYLE_FLAGS, {
    isSelected: false,
    isHovered: false,
  });
});
