import { AlertCircle, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError } from "../../auth/api";
import { useAuth } from "../../auth/context";

/**
 * Conta usada no modo demonstração. Quando `VITE_DEMO_EMAIL` está definida, a
 * tela pede APENAS a senha e envia esse e-mail junto.
 *
 * O que este modo NÃO faz: ele não cria atalho no backend. A senha continua
 * sendo conferida contra o hash no banco, com o mesmo bloqueio por tentativas
 * e a mesma sessão assinada. A única diferença é que a pessoa não digita o
 * e-mail — e é por isso que ele pode existir sem abrir buraco de segurança.
 */
const EMAIL_DEMONSTRACAO = (import.meta.env.VITE_DEMO_EMAIL ?? "").trim();
const MODO_DEMONSTRACAO = EMAIL_DEMONSTRACAO.length > 0;

export function LoginScreen() {
  const { connectionError, login, retry, status } = useAuth();
  const [email, setEmail] = useState(EMAIL_DEMONSTRACAO);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login({ email, password });
    } catch (loginError) {
      setError(
        loginError instanceof ApiError
          ? loginError.message
          : "Não foi possível entrar. Tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <strong>ACCORSI</strong>
          <span>Inteligência territorial</span>
        </div>

        <div className="login-icon" aria-hidden="true">
          <LockKeyhole size={24} />
        </div>
        <span className="login-eyebrow">
          {MODO_DEMONSTRACAO ? "Demonstração" : "Acesso protegido"}
        </span>
        <h1 id="login-title">Entre na plataforma</h1>
        <p>
          {MODO_DEMONSTRACAO
            ? "Versão de demonstração com dados públicos do TSE e do IBGE. Informe a senha de acesso."
            : "Use a conta criada pelo administrador da campanha. O cadastro público fica desativado para proteger os dados territoriais."}
        </p>

        {status === "unavailable" ? (
          <div className="login-api-error" role="alert">
            <AlertCircle size={18} />
            <div>
              <strong>Backend indisponível</strong>
              <span>{connectionError}</span>
            </div>
            <button type="button" onClick={() => void retry()}>
              <RefreshCw size={15} />
              Tentar novamente
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            {!MODO_DEMONSTRACAO && (
              <>
                <label htmlFor="login-email">E-mail</label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                  maxLength={320}
                  placeholder="voce@campanha.com.br"
                />
              </>
            )}

            <label htmlFor="login-password">
              {MODO_DEMONSTRACAO ? "Senha de acesso" : "Senha"}
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              maxLength={128}
              placeholder="••••••••••••"
            />

            {error && (
              <div className="login-inline-error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" size={18} /> : <LockKeyhole size={18} />}
              {submitting ? "Entrando…" : "Entrar"}
            </button>
          </form>
        )}

        <small>
          {MODO_DEMONSTRACAO
            ? "Demonstração · dados públicos agregados · sem cadastro real de apoiadores"
            : "Sessão segura · perfis de acesso · trilha de auditoria"}
        </small>
      </section>
    </main>
  );
}
