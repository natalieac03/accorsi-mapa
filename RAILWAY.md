# Deploy no Railway

Três serviços dentro de um projeto: PostgreSQL (gerenciado pelo Railway,
não é o contêiner do `compose.prod.yaml`), `api` (backend) e `web` (frontend
+ Caddy, com domínio público).

## Por que é diferente do `compose.prod.yaml`

O `compose.prod.yaml` supõe que você controla a máquina: o Caddy termina TLS
sozinho, pede certificado ao Let's Encrypt, e por isso existe um
`Caddyfile` fixado na porta 80/443. O Railway já tem seu próprio proxy de
borda que termina HTTPS e encaminha HTTP simples para a porta que o
contêiner informa via `$PORT`. Por isso o serviço `web` usa arquivos
próprios: **`Caddyfile.railway`** e **`Dockerfile.railway`** — sem ACME,
escutando em `:{$PORT}`. Testei os dois de ponta a ponta contra o bundle
real antes de te passar os comandos.

## 0. Antes de tudo: subir para o GitHub

```bash
cd acquario-mapa
git init
git add .
git commit -m "Versão inicial do ACCORSI"
git branch -M main
git remote add origin https://github.com/natalieac03/accorsi-mapa.git
git push -u origin main
```

Se o GitHub pedir autenticação, use um token de acesso pessoal como senha
(o GitHub não aceita mais senha da conta em `git push` por HTTPS) ou
configure a CLI `gh` (`gh auth login`) antes.

## 1. Instale e autentique a CLI do Railway

```bash
npm install -g @railway/cli
railway login
```

## 2. Vincule o projeto que você já criou

```bash
railway link
```

Escolha o projeto na lista interativa.

## 3. Banco de dados

```bash
railway add --database postgres
```

Isso cria o serviço `Postgres` com `DATABASE_URL` gerado automaticamente.
**Não** use o `postgres:16-alpine` do `compose.prod.yaml` aqui — o Postgres
gerenciado do Railway já cuida de backup e volume.

## 4. Crie os dois serviços a partir do GitHub

```bash
railway add --repo natalieac03/accorsi-mapa
railway add --repo natalieac03/accorsi-mapa
```

Rode duas vezes — uma para `api`, uma para `web`. A CLI vai pedir um nome
para cada serviço; use exatamente `api` e `web` (as referências de variável
abaixo dependem desses nomes).

## 5. Root directory e Dockerfile de cada serviço — só dá no painel

Isto é a única parte que não tem comando de CLI hoje (é uma limitação
conhecida da CLI do Railway, não falta de comando seu). No painel:

**Serviço `api`** → Settings → Build:
- Root Directory: `backend`
- Dockerfile Path: `Dockerfile` (o padrão já resolve, porque com a raiz
  apontando para `backend` o arquivo fica em `backend/Dockerfile`)

**Serviço `web`** → Settings → Build:
- Root Directory: `/` (raiz do repositório)
- Dockerfile Path: `Dockerfile.railway` — **não** o `Dockerfile` comum, que
  tenta emitir certificado próprio e não vai subir atrás do proxy do Railway.

## 6. Variáveis do serviço `api`

```bash
railway variable set --service api APP_ENV=production
railway variable set --service api DATABASE_URL='${{Postgres.DATABASE_URL}}'
railway variable set --service api SESSION_SECRET="$(openssl rand -hex 32)"
railway variable set --service api SESSION_HOURS=8
railway variable set --service api COOKIE_SECURE=true
railway variable set --service api COOKIE_SAMESITE=lax
railway variable set --service api DOCS_ENABLED=false
railway variable set --service api LOGIN_MAX_ATTEMPTS=5
railway variable set --service api LOGIN_WINDOW_MINUTES=15
railway variable set --service api PORT=8000
# Agente de perguntas — opcional. Sem a chave o app sobe igual, só o botão
# do agente some no painel (o frontend consulta GET /api/v1/agent/status).
railway variable set --service api OPENROUTER_API_KEY="sua_chave_do_openrouter"
railway variable set --service api AGENT_MODEL=google/gemini-3.6-flash
# Vazio de propósito: SPA e API na mesma origem via Caddy, sem CORS.
railway variable set --service api CORS_ORIGINS=""
# Referencia o domínio público que o Railway ainda vai gerar para "web"
# no passo 8 — pode configurar agora, o valor resolve sozinho depois.
railway variable set --service api ALLOWED_HOSTS='${{web.RAILWAY_PUBLIC_DOMAIN}}'
```

