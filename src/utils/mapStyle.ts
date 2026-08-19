/**
 * Estilo de um polígono municipal, isolado do Google Maps de propósito.
 * `map.data.setStyle` reavalia o callback para TODOS os 246 municípios a cada
 * chamada, então aqui fica só o que depende da camada (cor e destaque de
 * faixa); hover e seleção pintam uma única feature com `overrideStyle`.
 */
export type MunicipalityStyleInputs = {
  /** Cor da faixa (ou a cor de ausência de dado). */
  dataColor: string;
  /** A faixa do município está entre as faixas ativas do recorte. */
  isFocused: boolean;
  /** Município marcado no modo de seleção territorial. */
  isInTerritorialSelection: boolean;
};

export type MunicipalityStyleFlags = {
  isSelected: boolean;
  isHovered: boolean;
};

export type MunicipalityStyle = {
  clickable: boolean;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
  zIndex: number;
};

export const BASE_MUNICIPALITY_STYLE_FLAGS: MunicipalityStyleFlags = {
  isSelected: false,
  isHovered: false,
};

export function buildMunicipalityStyle(
  inputs: MunicipalityStyleInputs,
  flags: MunicipalityStyleFlags,
): MunicipalityStyle {
  const { dataColor, isFocused, isInTerritorialSelection } = inputs;
  const { isSelected, isHovered } = flags;

  return {
    clickable: true,
    fillColor: dataColor,
    fillOpacity: isSelected
      ? 0.96
      : isHovered
        ? isFocused
          ? 0.9
          : 0.28
        : isFocused
          ? 0.73
          : 0.08,
    strokeColor: isSelected
      ? "#ffffff"
      : isInTerritorialSelection
        ? "#f2c66d"
        : isHovered
          ? "#ffd7d4"
          : isFocused
            ? "#4f1717"
            : "#52605e",
    strokeOpacity:
      isSelected || isInTerritorialSelection ? 1 : isFocused ? 0.86 : 0.32,
    strokeWeight: isSelected
      ? 3
      : isInTerritorialSelection
        ? 2.4
        : isHovered
          ? 2
          : 0.7,
    zIndex: isSelected ? 4 : isInTerritorialSelection ? 3 : isHovered ? 2 : 1,
  };
}
