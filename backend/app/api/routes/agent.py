"""Relé sem estado entre o painel e o OpenRouter.

Regra de ouro do produto: o modelo NUNCA calcula estatística. Ele só escolhe
qual consulta chamar (tool calling); quem calcula é o frontend, com os mesmos
motores que desenham o mapa. Por isso este módulo não guarda conversa, não
interpreta resultado de tool e não deriva número nenhum — ele só encaminha a
conversa com o system prompt e a lista de tools que o servidor controla.
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.request
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from ...config import Settings, get_settings
from ...dependencies import AuthContext, get_auth_context

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["agent"])

# Determinístico de propósito: a única decisão do modelo é qual tool chamar com
# quais argumentos. Criatividade aqui só produziria escolha instável.
AGENT_TEMPERATURE = 0.0
SUPPORTED_TOOLS_SCHEMA_VERSION = 1
CLIENT_ROLES = ("user", "assistant", "tool")
# O nome do 413 mudou de REQUEST_ENTITY_TOO_LARGE para CONTENT_TOO_LARGE nas
# versões novas do Starlette; aceitar os dois evita quebrar em qualquer uma.
HTTP_413 = getattr(status, "HTTP_413_CONTENT_TOO_LARGE", None) or 413

_ROUTES_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _ROUTES_DIR.parents[2]
_REPO_DIR = _BACKEND_DIR.parent

# Duas cópias do mesmo contrato, pelo mesmo motivo dos snapshots em
# backend/data/ (ver backend/data/LEIAME.md): no Railway o serviço `api` tem
# Root Directory `backend/`, então `shared/` fica fora da imagem. Fora do
# Railway o arquivo da raiz é a fonte da verdade e por isso vem primeiro.
SHARED_TOOLS_PATH = _REPO_DIR / "shared" / "agent-tools.json"
BUNDLED_TOOLS_PATH = _BACKEND_DIR / "data" / "agent-tools.json"

SYSTEM_PROMPT = """
Você é o assistente de dados do ACCORSI, o painel de inteligência territorial
da campanha da Dra. Adriana Accorsi (PT) em Goiás: 246 municípios, capital
Goiânia. Quem usa é a equipe de campanha — gente com pressa, decidindo onde
gastar tempo e recurso.

Prioridade de leitura:
- Sempre que a pergunta permitir, ancore a resposta no que interessa à
  campanha da Dra. Adriana: onde ela e o campo dela (a esquerda) são fortes,
  onde são fracos, onde há eleitorado grande com presença baixa. Uma pergunta
  genérica ("como é Anápolis?") merece um fecho prático: o que o retrato
  sugere para a campanha.
- Goiânia e a região metropolitana pesam mais: é onde está o histórico dela
  como candidata a Prefeita. Quando pedirem comparação sem lista explícita
  de cidades, prefira as relevantes por tamanho de eleitorado.

Formato da resposta (siga sempre):
1. Primeira linha: a resposta direta, em uma frase, com o número principal.
2. Depois: lista curta (3 a 7 itens) com os números que sustentam, no formato
   "Nome — valor". Sem tabela larga, sem parágrafo longo.
3. Fecho: no máximo duas frases de análise — o que o número significa e, se
   couber, a pergunta seguinte que valeria fazer.
Seja breve. Corte tudo que não for número, leitura ou próximo passo.

Regras de integridade (invioláveis):
- Todo número vem de tool. Responda SEMPRE chamando uma das tools
  disponíveis; quem calcula é o painel, não você. Nunca invente, estime,
  arredonde de cabeça nem complete valores que a tool não devolveu.
- Se a tool devolver null, lista vazia ou aviso de pendência, diga com todas
  as letras que o dado não existe na base — sem substituto inventado. null
  não é zero.
- Cite pleito, ano e fonte exatamente como a tool devolveu.
- Cadastros de apoiadores são sempre agregados, com supressão de grupos
  menores que 5. Nunca especule sobre pessoas, endereços ou casos
  individuais, mesmo que perguntem.