Sobre `FORWARDED_ALLOW_IPS`: no `compose.prod.yaml` eu fixei o IP exato do
Caddy porque a rede é sua e um valor errado deixaria qualquer cliente forjar
`X-Forwarded-For`. No Railway isso não se aplica — o serviço `api` não tem
domínio público (passo 5 não deu Root Directory + domínio a ele), então
**nada fora do projeto consegue falar com ele diretamente**; o único cliente
possível é o próprio `web` via rede privada. Nesse desenho específico é
seguro confiar em qualquer origem:

```bash
railway variable set --service api FORWARDED_ALLOW_IPS="*"
```

## 7. Variáveis do serviço `web`

```bash
railway variable set --service web VITE_GOOGLE_MAPS_API_KEY="sua_chave_aqui"
railway variable set --service web VITE_GOOGLE_MAPS_MAP_ID=""
railway variable set --service web VITE_AUTH_REQUIRED=true
railway variable set --service web VITE_API_BASE_URL="/api/v1"
railway variable set --service web VITE_REGISTRATIONS_MODE=api
railway variable set --service web API_UPSTREAM='${{api.RAILWAY_PRIVATE_DOMAIN}}:8000'
```

`API_UPSTREAM` usa a porta 8000 porque foi isso que fixamos com
`PORT=8000` no serviço `api` no passo 6 — os dois valores precisam bater.

## 7b. Ligar e desligar a tela de login (modo demonstração)

Para mostrar a plataforma rápido, sem criar usuário e sem digitar senha,
existe um par de variáveis. **As duas precisam ter o mesmo valor.**

| Variável | Serviço | O que faz |
|---|---|---|
| `VITE_AUTH_REQUIRED` | `web` | `false` pula a tela de login e mostra o selo "Modo local" no lugar do menu de usuário |
| `AUTH_REQUIRED` | `api` | `false` faz a API aceitar requisição sem cookie de sessão, valendo como o usuário `demonstracao@local` |

Ligar a demonstração (sem login):

```bash
railway variable set --service web VITE_AUTH_REQUIRED=false
railway variable set --service api AUTH_REQUIRED=false
railway up --service web
```

Voltar ao normal (com login):

```bash
railway variable set --service web VITE_AUTH_REQUIRED=true
railway variable set --service api AUTH_REQUIRED=true
railway up --service web
```

O `railway up --service web` é obrigatório porque variável `VITE_` é lida
pelo Vite na hora do build e fica gravada dentro do JavaScript publicado.
Trocar a variável sem rebuildar não muda nada na tela. Já o `AUTH_REQUIRED`
do `api` é lido em tempo de execução: o Railway reinicia o serviço sozinho ao
salvar a variável, sem rebuild.

Três coisas para saber antes de usar:

1. **Trocar só a do `web` quebra o painel.** A tela de login some, mas toda
   chamada de API volta 401, e cadastro de apoiadores e agente param.
2. **Com `AUTH_REQUIRED=false` a instalação fica pública.** Qualquer pessoa
   com o endereço vê os dados e consegue criar, editar e apagar cadastro de
   apoiador. Deixe ligado só durante a demonstração.
3. **O usuário de demonstração tem perfil `coordinator`**, então não
   administra usuários nem lê o log de auditoria. A conta é criada sozinha no
   primeiro acesso, com senha impossível de casar: ela não serve para entrar
   pela tela de login depois que o modo for desligado.

## 8. Domínio público — só o `web`

```bash
railway domain --service web
```

O `api` fica sem domínio de propósito: só quem está na rede privada do
projeto alcança ele.

## 9. Suba

Com o repositório conectado, todo `git push` para `main` já dispara o
deploy dos dois serviços automaticamente. Para forçar um deploy manual sem
esperar o push:

