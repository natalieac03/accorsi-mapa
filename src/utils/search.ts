import type { MunicipalitySearchOption } from "../types/search";
import { STATE_NAME_NORMALIZED, STATE_UF } from "./state.ts";

export type AddressComponentLike = {
  longText: string | null;
  shortText: string | null;
  types: string[];
};

export type TerritorialAddressParts = {
  cep: string | null;
  neighborhood: string | null;
  street: string | null;
};

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function municipalityScore(query: string, name: string) {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(" ").some((word) => word.startsWith(query))) return 2;
  if (name.includes(query)) return 3;
  return Number.POSITIVE_INFINITY;
}

export function searchMunicipalities(
  query: string,
  municipalities: MunicipalitySearchOption[],
  limit = 6,
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  return municipalities
    .map((municipality) => ({
      municipality,
      normalizedName: normalizeSearchText(municipality.name),
    }))
    .map((item) => ({
      ...item,
      score: municipalityScore(normalizedQuery, item.normalizedName),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.municipality.electorate - a.municipality.electorate ||
        a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
    )
    .slice(0, limit)
    .map((item) => item.municipality);
}

export function getCepDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function isCepQuery(value: string) {
  const trimmed = value.trim();
  return /^[\d\s.-]+$/.test(trimmed) && getCepDigits(trimmed).length > 0;
}

export function isCompleteCep(value: string) {
  return isCepQuery(value) && getCepDigits(value).length === 8;
}

export function formatCep(value: string) {
  const digits = getCepDigits(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function getAddressComponent(
  components: AddressComponentLike[],
  type: string,
) {
  return components.find((component) => component.types.includes(type));
}

function getAddressComponentText(
  components: AddressComponentLike[],
  types: string[],
) {
  for (const type of types) {
    const component = getAddressComponent(components, type);
    const text = component?.longText ?? component?.shortText;
    if (text?.trim()) return text.trim();
  }

  return null;
}

export function extractTerritorialAddressParts(
  components: AddressComponentLike[],
): TerritorialAddressParts {
  const route = getAddressComponentText(components, ["route"]);
  const number = getAddressComponentText(components, ["street_number"]);

  return {
    cep: getAddressComponentText(components, ["postal_code"]),
    neighborhood: getAddressComponentText(components, [
      "neighborhood",
      "sublocality_level_1",
      "sublocality",
      "administrative_area_level_3",
    ]),
    street: route ? [route, number].filter(Boolean).join(", ") : null,
  };
}

export function classifyTerritorialPlace(
  placeTypes: string[],
  parts: TerritorialAddressParts,
) {
  if (
    placeTypes.some(
      (type) =>
        type === "neighborhood" ||
        type === "sublocality" ||
        type.startsWith("sublocality_level_"),
    ) ||
    (parts.neighborhood &&
      !placeTypes.some((type) =>
        ["street_address", "route", "premise", "subpremise"].includes(type),
      ))
  ) {
    return "neighborhood" as const;
  }

  if (
    placeTypes.some((type) =>
      [
        "street_address",
        "route",
        "intersection",
        "premise",
        "subpremise",
      ].includes(type),
    ) ||
    parts.street
  ) {
    return "address" as const;
  }

  return "place" as const;
}

export function buildCepLocationLabel(result: {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
}) {
  const title =
    [result.logradouro, result.bairro].filter(Boolean).join(" · ") ||
    `CEP ${formatCep(result.cep)}`;
  const address = [
    result.logradouro,
    result.complemento,
    result.bairro,
    `${result.localidade} - ${result.uf}`,
    formatCep(result.cep),
  ]
    .filter(Boolean)
    .join(", ");

  return { title, address };
}

export function isRioGrandeDoSulAddress(
  components: AddressComponentLike[],
) {
  const state = getAddressComponent(
    components,
    "administrative_area_level_1",
  );

  if (!state) return null;

  const stateNames = [state.shortText, state.longText]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSearchText);

  // Sem isto, endereço do estado certo era descartado pela busca.
  return (
    stateNames.includes(STATE_UF) ||
    stateNames.includes(STATE_NAME_NORMALIZED)
  );
}

export function resolveMunicipalityFromAddress(
  components: AddressComponentLike[],
  displayName: string,
  municipalities: MunicipalitySearchOption[],
) {
  const candidateTypes = [
    "administrative_area_level_2",
    "locality",
    "postal_town",
  ];
  const candidateNames = candidateTypes
    .map((type) => getAddressComponent(components, type)?.longText)
    .filter((value): value is string => Boolean(value));

  candidateNames.push(displayName);
  const normalizedCandidates = new Set(candidateNames.map(normalizeSearchText));

  return (
    municipalities.find((municipality) =>
      normalizedCandidates.has(normalizeSearchText(municipality.name)),
    ) ?? null
  );
}

export function isInsideRsBoundingBox(position: google.maps.LatLngLiteral) {
  return (
    position.lat <= -26.8 &&
    position.lat >= -34.1 &&
    position.lng >= -57.8 &&
    position.lng <= -49.5
  );
}
