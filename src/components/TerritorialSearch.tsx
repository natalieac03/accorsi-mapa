import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Hash,
  LoaderCircle,
  MapPin,
  Navigation,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LIMITES_DO_ESTADO } from "../config/map";
import { CepLookupError, lookupCep } from "../services/cep";
import type {
  MunicipalitySearchOption,
  PlaceSearchResolution,
  PlaceSearchTarget,
  SelectedTerritorialLocation,
  TerritorialLocationKind,
} from "../types/search";
import { formatInteger } from "../utils/electorate";
import {
  buildCepLocationLabel,
  classifyTerritorialPlace,
  extractTerritorialAddressParts,
  formatCep,
  getCepDigits,
  isCepQuery,
  isCompleteCep,
  isInsideRsBoundingBox,
  isRioGrandeDoSulAddress,
  resolveMunicipalityFromAddress,
  searchMunicipalities,
} from "../utils/search";

type TerritorialSearchProps = {
  municipalities: MunicipalitySearchOption[];
  disabled: boolean;
  resetKey: number;
  onMunicipalitySelect: (
    municipality: MunicipalitySearchOption,
    source: "municipality" | "cep",
  ) => void;
  onPlaceSelect: (target: PlaceSearchTarget) => PlaceSearchResolution;
  onClear: () => void;
};

type Feedback = {
  tone: "success" | "error" | "info";
  message: string;
};

type ResultItem =
  | {
      key: string;
      type: "municipality";
      municipality: MunicipalitySearchOption;
    }
  | {
      key: string;
      type: "cep";
      digits: string;
    }
  | {
      key: string;
      type: "place";
      prediction: google.maps.places.PlacePrediction;
    };

type PlacesStatus = "idle" | "loading" | "ready" | "error";

function getPlaceTitle(prediction: google.maps.places.PlacePrediction) {
  return prediction.mainText?.text ?? prediction.text.text;
}

function getPlaceSubtitle(prediction: google.maps.places.PlacePrediction) {
  return prediction.secondaryText?.text ?? "Resultado do Google Places";
}

function getPredictionTypes(prediction: google.maps.places.PlacePrediction) {
  return (prediction as google.maps.places.PlacePrediction & { types?: string[] })
    .types ?? [];
}

function getLocationKindLabel(kind: TerritorialLocationKind) {
  switch (kind) {
    case "cep":
      return "CEP";
    case "neighborhood":
      return "Bairro";
    case "address":
      return "Endereço";
    default:
      return "Lugar";
  }
}

function getPredictionKindLabel(
  prediction: google.maps.places.PlacePrediction,
) {
  const types = getPredictionTypes(prediction);
  if (
    types.some(
      (type) =>
        type === "neighborhood" ||
        type === "sublocality" ||
        type.startsWith("sublocality_level_"),
    )
  ) {
    return "Bairro";
  }
  if (
    types.some((type) =>
      ["street_address", "route", "intersection", "premise"].includes(type),
    )
  ) {
    return "Endereço";
  }
  if (types.includes("locality")) return "Município";
  return "Lugar";
}

