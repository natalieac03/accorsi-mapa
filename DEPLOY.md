# Deploy do ACCORSI

Três contêineres: PostgreSQL, a API FastAPI e o Caddy servindo a SPA e fazendo
proxy reverso. Só o Caddy publica porta.

```
              :80 / :443
                   │
              ┌────▼─────┐
              │  Caddy   │  TLS automático · SPA em /srv · cabeçalhos
              │  (web)   │
              └──┬────┬──┘
       /api/*    │    │   demais rotas
       /health/* │    │
              ┌──▼──┐ └──► index.html (fallback da SPA)
              │ api │  FastAPI · uvicorn · migrações no boot
              └──┬──┘
              ┌──▼──┐
              │ db  │  PostgreSQL 16 · sem porta publicada
              └─────┘
```

## Por que origem única

SPA e API respondem no mesmo domínio. Isso não é conveniência de empacotamento,
resolve dois problemas concretos:

1. **Acaba o CORS.** `CORS_ORIGINS` fica vazio em produção. Não há requisição
   cross-origin a autorizar.
2. **Permite `SameSite=lax`.** O frontend lê o cookie CSRF via `document.cookie`,
   o que exige same-site. Com SPA e API em domínios separados o operador seria
   empurrado para `SameSite=none`, que abre a porta para login CSRF. Nessa
   topologia isso simplesmente não acontece.

Se um dia for preciso separar os domínios, preencha `CORS_ORIGINS` e leia antes
o comentário no topo do `Caddyfile`.

## Subir

```bash
cp .env.production.example .env.production
# preencha SITE_ADDRESS, SITE_HOST, ACME_EMAIL, senha do banco,
# SESSION_SECRET (openssl rand -hex 32) e a chave do Google Maps

docker compose -f compose.prod.yaml --env-file .env.production up -d --build
```

O `start.sh` roda `alembic upgrade head` antes de subir o uvicorn, então as
migrações aplicam sozinhas. Depois, carregue os dados e crie o primeiro usuário:

```bash
docker compose -f compose.prod.yaml --env-file .env.production exec api \
  python -m app.cli seed-municipalities --file /data/electorate-go.json
docker compose -f compose.prod.yaml --env-file .env.production exec api \
  python -m app.cli import-ibge-indicators --file /data/socioeconomic-go.json
docker compose -f compose.prod.yaml --env-file .env.production exec api \
  python -m app.cli import-tse-history --file /data/election-history-go.json
docker compose -f compose.prod.yaml --env-file .env.production exec api \
  python -m app.cli import-party-spectrum --file /data/party-spectrum.json
docker compose -f compose.prod.yaml --env-file .env.production exec api \
  python -m app.cli create-user --email voce@exemplo.org --name "Seu Nome" --role admin
```

Esse último comando pede a senha interativamente (dois prompts, com
confirmação). Para rodar sem prompt, defina a senha numa variável de
ambiente e passe `--password-env NOME_DA_VARIAVEL`.

> O `compose.prod.yaml` não monta `./src/data` por padrão, ao contrário do
> `compose.yaml` de desenvolvimento. Se for carregar os dados a partir do host,
> acrescente `- ./src/data:/data:ro` ao serviço `api` ou copie os arquivos com
> `docker compose cp`.

## A chave do Google Maps é pública

O Vite embute variáveis `VITE_*` no bundle em tempo de compilação. A chave
**fica visível** no JavaScript entregue ao navegador — é inerente ao Maps JS
API, não é defeito do projeto. Providências obrigatórias no Google Cloud
Console:

- restringir por referenciador HTTP ao domínio de produção;
- habilitar apenas Maps JavaScript API, Places API e Geocoding API;
- definir cota diária, para que uso indevido vire erro de cota e não fatura.

Trocar a chave exige rebuild da imagem `web`, não só reiniciar o contêiner.

## Agente de perguntas (opcional)

O agente é um relé sem estado para o OpenRouter: o modelo só escolhe qual
consulta chamar (tool calling), e quem calcula é o frontend, com os mesmos
motores que desenham o mapa. O backend não deriva número nenhum.

Variáveis do serviço `api` (todas opcionais menos a chave):

| Variável | Padrão | Para que serve |
|---|---|---|
| `OPENROUTER_API_KEY` | vazio | Liga o agente. Sem ela, `/api/v1/agent/chat` responde 503 e `/api/v1/agent/status` devolve `enabled:false`. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Precisa começar com `http://` ou `https://`. |
| `AGENT_MODEL` | `google/gemini-3.6-flash` | Alternativas: `deepseek/deepseek-v4-flash-0731`, `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`. |
| `AGENT_MAX_MESSAGES` | `30` | Mensagens por requisição; acima disso, 413. |
| `AGENT_MAX_CHARS` | `24000` | Caracteres somados da conversa; acima disso, 413. |
| `AGENT_MAX_OUTPUT_TOKENS` | `1024` | Teto de saída pedido ao provedor. |
| `AGENT_TIMEOUT_SECONDS` | `30` | Estouro vira 502. |
| `AGENT_MAX_REQUESTS` | `20` | Requisições por usuário na janela. |
| `AGENT_WINDOW_MINUTES` | `10` | Tamanho da janela; estouro vira 429. |

