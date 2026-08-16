export type UserRole = "admin" | "coordinator" | "analyst" | "field";

export type AuthenticatedUser = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type AuthResponse = {
  user: AuthenticatedUser;
};

