import { LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../auth/context";
import type { UserRole } from "../../auth/types";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  coordinator: "Coordenação",
  analyst: "Análise",
  field: "Campo",
};

export function UserMenu() {
  const { required, user, logout } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  if (!required) {
    return <div className="local-mode-badge">Modo local</div>;
  }
  if (!user) return null;

  const handleLogout = async () => {
    setSubmitting(true);
    try {
      await logout();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="user-menu">
      <div className="user-menu-copy">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          <strong>{user.full_name}</strong>
          <small>{ROLE_LABELS[user.role]}</small>
        </span>
      </div>
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={submitting}
        aria-label="Sair da plataforma"
        title="Sair"
      >
        {submitting ? <LoaderFallback /> : <LogOut size={16} />}
      </button>
    </div>
  );
}

function LoaderFallback() {
  return <span className="user-menu-loader" aria-hidden="true" />;
}
