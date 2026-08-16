import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiRequest } from "./api";
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type LoginCredentials,
} from "./context";
import type { AuthenticatedUser, AuthResponse } from "./types";

const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED !== "false";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    AUTH_REQUIRED ? "loading" : "authenticated",
  );
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    if (!AUTH_REQUIRED) {
      setStatus("authenticated");
      return;
    }

    setStatus("loading");
    setConnectionError(null);
    try {
      const response = await apiRequest<AuthResponse>("/auth/me");
      setUser(response.user);
      setStatus("authenticated");
    } catch (error) {
      setUser(null);
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        setStatus("anonymous");
        return;
      }

      setConnectionError(
        error instanceof Error ? error.message : "A API está indisponível.",
      );
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    setUser(response.user);
    setConnectionError(null);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<{ message: string }>("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      required: AUTH_REQUIRED,
      status,
      user,
      connectionError,
      login,
      logout,
      retry: loadSession,
    }),
    [connectionError, loadSession, login, logout, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
