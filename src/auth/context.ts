import { createContext, useContext } from "react";
import type { AuthenticatedUser } from "./types";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "anonymous"
  | "unavailable";

export type LoginCredentials = {
  email: string;
  password: string;
};

export type AuthContextValue = {
  required: boolean;
  status: AuthStatus;
  user: AuthenticatedUser | null;
  connectionError: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return context;
}

