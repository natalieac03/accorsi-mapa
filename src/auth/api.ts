const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "/api/v1"
).replace(/\/$/, "");

const CSRF_COOKIE = "acqr_csrf";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

async function responseMessage(response: Response) {
  const fallback = `A API respondeu com o status ${response.status}.`;
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) return fallback;

  try {
    const payload = (await response.json()) as {
      detail?: string | Array<{ msg?: string }>;
      message?: string;
    };

    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail.map((item) => item.msg).filter(Boolean).join(" ") || fallback;
    }
    return payload.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const csrfToken = readCookie(CSRF_COOKIE);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError(
      "Não foi possível conectar à API. Confirme se o backend está iniciado.",
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await responseMessage(response), response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