export function TerritorialSearch({
  municipalities,
  disabled,
  resetKey,
  onMunicipalitySelect,
  onPlaceSelect,
  onClear,
}: TerritorialSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placesStatus, setPlacesStatus] = useState<PlacesStatus>("idle");
  const [placePredictions, setPlacePredictions] = useState<
    google.maps.places.PlacePrediction[]
  >([]);
  const [selectedLocation, setSelectedLocation] =
    useState<SelectedTerritorialLocation | null>(null);
  const cepControllerRef = useRef<AbortController | null>(null);
  const placesLibraryPromiseRef = useRef<Promise<google.maps.PlacesLibrary> | null>(
    null,
  );
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(
    null,
  );
  const geocodingLibraryPromiseRef = useRef<
    Promise<google.maps.GeocodingLibrary> | null
  >(null);

  const localResults = useMemo(
    () => searchMunicipalities(query, municipalities, 4),
    [municipalities, query],
  );
  const cepQuery = isCepQuery(query);
  const completeCep = isCompleteCep(query);

  const resultItems = useMemo<ResultItem[]>(() => {
    if (completeCep) {
      const digits = getCepDigits(query);
      return [{ key: `cep-${digits}`, type: "cep", digits }];
    }

    if (cepQuery) return [];

    const municipalityItems: ResultItem[] = localResults.map(
      (municipality) => ({
        key: `municipality-${municipality.id}`,
        type: "municipality" as const,
        municipality,
      }),
    );

    const placeItems: ResultItem[] = placePredictions.map((prediction) => ({
      key: `place-${prediction.placeId}`,
      type: "place" as const,
      prediction,
    }));

    return [...municipalityItems, ...placeItems].slice(0, 10);
  }, [cepQuery, completeCep, localResults, placePredictions, query]);

  const ensurePlacesLibrary = useCallback(() => {
    if (!placesLibraryPromiseRef.current) {
      placesLibraryPromiseRef.current = google.maps
        .importLibrary("places")
        .catch((error: unknown) => {
          placesLibraryPromiseRef.current = null;
          throw error;
        });
    }

    return placesLibraryPromiseRef.current;
  }, []);

  const ensureGeocodingLibrary = useCallback(() => {
    if (!geocodingLibraryPromiseRef.current) {
      geocodingLibraryPromiseRef.current = google.maps
        .importLibrary("geocoding")
        .catch((error: unknown) => {
          geocodingLibraryPromiseRef.current = null;
          throw error;
        });
    }

    return geocodingLibraryPromiseRef.current;
  }, []);

  useEffect(() => {
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    setFeedback(null);
    setPlacePredictions([]);
    setSelectedLocation(null);
    sessionTokenRef.current = null;
    cepControllerRef.current?.abort();
  }, [resetKey]);

  useEffect(() => {
    return () => cepControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();
    const shouldSearchPlaces =
      trimmedQuery.length >= 3 &&
      !cepQuery &&
      open;

    if (!shouldSearchPlaces) {
      setPlacePredictions([]);
      setPlacesStatus("idle");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const loadPredictions = async () => {
        setPlacesStatus("loading");

        try {
          const places = await ensurePlacesLibrary();
          if (cancelled) return;

          sessionTokenRef.current ??= new places.AutocompleteSessionToken();
          const { suggestions } =
            await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: trimmedQuery,
              includedRegionCodes: ["br"],
              language: "pt-BR",
              region: "br",
              locationRestriction: LIMITES_DO_ESTADO,
              sessionToken: sessionTokenRef.current,
            });

          if (cancelled) return;

          setPlacePredictions(
            suggestions
              .map((suggestion) => suggestion.placePrediction)
              .filter(
                (
                  prediction,
                ): prediction is google.maps.places.PlacePrediction =>
                  prediction !== null,
              )
              .slice(0, 6),
          );
          setPlacesStatus("ready");
        } catch (error) {
          if (cancelled) return;

          console.error("Google Places indisponível", error);
          setPlacePredictions([]);
          setPlacesStatus("error");
        }
      };

      void loadPredictions();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cepQuery, ensurePlacesLibrary, open, query]);

  useEffect(() => {
    setActiveIndex(resultItems.length > 0 ? 0 : -1);
  }, [resultItems]);

  const selectMunicipality = useCallback(
    (
      municipality: MunicipalitySearchOption,
      source: "municipality" | "cep",
      cep?: string,
    ) => {
      setQuery(municipality.name);
      setOpen(false);
      setPlacePredictions([]);
      setSelectedLocation(null);
      sessionTokenRef.current = null;
      onMunicipalitySelect(municipality, source);
      setFeedback({
        tone: "success",
        message:
          source === "cep" && cep
            ? `CEP ${formatCep(cep)} localizado em ${municipality.name}.`
            : `${municipality.name} selecionado no mapa.`,
      });
    },
    [onMunicipalitySelect],
  );

  const searchCep = useCallback(
    async (digits: string) => {
      cepControllerRef.current?.abort();
      const controller = new AbortController();
      cepControllerRef.current = controller;
      setOpen(false);
      setCepLoading(true);
      setFeedback({ tone: "info", message: "Consultando o CEP…" });

      try {
        const result = await lookupCep(digits, controller.signal);
        const municipality = municipalities.find(
          (item) => item.id === result.ibge,
        );

        if (!municipality) {
          throw new CepLookupError(
            "O município do CEP não está na malha carregada.",
            "INVALID_RESPONSE",
          );
        }

        const labels = buildCepLocationLabel(result);
        let position: google.maps.LatLngLiteral | null = null;
        let viewport: google.maps.LatLngBounds | null = null;
        let preciseLocationAvailable = true;

        try {
          const geocoding = await ensureGeocodingLibrary();
          const geocoder = new geocoding.Geocoder();
          const response = await geocoder.geocode({
            address: labels.address,
            bounds: LIMITES_DO_ESTADO,
            componentRestrictions: {
              country: "BR",
              postalCode: getCepDigits(result.cep),
            },
            region: "BR",
          });
          const geocoded = response.results.find((item) => {
            const point = {
              lat: item.geometry.location.lat(),
              lng: item.geometry.location.lng(),
            };
            return isInsideRsBoundingBox(point);
          });

          if (geocoded) {
            position = {
              lat: geocoded.geometry.location.lat(),
              lng: geocoded.geometry.location.lng(),
            };
            viewport = geocoded.geometry.viewport;
          } else {
            preciseLocationAvailable = false;
          }
        } catch (error) {
          preciseLocationAvailable = false;
          console.warn(
            "CEP encontrado, mas a Geocoding API não retornou coordenadas.",
            error,
          );
        }

        const target: PlaceSearchTarget = {
          kind: "cep",
          title: labels.title,
          address: labels.address,
          position,
          viewport,
          municipalityId: municipality.id,
          cep: formatCep(result.cep),
          neighborhood: result.bairro || null,
          street: result.logradouro || null,
        };
        const resolution = onPlaceSelect(target);

        if (resolution.error || !resolution.municipality) {
          throw new CepLookupError(
            resolution.error ?? "Não foi possível abrir a região deste CEP.",
            "INVALID_RESPONSE",
          );
        }

        setQuery(
          [labels.title, formatCep(result.cep)].filter(Boolean).join(" — "),
        );
        setSelectedLocation({
          ...target,
          municipalityId: resolution.municipality.id,
          municipalityName: resolution.municipality.name,
        });
        setFeedback({
          tone: "success",
          message: preciseLocationAvailable
            ? `CEP ${formatCep(result.cep)} selecionado${result.bairro ? ` no bairro ${result.bairro}` : ""}.`
            : `CEP ${formatCep(result.cep)} selecionado. Ative a Geocoding API para posicionar o marcador exato.`,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;

        console.error("Falha na consulta de CEP", error);
        setFeedback({
          tone: "error",
          message:
            error instanceof CepLookupError
              ? error.message
              : "Não foi possível consultar o CEP agora.",
        });
      } finally {
        if (cepControllerRef.current === controller) {
          setCepLoading(false);
        }
      }
    },
    [ensureGeocodingLibrary, municipalities, onPlaceSelect],
  );

  const selectPlace = useCallback(
    async (prediction: google.maps.places.PlacePrediction) => {
      setOpen(false);
      setPlacePredictions([]);
      sessionTokenRef.current = null;
      setPlaceLoading(true);
      setFeedback({ tone: "info", message: "Localizando no mapa…" });

      try {
        const requestedPlace = prediction.toPlace();
        const { place } = await requestedPlace.fetchFields({
          fields: [
            "addressComponents",
            "displayName",
            "formattedAddress",
            "location",
            "types",
            "viewport",
          ],
        });

        if (!place.location) {
          throw new Error("O Google não retornou as coordenadas deste local.");
        }

        const position = {
          lat: place.location.lat(),
          lng: place.location.lng(),
        };
        const components = place.addressComponents ?? [];
        const isRsAddress = isRioGrandeDoSulAddress(components);

        if (
          isRsAddress === false ||
          (isRsAddress !== true && !isInsideRsBoundingBox(position))
        ) {
          setFeedback({
            tone: "error",
            message: "Este protótipo cobre apenas o Goiás.",
          });
          return;
        }

        const title = place.displayName ?? getPlaceTitle(prediction);
        const addressParts = extractTerritorialAddressParts(components);
        const kind = classifyTerritorialPlace(
          place.types ?? getPredictionTypes(prediction),
          addressParts,
        );
        const municipality = resolveMunicipalityFromAddress(
          components,
          title,
          municipalities,
        );
        const resolution = onPlaceSelect({
          kind,
          title,
          address: place.formattedAddress ?? getPlaceSubtitle(prediction),
          position,
          viewport: place.viewport ?? null,
          municipalityId: municipality?.id ?? null,
          cep: addressParts.cep,
          neighborhood: addressParts.neighborhood,
          street: addressParts.street,
        });

        if (resolution.error || !resolution.municipality) {
          setFeedback({
            tone: "error",
            message:
              resolution.error ??
              "Não foi possível relacionar este local a um município de Goiás.",
          });
          return;
        }

        const selectedTarget: SelectedTerritorialLocation = {
          kind,
          title,
          address: place.formattedAddress ?? getPlaceSubtitle(prediction),
          position,
          municipalityId: resolution.municipality.id,
          municipalityName: resolution.municipality.name,
          cep: addressParts.cep,
          neighborhood: addressParts.neighborhood,
          street: addressParts.street,
        };
        setSelectedLocation(selectedTarget);
        setQuery(title);
        setOpen(false);
        setFeedback({
          tone: "success",
          message: `${getLocationKindLabel(kind)} ${title} selecionado em ${resolution.municipality.name}.`,
        });
      } catch (error) {
        console.error("Falha ao selecionar local do Google Places", error);
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível abrir este local.",
        });
      } finally {
        setPlaceLoading(false);
      }
    },
    [municipalities, onPlaceSelect],
  );

  const selectResult = useCallback(
    (item: ResultItem) => {
      if (item.type === "municipality") {
        selectMunicipality(item.municipality, "municipality");
        return;
      }

      if (item.type === "cep") {
        void searchCep(item.digits);
        return;
      }

      void selectPlace(item.prediction);
    },
    [searchCep, selectMunicipality, selectPlace],
  );

  const submitSearch = useCallback(() => {
    if (disabled || cepLoading || placeLoading) return;

    if (completeCep) {
      void searchCep(getCepDigits(query));
      return;
    }

    if (cepQuery) {
      setFeedback({ tone: "error", message: "Digite um CEP com 8 números." });
      setOpen(false);
      return;
    }

    const selectedResult =
      resultItems[activeIndex >= 0 ? activeIndex : 0] ?? null;

    if (selectedResult) {
      selectResult(selectedResult);
      return;
    }

    setFeedback({
      tone: "error",
      message:
        query.trim().length < 3
          ? "Digite pelo menos 3 letras ou um CEP."
          : "Nenhum resultado encontrado.",
    });
    setOpen(false);
  }, [
    activeIndex,
    cepLoading,
    cepQuery,
    completeCep,
    disabled,
    placeLoading,
    query,
    resultItems,
    searchCep,
    selectResult,
  ]);

  const clearSearch = useCallback(() => {
    cepControllerRef.current?.abort();
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    setFeedback(null);
    setPlacePredictions([]);
    setSelectedLocation(null);
    setPlacesStatus("idle");
    sessionTokenRef.current = null;
    onClear();
  }, [onClear]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && resultItems.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % resultItems.length);
      return;
    }

    if (event.key === "ArrowUp" && resultItems.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? resultItems.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitSearch();
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const busy = cepLoading || placeLoading;
  const showDropdown =
    open &&
    query.trim().length > 0 &&
    (resultItems.length > 0 ||
      placesStatus === "loading" ||
      placesStatus === "error" ||
      (cepQuery && !completeCep) ||
      (placesStatus === "ready" && placePredictions.length === 0));

  return (
    <section
      className="territorial-search"
      aria-label="Busca territorial"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <Search className="search-leading-icon" size={19} aria-hidden="true" />
        <label className="sr-only" htmlFor="territorial-search-input">
          Buscar município, CEP, bairro ou endereço
        </label>
        <input
          id="territorial-search-input"
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Município, CEP, bairro ou endereço…"
          autoComplete="off"
          spellCheck="false"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls="territorial-search-results"
          aria-activedescendant={
            activeIndex >= 0 ? `territorial-result-${activeIndex}` : undefined
          }
          onChange={(event) => {
            if (selectedLocation) onClear();
            setQuery(event.target.value);
            setOpen(true);
            setFeedback(null);
            setSelectedLocation(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />

        {query && (
          <button
            className="search-clear"
            type="button"
            onClick={clearSearch}
            aria-label="Limpar busca"
          >
            <X size={17} />
          </button>
        )}

        <button
          className="search-submit"
          type="submit"
          disabled={disabled || busy}
          aria-label="Pesquisar"
        >
          {busy ? <LoaderCircle className="spin" size={18} /> : <Navigation size={18} />}
        </button>
      </form>

      {showDropdown && (
        <div
          id="territorial-search-results"
          className="search-results"
          role="listbox"
          aria-label="Resultados da busca"
        >
          {resultItems.map((item, index) => {
            const selected = index === activeIndex;

            if (item.type === "municipality") {
              return (
                <button
                  id={`territorial-result-${index}`}
                  className={`search-result ${selected ? "search-result--active" : ""}`}
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectResult(item)}
                >
                  <span className="search-result-icon">
                    <Building2 size={17} />
                  </span>
                  <span className="search-result-copy">
                    <strong>{item.municipality.name}</strong>
                    <small>
                      {formatInteger(item.municipality.electorate)} eleitores
                    </small>
                  </span>
                  <span className="search-result-kind">Município</span>
                </button>
              );
            }

            if (item.type === "cep") {
              return (
                <button
                  id={`territorial-result-${index}`}
                  className={`search-result ${selected ? "search-result--active" : ""}`}
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectResult(item)}
                >
                  <span className="search-result-icon">
                    <Hash size={17} />
                  </span>
                  <span className="search-result-copy">
                    <strong>Consultar {formatCep(item.digits)}</strong>
                    <small>Localizar o CEP e associar ao município</small>
                  </span>
                  <span className="search-result-kind">CEP</span>
                </button>
              );
            }

            return (
              <button
                id={`territorial-result-${index}`}
                className={`search-result ${selected ? "search-result--active" : ""}`}
                key={item.key}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectResult(item)}
              >
                <span className="search-result-icon">
                  <MapPin size={17} />
                </span>
                <span className="search-result-copy">
                  <strong>{getPlaceTitle(item.prediction)}</strong>
                  <small>{getPlaceSubtitle(item.prediction)}</small>
                </span>
                <span className="search-result-kind">
                  {getPredictionKindLabel(item.prediction)}
                </span>
              </button>
            );
          })}

          {placesStatus === "loading" && (
            <div className="search-state" role="status">
              <LoaderCircle className="spin" size={17} />
              Buscando endereços no Google…
            </div>
          )}

          {placesStatus === "error" && (
            <div className="search-state search-state--error" role="alert">
              <AlertCircle size={17} />
              <span>
                Busca por endereço indisponível. Confira a Places API (New).
              </span>
            </div>
          )}

          {cepQuery && !completeCep && (
            <div className="search-state" role="status">
              <Hash size={17} />
              Digite os 8 números do CEP ({getCepDigits(query).length}/8).
            </div>
          )}

          {placesStatus === "ready" && placePredictions.length === 0 && (
            <div className="search-state" role="status">
              <MapPin size={17} />
              Nenhum endereço encontrado para esta busca.
            </div>
          )}
        </div>
      )}

      {feedback && (
        <div
          className={`search-feedback search-feedback--${feedback.tone}`}
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.tone === "success" ? (
            <CheckCircle2 size={15} />
          ) : feedback.tone === "error" ? (
            <AlertCircle size={15} />
          ) : (
            <LoaderCircle className={busy ? "spin" : ""} size={15} />
          )}
          <span>{feedback.message}</span>
          {feedback.tone === "success" && (
            <small>Dados eleitorais exibidos no nível municipal.</small>
          )}
        </div>
      )}

      {selectedLocation && feedback?.tone === "success" && (
        <div className="selected-location-card" role="status">
          <span className="selected-location-icon">
            {selectedLocation.kind === "cep" ? (
              <Hash size={16} />
            ) : (
              <MapPin size={16} />
            )}
          </span>
          <div className="selected-location-copy">
            <small>{getLocationKindLabel(selectedLocation.kind)} selecionado</small>
            <strong>{selectedLocation.title}</strong>
            <span>{selectedLocation.address}</span>
            <em>
              Município: {selectedLocation.municipalityName} · indicadores TSE
              continuam municipais
            </em>
          </div>
        </div>
      )}
    </section>
  );
}