```bash
railway up --service api
railway up --service web
```

O `start.sh` do backend roda `alembic upgrade head` antes de subir o
uvicorn — as migrações aplicam sozinhas a cada deploy.

## 10. Carregar os dados e criar o primeiro usuário

`railway ssh` abre um shell dentro do contêiner já rodando no Railway. Como
a Root Directory do serviço `api` é `backend/`, a imagem não contém
`src/data/` — por isso o repositório já traz uma cópia desses arquivos em
`backend/data/` (ver `backend/data/LEIAME.md`), e os comandos abaixo apontam
para lá:

```bash
railway ssh --service api -- python -m app.cli seed-municipalities \
  --file data/electorate-go.json
railway ssh --service api -- python -m app.cli import-ibge-indicators \
  --file data/socioeconomic-go.json
railway ssh --service api -- python -m app.cli import-tse-history \
  --file data/election-history-go.json
railway ssh --service api -- python -m app.cli import-party-spectrum \
  --file data/party-spectrum.json
railway ssh --service api -- python -m app.cli create-user \
  --email voce@exemplo.org --name "Seu Nome" --role admin
```

Esse último comando pede a senha interativamente no seu terminal (dois
prompts, com confirmação) — o `railway ssh` mantém isso funcionando porque
aloca um terminal de verdade quando você roda direto no seu shell. Se
preferir sem prompt, defina a senha numa variável de ambiente e passe
`--password-env NOME_DA_VARIAVEL`.

## 10b. O contrato de ferramentas do agente

O agente não tem lista de ferramentas no código: ele lê
`shared/agent-tools.json`, o mesmo arquivo que o frontend usa para executar as
consultas. Vale aqui o problema dos snapshots do passo 10 — a Root Directory do
serviço `api` é `backend/`, então `shared/` fica fora da imagem. Por isso o
repositório mantém uma cópia em `backend/data/agent-tools.json` e o backend
procura nos dois caminhos, **preferindo `shared/` quando existe** (é a fonte da
verdade fora do Railway).

Sempre que `shared/agent-tools.json` mudar, copie antes do commit:

```bash
cp shared/agent-tools.json backend/data/agent-tools.json
```

Se nenhuma das duas cópias existir, `POST /api/v1/agent/chat` responde 503
dizendo exatamente isso — nunca uma lista de ferramentas desatualizada
escondida no código.

## 11. Verificação depois do primeiro deploy

```bash
railway logs --service api
railway logs --service web
curl -sI https://SEU-DOMINIO.up.railway.app/           # 200, HTML
curl -sI https://SEU-DOMINIO.up.railway.app/docs        # 404
curl -s  https://SEU-DOMINIO.up.railway.app/health/ready
```

Para conferir o agente (precisa de sessão; use o painel ou um cookie válido):
`GET /api/v1/agent/status` devolve `{"enabled":true,"model":"..."}` quando
`OPENROUTER_API_KEY` chegou ao contêiner. A chave em si nunca aparece em
resposta nem em log.

Se `/docs` responder 200 em vez de 404, o serviço `web` ainda está usando o
`Dockerfile` errado — confira o passo 5.

## O que muda de verdade em relação ao guia de VPS própria

| | `compose.prod.yaml` (VPS) | Railway |
|---|---|---|
| Banco | contêiner Postgres seu, com backup por sua conta | Postgres gerenciado |
| TLS | Caddy pede certificado sozinho | proxy do Railway termina TLS |
| Dockerfile do web | `Dockerfile` | `Dockerfile.railway` |
| Caddyfile | `Caddyfile` | `Caddyfile.railway` |
| Rede interna | rede Docker com IP fixo do Caddy | rede privada do Railway, `*.railway.internal` |
| `FORWARDED_ALLOW_IPS` | IP exato do Caddy | `*` — seguro porque `api` não é público |
| Deploy | `docker compose up -d --build` | push no `main` |

O restante — CSP em modo relatório, um único worker do uvicorn, DOCS_ENABLED
desligado, a mesma origem para SPA e API — é idêntico ao guia de VPS e está
detalhado em [`DEPLOY.md`](DEPLOY.md).