A chave fica só no servidor: não é embutida no bundle, não volta em resposta e
não vai para log — nem quando o provedor devolve um erro que ecoa a chave no
corpo (esse corpo é descartado e o cliente recebe só o código do erro).

O system prompt, o modelo, a temperatura e a lista de ferramentas são montados
pelo servidor. O corpo aceito é apenas `{"messages":[...]}` com papéis `user`,
`assistant` e `tool`; `system` é recusado com 400 e qualquer campo extra
(`model`, `temperature`, `tools`) é recusado com 422.

### O contrato de ferramentas

A lista de ferramentas nunca é hardcoded: vem de `shared/agent-tools.json`, o
mesmo arquivo lido pelo frontend. O backend procura em dois caminhos e prefere
o primeiro:

1. `shared/agent-tools.json` (raiz do repositório, fonte da verdade);
2. `backend/data/agent-tools.json` (cópia para o Railway, onde a Root Directory
   do serviço `api` é `backend/` e a pasta `shared/` não entra na imagem — o
   mesmo motivo dos snapshots descritos em `backend/data/LEIAME.md`).

Depois de qualquer mudança no contrato:

```bash
cp shared/agent-tools.json backend/data/agent-tools.json
```

Faltando as duas cópias, ou com `schemaVersion` diferente de 1, a rota responde
503 com a explicação. Falhar alto é proposital: um catálogo defasado faria o
modelo pedir consultas que o frontend não sabe executar.

### O limitador é por processo

O limite de `AGENT_MAX_REQUESTS` mora na memória do processo, igual ao de
login. Continua valendo o `--workers 1` do `start.sh`: com N workers o limite
efetivo vira N×20 e o custo no OpenRouter acompanha.

## CSP

O `Caddyfile` envia a política em **`Content-Security-Policy-Report-Only`**. O
Google Maps injeta script, estilo e imagem de vários domínios, e uma política
apertada demais quebra o mapa de um jeito silencioso. Rode alguns dias em modo
relatório, olhe o console do navegador, e só então renomeie o header para
`Content-Security-Policy`.

Origens que a aplicação realmente usa: `maps.googleapis.com`,
`maps.gstatic.com`, `servicodados.ibge.gov.br` (malha municipal) e
`viacep.com.br`.

## Por que um único worker

`start.sh` fixa `--workers 1` de propósito. O limitador de tentativas de login
guarda estado na memória do processo; com N workers o limite efetivo vira 5×N.
Só aumente depois de mover o limitador para armazenamento compartilhado
(Redis ou tabela no banco).

Pelo mesmo motivo, `FORWARDED_ALLOW_IPS` recebe o **IP exato** do Caddy
(`172.28.0.10`, fixado no `compose.prod.yaml`) e nunca `*`. Com `*`, qualquer
cliente forja `X-Forwarded-For` e anula o componente de IP do limite de login.

## O que foi verificado

Caddyfile validado com `caddy validate` e exercitado contra o bundle real:

| Verificação | Resultado |
|---|---|
| `/` e rota profunda (`/municipio/4314902`) | 200, servindo `index.html` |
| `/docs`, `/redoc`, `/openapi.json` | 404 |
| `/api/*` e `/health/*` | atravessam para o backend |
| `X-Forwarded-For` / `X-Real-IP` | chegam ao backend |
| `/assets/*` | `public, max-age=31536000, immutable` |
| `/index.html` | `no-cache` |
| `/api/*` | `no-store` preservado do backend, não sobrescrito pelo Caddy |
| Cabeçalhos | HSTS, nosniff, DENY, no-referrer, Permissions-Policy, COOP |
| Compressão | gzip/zstd ativos |
| `docker compose config` | válido |

Um defeito foi encontrado e corrigido nesse processo: o bloqueio de `/docs`
estava escrito como `respond` solto, que na ordem padrão de diretivas do Caddy
é avaliado **depois** do `handle` catch-all da SPA — `/docs` devolvia 200 com o
`index.html`. Agora é um bloco `handle` próprio, declarado antes dos demais.

Não foi possível subir a pilha completa aqui: o ambiente tem o cliente Docker
mas não o daemon. O `Caddyfile` foi testado de verdade; o `compose.prod.yaml` e
os dois `Dockerfile` foram validados por sintaxe e por inspeção.

## O que este deploy não resolve

Continua valendo o que está no parecer técnico:

- não há limite de requisição na borda (o Caddy só oferece isso com plugin);
- o limitador de login continua em memória, por processo;
- não há backup automatizado do PostgreSQL — configure `pg_dump` agendado
  antes de entrar dado real;
- não há coleta de log centralizada; o `json-file` está limitado a 10 MB × 5
  por contêiner só para não encher o disco;
- o limitador do agente é por processo e por usuário, não tem teto de gasto
  agregado — se precisar de orçamento fixo, configure o limite de crédito na
  própria conta do OpenRouter.
