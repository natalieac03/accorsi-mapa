import { getCepDigits } from "../utils/search.ts";

export type ViaCepResult = {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
};

export class CepLookupError extends Error {
  readonly code:
    | "INVALID_CEP"
    | "NOT_FOUND"
    | "OUTSIDE_RS"
    | "INVALID_RESPONSE"
    | "NETWORK";

  constructor(
    message: string,
    code:
      | "INVALID_CEP"
      | "NOT_FOUND"
      | "OUTSIDE_RS"
      | "INVALID_RESPONSE"
      | "NETWORK",
  ) {
    super(message);
    this.name = "CepLookupError";
    this.code = code;
  }
}

export function parseViaCepResponse(data: unknown): ViaCepResult {
  if (!data || typeof data !== "object") {
    throw new CepLookupError(
      "O serviço retornou uma resposta inválida.",
      "INVALID_RESPONSE",
    );
  }

  const raw = data as Record<string, unknown>;

  if (raw.erro === true || raw.erro === "true") {
    throw new CepLookupError("CEP não encontrado.", "NOT_FOUND");
  }

  const cep = typeof raw.cep === "string" ? raw.cep : "";
  const localidade =
    typeof raw.localidade === "string" ? raw.localidade : "";
  const uf = typeof raw.uf === "string" ? raw.uf : "";
  const ibge = typeof raw.ibge === "string" ? raw.ibge : "";

  if (uf && uf !== "GO") {
    throw new CepLookupError(
      "Este protótipo cobre apenas o Goiás.",
      "OUTSIDE_RS",
    );
  }

  if (!cep || !localidade || !uf || !ibge || !/^\d{7}$/.test(ibge)) {
    throw new CepLookupError(
      "O CEP retornou dados municipais incompletos.",
      "INVALID_RESPONSE",
    );
  }

  return {
    cep,
    logradouro: typeof raw.logradouro === "string" ? raw.logradouro : "",
    complemento: typeof raw.complemento === "string" ? raw.complemento : "",
    bairro: typeof raw.bairro === "string" ? raw.bairro : "",
    localidade,
    uf,
    ibge,
  };
}

export async function lookupCep(value: string, signal?: AbortSignal) {
  const digits = getCepDigits(value);

  if (digits.length !== 8) {
    throw new CepLookupError("Digite um CEP com 8 números.", "INVALID_CEP");
  }

  let response: Response;

  try {
    response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw new CepLookupError(
      "Não foi possível consultar o CEP agora.",
      "NETWORK",
    );
  }

  if (!response.ok) {
    throw new CepLookupError(
      "O serviço de CEP não respondeu como esperado.",
      "NETWORK",
    );
  }

  return parseViaCepResponse(await response.json());
}
