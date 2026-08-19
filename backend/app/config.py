from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "ACCORSI API"
    app_env: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./acqr_dev.db"
    session_secret: str = Field(
        default="development-only-change-this-session-secret-32-chars",
        min_length=32,
    )
    session_hours: int = Field(default=8, ge=1, le=168)
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str | None = None
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    allowed_hosts: str = "localhost,127.0.0.1,testserver"
    docs_enabled: bool = True
    login_max_attempts: int = Field(default=5, ge=3, le=20)
    login_window_minutes: int = Field(default=15, ge=1, le=120)

    # AUTH_REQUIRED=false abre a API sem login, para demonstração rápida.
    # Toda requisição passa a valer como o usuário demonstracao@local, perfil
    # "coordinator": vê tudo e mexe em cadastro, mas não administra usuário
    # nem lê o log de auditoria.
    # É o par do VITE_AUTH_REQUIRED do frontend. Os dois precisam ter o mesmo
    # valor: só no frontend, a tela de login some mas a API responde 401.
    auth_required: bool = True

    # --- Agente de perguntas sobre os dados (relé para o OpenRouter) ---
    # A chave é opcional de propósito: sem ela o app continua subindo normalmente
    # e só a rota /agent/chat responde 503. Nenhum outro recurso depende disso.
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Trocável por variável de ambiente AGENT_MODEL, sem tocar em código —
    # é o botão de custo desta plataforma. Qualquer modelo do OpenRouter que
    # suporte TOOL CALLING serve; sem tool calling o agente não funciona, porque
    # ele é proibido de responder número sem consultar o painel.
    # Alternativas já compatíveis com este mesmo contrato:
    # deepseek/deepseek-v4-flash-0731, openai/gpt-5.6-luna, anthropic/claude-sonnet-5.
    agent_model: str = "google/gemini-3.6-flash"
    # Teto por requisição: o cliente controla o conteúdo da conversa, então o
    # custo do upstream precisa de limite aqui. Estourar o teto NÃO derruba a
    # conversa — o servidor descarta as mensagens mais antigas e segue (ver
    # trim_conversation). Estes números são, portanto, controle de CUSTO por
    # pergunta, não uma trava de uso: quanto menor, mais barata e mais curta de
    # memória fica cada consulta. Ajustáveis por AGENT_MAX_MESSAGES e
    # AGENT_MAX_CHARS.
    agent_max_messages: int = Field(default=40, ge=2, le=200)
    agent_max_chars: int = Field(default=60_000, ge=500, le=400_000)
    agent_max_output_tokens: int = Field(default=1024, ge=64, le=8192)
    agent_timeout_seconds: float = Field(default=30.0, ge=1.0, le=120.0)
    # Mesmo espírito de login_max_attempts/login_window_minutes, por usuário.
    agent_max_requests: int = Field(default=20, ge=1, le=500)
    agent_window_minutes: int = Field(default=10, ge=1, le=120)

    @field_validator("cookie_domain", mode="before")
    @classmethod
    def empty_cookie_domain_is_none(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("openrouter_api_key", mode="before")
    @classmethod
    def blank_api_key_is_none(cls, value: object) -> object:
        # OPENROUTER_API_KEY="" no Railway chega como string vazia; tratar como
        # ausente evita mandar "Bearer " para o upstream e tomar 401.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("openrouter_base_url")
    @classmethod
    def base_url_must_be_http(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        if not normalized.startswith(("http://", "https://")):
            raise ValueError("OPENROUTER_BASE_URL precisa começar com http:// ou https://.")
        return normalized

    @property
    def agent_enabled(self) -> bool:
        # Derivado, nunca configurável: ligar o agente sem chave só produziria 502.
        return self.openrouter_api_key is not None

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def allowed_host_list(self) -> list[str]:
        return [item.strip() for item in self.allowed_hosts.split(",") if item.strip()]

    def validate_runtime_security(self) -> None:
        if self.app_env != "production":
            return
        if self.database_url.startswith("sqlite"):
            raise RuntimeError("Produção exige PostgreSQL; SQLite é somente local/teste.")
        lowered_secret = self.session_secret.casefold()
        if len(self.session_secret) < 48 or any(
            marker in lowered_secret
            for marker in ("development", "change", "substitua", "gere_uma")
        ):
            raise RuntimeError(
                "Defina SESSION_SECRET aleatório com pelo menos 48 caracteres em produção."
            )
        if not self.cookie_secure:
            raise RuntimeError("COOKIE_SECURE deve ser true em produção.")
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise RuntimeError("COOKIE_SAMESITE=none exige COOKIE_SECURE=true.")
        if "*" in self.cors_origin_list:
            raise RuntimeError("CORS_ORIGINS não pode usar '*' com credenciais.")
        if not self.allowed_host_list or "*" in self.allowed_host_list:
            raise RuntimeError(
                "ALLOWED_HOSTS deve listar os hosts públicos em produção; "
                "'*' desliga o TrustedHostMiddleware."
            )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime_security()
    return settings
