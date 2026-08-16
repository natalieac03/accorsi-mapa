# Backend ACCORSI

API FastAPI com PostgreSQL, migrações Alembic, autenticação por sessão e
controle de acesso por perfil. A API não oferece cadastro público.

## O que está implementado

- sessão opaca armazenada somente por hash no banco;
- cookie de sessão `HttpOnly` e proteção CSRF de duplo envio;
- senha com Argon2 e política mínima de complexidade;
- expiração e revogação de sessões;
- limitação de tentativas de login por IP + e-mail;
- perfis `admin`, `coordinator`, `analyst` e `field`;
- gestão de usuários restrita a administrador;
- trilha de auditoria de login, logout, senha e gestão de usuários;
- catálogo autenticado dos 246 municípios;
- catálogo autenticado de nove indicadores oficiais do IBGE;
- valores normalizados por município, indicador e ano de referência;
- oito pleitos oficiais de Presidente e Governador em 2018/2022;
- candidaturas, totais estaduais e resultados agregados nos 246 municípios;
- séries autenticadas por candidatura e histórico completo por município;
- cadastros geocodificados minimizados, sem CEP completo ou identidade pessoal;
- listagem sanitizada, resumo agregado, criação, importação e revogação;
- limiar de cinco registros para grupos de bairro/prefixo de CEP;
- espectro ideológico dos partidos por onda do survey, com notas de 0 a 10;
- siglas históricas casadas por alias único, como PR→PL e PRB→Republicanos;
- índice ideológico municipal ponderado por votos, agregado no banco;
- partidos sem nota na onda ficam fora do índice e são reportados à parte;
- registro auditável das cargas de dados, com SHA-256;
- health checks de processo e banco;
- CORS, hosts permitidos, request ID e cabeçalhos de segurança;
- migração inicial reproduzível em SQLite e PostgreSQL/Neon.

## Desenvolvimento local com SQLite

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
cp .env.example .env
.venv/bin/alembic upgrade head
.venv/bin/python -m app.cli seed-municipalities \
  --file ../src/data/electorate-go.json
.venv/bin/python -m app.cli import-ibge-indicators \
  --file ../src/data/socioeconomic-go.json
.venv/bin/python -m app.cli import-tse-history \
  --file ../src/data/election-history-go.json
.venv/bin/python -m app.cli import-registration-demo \
  --file ../src/data/campaign-registrations-demo.json
.venv/bin/python -m app.cli import-party-spectrum \
  --file ../src/data/party-spectrum.json
.venv/bin/python -m app.cli create-admin \
  --email admin@exemplo.com --name "Admin ACCORSI"
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Para usar SQLite, troque no `.env`:

```env
DATABASE_URL=sqlite:///./acqr_dev.db
```

Documentação interativa: `http://localhost:8000/docs`. Health checks:
`/health/live` e `/health/ready`.

## Desenvolvimento local com Docker

Na raiz do projeto:

```bash
docker compose up -d db api
docker compose exec api python -m app.cli seed-municipalities \
  --file /data/electorate-go.json
docker compose exec api python -m app.cli import-ibge-indicators \
  --file /data/socioeconomic-go.json
docker compose exec api python -m app.cli import-tse-history \
  --file /data/election-history-go.json
docker compose exec api python -m app.cli import-party-spectrum \
  --file /data/party-spectrum.json
docker compose exec api python -m app.cli create-admin \
  --email admin@exemplo.com --name "Admin ACCORSI"
```

As credenciais do `compose.yaml` são apenas locais.

## Neon / produção

1. Crie o banco PostgreSQL no Neon e copie a conexão com SSL para
   `DATABASE_URL` no serviço da API.
2. Gere `SESSION_SECRET` aleatório com pelo menos 48 caracteres:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

3. Configure `APP_ENV=production`, `COOKIE_SECURE=true`, os domínios exatos em
   `CORS_ORIGINS` e os hosts sem protocolo em `ALLOWED_HOSTS`.
4. Use preferencialmente frontend e API no mesmo site. Se forem origens
   realmente cruzadas, configure HTTPS, `COOKIE_SAMESITE=none` e avalie as
   restrições de cookies de terceiros do navegador.
5. Execute `alembic upgrade head`, carregue municípios, indicadores IBGE,
   histórico TSE e espectro partidário, e crie o primeiro administrador. O `start.sh` já aplica a
   migração antes de iniciar o Uvicorn.

Nunca coloque a senha do Neon, `SESSION_SECRET` ou senha do administrador no
GitHub, no frontend ou no ZIP distribuído.

## Perfis

| Perfil | Mapa e municípios | Status de cargas | Gestão de usuários | Auditoria |
| --- | --- | --- | --- | --- |
| `admin` | Sim | Sim | Sim | Sim |
| `coordinator` | Sim | Sim | Não | Não |
| `analyst` | Sim | Sim | Não | Não |
| `field` | Sim | Não | Não | Não |

## Rotas principais

| Método | Rota | Proteção |
| --- | --- | --- |
| `POST` | `/api/v1/auth/login` | Limite de tentativas |
| `GET` | `/api/v1/auth/me` | Sessão |
| `POST` | `/api/v1/auth/logout` | Sessão + CSRF |
| `POST` | `/api/v1/auth/change-password` | Sessão + CSRF |
| `GET` | `/api/v1/municipalities` | Sessão |
| `GET` | `/api/v1/municipalities/{ibge}/indicators` | Sessão |
| `GET` | `/api/v1/indicators` | Sessão |
| `GET` | `/api/v1/indicators/{codigo}/municipalities` | Sessão |
| `GET` | `/api/v1/elections` | Sessão |
| `GET` | `/api/v1/elections/{pleito}/candidates/{tse_id}/municipalities` | Sessão |
| `GET` | `/api/v1/municipalities/{ibge}/elections` | Sessão |
| `GET` | `/api/v1/spectrum/parties` | Sessão |
| `GET` | `/api/v1/spectrum/municipalities?contest_id=` | Sessão |
| `GET` | `/api/v1/spectrum/contests` | Sessão |
| `GET/POST/PATCH` | `/api/v1/users` | Administrador; escrita com CSRF |
| `GET` | `/api/v1/imports` | Admin/coordenação/análise |
| `GET` | `/api/v1/audit` | Administrador |

## Operação e testes

```bash
.venv/bin/python -m pytest
.venv/bin/ruff check app tests
.venv/bin/python -m compileall -q app tests
.venv/bin/python -m app.cli purge-sessions
.venv/bin/python -m app.cli set-password --email usuario@exemplo.com
```

O limitador de login atual é suficiente para uma única instância da API. Se a
implantação ganhar várias réplicas, mova esse contador para Redis ou aplique
rate limiting no gateway para manter o limite compartilhado.