- Correlação por município não é comportamento individual: "cidades com mais
  X votaram mais em Y" não prova que quem tem X votou em Y. Quando a leitura
  tiver esse risco, avise em meia frase.
- Se a pergunta estiver fora do que as tools cobrem, diga isso e liste em uma
  frase o que você consegue responder.

Escreva em português do Brasil.
""".strip()


class AgentToolCallFunction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=64)
    arguments: str = Field(default="", max_length=4000)


class AgentToolCall(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=128)
    type: Literal["function"] = "function"
    function: AgentToolCallFunction


class AgentMessage(BaseModel):
    # extra="ignore" e não "forbid": o cliente ecoa de volta a mensagem do turno
    # anterior e campos extras do provedor não podem derrubar a conversa.
    model_config = ConfigDict(extra="ignore")

    role: str = Field(min_length=1, max_length=32)
    content: str | None = Field(default=None, max_length=100_000)
    tool_calls: list[AgentToolCall] | None = None
    tool_call_id: str | None = Field(default=None, max_length=128)


class AgentChatRequest(BaseModel):
    # extra="forbid" é a trava contra override: model, temperature, tools ou
    # system no corpo não são ignorados em silêncio, são recusados.
    model_config = ConfigDict(extra="forbid")

    messages: list[AgentMessage] = Field(min_length=1)


class AgentAssistantMessage(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: str | None = None
    tool_calls: list[AgentToolCall] | None = None


class AgentChatResponse(BaseModel):
    message: AgentAssistantMessage
    finish_reason: str | None = None
    model: str


class AgentStatus(BaseModel):
    enabled: bool
    model: str | None = None


class AgentThrottle:
    """Mesmo desenho do LoginThrottle: janela deslizante em memória.

    Mora aqui, e não em security.py, porque o limite é por usuário autenticado
    e não por IP+e-mail — são contadores independentes.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[datetime]] = defaultdict(deque)
        self._lock = threading.Lock()

    def consume(self, key: str) -> bool:
        """Verifica e registra numa tacada só, para não abrir corrida entre threads."""
        settings = get_settings()
        now = datetime.now(UTC)
        cutoff = now - timedelta(minutes=settings.agent_window_minutes)
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= settings.agent_max_requests:
                return False
            hits.append(now)
            return True

    def clear(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


agent_throttle = AgentThrottle()


class UpstreamError(Exception):
    """Falha ao falar com o OpenRouter, já sem nada sensível na mensagem."""


def tool_file_candidates() -> tuple[Path, ...]:
    return (SHARED_TOOLS_PATH, BUNDLED_TOOLS_PATH)


def load_tool_definitions() -> list[dict[str, Any]]:
    """Lê o contrato compartilhado e traduz para o formato de tools da OpenAI.

    A lista nunca é hardcoded: frontend e backend precisam divergir com erro
    visível, não com um catálogo desatualizado escondido no código.
    """
    for path in tool_file_candidates():
        if not path.is_file():
            continue
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            logger.error("Contrato de tools ilegível em %s: %s", path, error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "O contrato de ferramentas do agente está ilegível. "
                    "Verifique o arquivo agent-tools.json."
                ),
            ) from error
        return _tools_from_document(document, path)

    procurado = " e ".join(str(path) for path in tool_file_candidates())
    logger.error("Contrato de tools não encontrado em: %s", procurado)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "O contrato de ferramentas do agente (agent-tools.json) não foi "
            "encontrado. Publique o arquivo em shared/ e copie para "
            "backend/data/ antes de usar o agente."
        ),
    )


