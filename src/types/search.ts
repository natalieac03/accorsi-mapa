export type MunicipalitySearchOption = {
  id: string;
  name: string;
  electorate: number;
};

export type TerritorialLocationKind =
  | "cep"
  | "neighborhood"
  | "address"
  | "place";

export type PlaceSearchTarget = {
  kind: TerritorialLocationKind;
  title: string;
  address: string;
  position: google.maps.LatLngLiteral | null;
  viewport: google.maps.LatLngBounds | null;
  municipalityId: string | null;
  cep: string | null;
  neighborhood: string | null;
  street: string | null;
};

export type SelectedTerritorialLocation = Omit<
  PlaceSearchTarget,
  "viewport"
> & {
  municipalityId: string;
  municipalityName: string;
};

export type PlaceSearchResolution = {
  municipality: MunicipalitySearchOption | null;
  error: string | null;
};

export type SearchMarker = {
  kind: TerritorialLocationKind;
  title: string;
  address: string;
  position: google.maps.LatLngLiteral;
};