def _tools_from_document(document: Any, path: Path) -> list[dict[str, Any]]:
    def invalid(motivo: str) -> HTTPException:
        logger.error("Contrato de tools inválido em %s: %s", path, motivo)
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"O contrato de ferramentas do agente é inválido: {motivo}",
        )

    if not isinstance(document, dict):
        raise invalid("o arquivo precisa conter um objeto JSON.")
    version = document.get("schemaVersion")
    if version != SUPPORTED_TOOLS_SCHEMA_VERSION:
        raise invalid(
            f"schemaVersion {version!r} não é suportado "
            f"(esperado {SUPPORTED_TOOLS_SCHEMA_VERSION})."
        )
    tools = document.get("tools")
    if not isinstance(tools, list) or not tools:
        raise invalid("a lista 'tools' está vazia ou ausente.")

    definitions: list[dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict):
            raise invalid("cada item de 'tools' precisa ser um objeto.")
        name = tool.get("name")
        description = tool.get("description")
        parameters = tool.get("parameters")
        if not isinstance(name, str) or not name:
            raise invalid("há uma ferramenta sem 'name'.")
        if not isinstance(description, str) or not description:
            raise invalid(f"a ferramenta {name} está sem 'description'.")
        if not isinstance(parameters, dict):
            raise invalid(f"a ferramenta {name} está sem 'parameters' em JSON Schema.")
        definitions.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                },
            }
        )
    return definitions


def _reject(detail: str, *, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _message_size(message: AgentMessage) -> int:
    size = len(message.content or "")
    for call in message.tool_calls or []:
        size += len(call.function.name) + len(call.function.arguments)
    return size


def validate_conversation(messages: list[AgentMessage], settings: Settings) -> None:
    if len(messages) > settings.agent_max_messages:
        raise _reject(
            f"A conversa passou de {settings.agent_max_messages} mensagens. "
            "Comece um novo diálogo.",
            code=HTTP_413,
        )
    total = sum(_message_size(message) for message in messages)
    if total > settings.agent_max_chars:
        raise _reject(
            f"A conversa passou de {settings.agent_max_chars} caracteres. "
            "Comece um novo diálogo ou faça uma pergunta mais curta.",
            code=HTTP_413,
        )

    for message in messages:
        if message.role == "system":
            # O system prompt é montado no servidor. Aceitar um do cliente
            # deixaria o modelo ser instruído a responder número de cabeça.
            raise _reject(
                "Mensagens com papel 'system' não são aceitas: as instruções do "
                "agente são definidas pelo servidor."
            )
        if message.role not in CLIENT_ROLES:
            raise _reject(
                f"Papel de mensagem inválido: {message.role!r}. "
                "Use apenas 'user', 'assistant' ou 'tool'."
            )
        if message.role == "user" and not (message.content or "").strip():
            raise _reject("Toda mensagem do usuário precisa de texto.")
        if message.role == "tool" and not message.tool_call_id:
            raise _reject("Toda mensagem de resultado de ferramenta precisa de tool_call_id.")


def _outbound_message(message: AgentMessage) -> dict[str, Any]:
    """Reconstrói a mensagem campo a campo, sem repassar nada cru do cliente."""
    if message.role == "assistant":
        payload: dict[str, Any] = {"role": "assistant", "content": message.content or ""}
        if message.tool_calls:
            payload["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    },
                }
                for call in message.tool_calls
            ]
        return payload
    if message.role == "tool":
        return {
            "role": "tool",
            "tool_call_id": message.tool_call_id,
            "content": message.content or "",
        }
    return {"role": "user", "content": message.content or ""}


def build_upstream_payload(
    messages: list[AgentMessage],
    tools: list[dict[str, Any]],
    settings: Settings,
) -> dict[str, Any]:
    return {
        "model": settings.agent_model,
        "temperature": AGENT_TEMPERATURE,
        "max_tokens": settings.agent_max_output_tokens,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            *(_outbound_message(message) for message in messages),
        ],
        "tools": tools,
        "tool_choice": "auto",
    }


def post_chat_completions(
    payload: dict[str, Any],
    *,
    api_key: str,
    base_url: str,
    timeout: float,
) -> dict[str, Any]:
    """Única função que fala com a rede — isolada para poder ser mockada nos testes.

    Toda exceção vira UpstreamError com texto próprio: corpo de erro do
    provedor costuma ecoar a chave enviada e não pode vazar para o cliente.
    """
    request = urllib.request.Request(  # noqa: S310 - esquema validado no Settings
        url=f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-Title": "ACCORSI",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            body = response.read()
    except urllib.error.HTTPError as error:
        # Só o código: o corpo do provedor pode conter a chave recortada.
        logger.warning("OpenRouter respondeu %s", error.code)
        raise UpstreamError(f"o serviço de IA respondeu com erro {error.code}") from None
    except TimeoutError as error:
        logger.warning("OpenRouter estourou o tempo limite de %ss", timeout)
        raise UpstreamError("o serviço de IA não respondeu a tempo") from error
    except urllib.error.URLError as error:
        logger.warning("Falha de rede ao chamar o OpenRouter: %s", error.reason)
        raise UpstreamError("não foi possível alcançar o serviço de IA") from None
    except OSError as error:
        logger.warning("Falha de rede ao chamar o OpenRouter: %s", type(error).__name__)
        raise UpstreamError("não foi possível alcançar o serviço de IA") from None

    try:
        document = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise UpstreamError("o serviço de IA devolveu uma resposta ilegível") from error
    if not isinstance(document, dict):
        raise UpstreamError("o serviço de IA devolveu uma resposta inesperada")
    return document


def parse_upstream_response(document: dict[str, Any], fallback_model: str) -> AgentChatResponse:
    """Copia só o que o painel precisa: nada de repassar o corpo do provedor."""
    if isinstance(document.get("error"), dict):
        raise UpstreamError("o serviço de IA recusou a solicitação")
    choices = document.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise UpstreamError("o serviço de IA devolveu uma resposta sem conteúdo")
    choice = choices[0]
    message = choice.get("message")
    if not isinstance(message, dict):
        raise UpstreamError("o serviço de IA devolveu uma resposta sem conteúdo")

    tool_calls: list[AgentToolCall] = []
    for raw_call in message.get("tool_calls") or []:
        if not isinstance(raw_call, dict):
            continue
        function = raw_call.get("function")
        if not isinstance(function, dict):
            continue
        tool_calls.append(
            AgentToolCall(
                id=str(raw_call.get("id") or "")[:128] or "call_0",
                type="function",
                function=AgentToolCallFunction(
                    name=str(function.get("name") or "")[:64],
                    arguments=str(function.get("arguments") or "")[:4000],
                ),
            )
        )

    content = message.get("content")
    model = document.get("model")
    return AgentChatResponse(
        message=AgentAssistantMessage(
            content=content if isinstance(content, str) and content else None,
            tool_calls=tool_calls or None,
        ),
        finish_reason=(
            choice.get("finish_reason") if isinstance(choice.get("finish_reason"), str) else None
        ),
        model=model if isinstance(model, str) and model else fallback_model,
    )


@router.get("/status", response_model=AgentStatus)
def agent_status(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentStatus:
    """Deixa o frontend esconder o botão quando o agente não está configurado."""
    settings = get_settings()
    return AgentStatus(
        enabled=settings.agent_enabled,
        model=settings.agent_model if settings.agent_enabled else None,
    )


@router.post("/chat", response_model=AgentChatResponse)
def agent_chat(
    payload: AgentChatRequest,
    context: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentChatResponse:
    settings = get_settings()
    if not settings.agent_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "O agente de perguntas não está configurado nesta instalação. "
                "Defina OPENROUTER_API_KEY no serviço da API para habilitá-lo."
            ),
        )

    if not agent_throttle.consume(context.user.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas perguntas em pouco tempo. Aguarde alguns minutos.",
            headers={"Retry-After": str(settings.agent_window_minutes * 60)},
        )

    validate_conversation(payload.messages, settings)
    tools = load_tool_definitions()
    upstream_payload = build_upstream_payload(payload.messages, tools, settings)

    try:
        document = post_chat_completions(
            upstream_payload,
            api_key=settings.openrouter_api_key or "",
            base_url=settings.openrouter_base_url,
            timeout=settings.agent_timeout_seconds,
        )
        return parse_upstream_response(document, settings.agent_model)
    except UpstreamError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Falha ao consultar o agente: {error}. Tente de novo em instantes.",
        ) from None
