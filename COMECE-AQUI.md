# Do zero ao ar — ACCORSI

Guia único, na ordem certa. Cada bloco é para copiar e colar no terminal.

**A ordem importa por um motivo específico:** os dados de Goiás entram no
_build_ do site (são importados pelo código, não buscados em tempo real). Se
você fizer o deploy antes de gerar os dados, o Railway vai publicar um app com
o mapa vazio. Então é: gerar → commitar → publicar.

Tempo aproximado: 40 min de download/processamento (etapa 2, sem supervisão) e
uns 20 min de configuração.

---

## 0. O que você precisa ter

| Item | Como conferir | Se faltar |
|---|---|---|
| Python 3.11+ | `python3.11 --version` | o `gerar_dados.sh` instala sozinho |
| Node 20+ | `node --version` | `sudo apt install nodejs npm` |
| Git | `git --version` | `sudo apt install git` |
| Conta no GitHub | — | github.com |
| Conta no Railway | — | railway.app |
| Chave do Google Maps | — | console.cloud.google.com |
| Chave do OpenRouter | — | openrouter.ai (opcional: sem ela o app sobe, só o agente fica escondido) |

Uns 6 GB livres em disco para os pacotes brutos do TSE.

---

## 1. Preparar a pasta

```bash
cd ~
unzip -o ~/Downloads/accorsi-aba.zip -d accorsi
cd accorsi
npm install
```

---

## 2. Gerar os dados de Goiás

Esta é a etapa longa. Ela baixa os pacotes do TSE, consulta o IBGE e processa
tudo — inclusive a trajetória das seis campanhas da Dra. Adriana.

```bash
bash gerar_dados.sh
```

Se a conexão cair, rode de novo: ele retoma de onde parou, sem rebaixar nada.

**Confira antes de seguir.** O script imprime um resumo no fim; os totais das
campanhas dela precisam bater com os oficiais:

| Eleição | Votos esperados |
|---|---|
| 2022 · Deputada Federal | 96.714 |
| 2024 · Prefeita de Goiânia | 168.145 |
| 2020 · Prefeita de Goiânia | 80.715 |

Se algum número divergir, **pare e me mande o resumo** — divergência aí
significa que o recorte está errado, e um painel de campanha com número errado
é pior do que painel nenhum.

---

## 3. Criar o repositório e subir

```bash
cd ~/accorsi
git init
git branch -M main
git add .
git commit -m "ACCORSI: inteligência territorial de Goiás"
```

Agora o repositório no GitHub. **Se você tem o `gh` instalado** (confira com
`gh --version`), é um comando só:

```bash
gh repo create accorsi-mapa --private --source=. --remote=origin --push
```

**Se não tem**, crie pela web: github.com/new → nome `accorsi-mapa` → Private
→ **não** marque nada em "Initialize this repository" → Create. Depois:

```bash
git remote add origin https://github.com/natalieac03/accorsi-mapa.git
git push -u origin main
```

> Deixe **privado**. O repositório vai conter dados de campanha e, mais adiante,
> a estrutura de cadastros de apoiadores.

---

## 4. Criar o projeto no Railway

```bash
npm i -g @railway/cli    # se ainda não tiver
railway login
cd ~/accorsi
railway init --name accorsi
railway add --database postgres
```

Agora os dois serviços do repositório:

```bash
railway add --repo natalieac03/accorsi-mapa --service api
railway add --repo natalieac03/accorsi-mapa --service web
```

---

## 5. Configurar os serviços (no painel do Railway)

Isso é no site, não no terminal — são campos de formulário.

**Serviço `api`** → aba Settings:

- Root Directory: `backend`
- Dockerfile Path: `Dockerfile`

**Serviço `web`** → aba Settings:

- Root Directory: `/` (a raiz)
- Dockerfile Path: `Dockerfile.railway` ← **atenção**, não é o `Dockerfile`
  comum. O comum é para servidor próprio e escuta na porta 80; o Railway
  precisa da porta que ele mesmo define.
- Networking → **Generate Domain** (é este o endereço público do site)

---

## 6. Variáveis de ambiente

```bash
cd ~/accorsi

# --- backend ---
railway variable set --service api APP_ENV=production
railway variable set --service api DATABASE_URL='${{Postgres.DATABASE_URL}}'
railway variable set --service api SESSION_SECRET="$(openssl rand -hex 32)"
railway variable set --service api SESSION_HOURS=8
railway variable set --service api COOKIE_SECURE=true
railway variable set --service api COOKIE_SAMESITE=lax
railway variable set --service api DOCS_ENABLED=false
railway variable set --service api PORT=8000
railway variable set --service api CORS_ORIGINS=""
railway variable set --service api ALLOWED_HOSTS='${{web.RAILWAY_PUBLIC_DOMAIN}}'
railway variable set --service api FORWARDED_ALLOW_IPS="*"

# --- agente de perguntas (opcional) ---
railway variable set --service api OPENROUTER_API_KEY="sua_chave_do_openrouter"
railway variable set --service api AGENT_MODEL=google/gemini-3.6-flash

# --- frontend ---
railway variable set --service web VITE_GOOGLE_MAPS_API_KEY="sua_chave_do_maps"
railway variable set --service web API_UPSTREAM='${{api.RAILWAY_PRIVATE_DOMAIN}}:8000'

# --- modo demonstração: a tela de login pede só a senha ---
railway variable set --service web VITE_DEMO_EMAIL=demo@accorsi.local
railway variable set --service web VITE_REGISTRATIONS_MODE=demo
```

`CORS_ORIGINS` vazio é proposital: o site e a API respondem no **mesmo
endereço**, então não existe requisição entre origens para liberar. É o que
permite o cookie de sessão ser `SameSite=lax` e fecha a porta de CSRF no login.

Na chave do Google Maps, restrinja por referenciador HTTP para o domínio que o
Railway gerou e ative cota diária — ela fica visível no navegador por natureza.

---

## 7. Publicar

```bash
railway up --service api
railway up --service web
```

Acompanhe com `railway logs --service web`. Se der 502, quase sempre é o
Dockerfile Path do passo 5 apontando para o arquivo errado.

---

## 8. Criar o banco e o primeiro acesso

```bash
railway ssh --service api -- alembic upgrade head

railway ssh --service api -- python -m app.cli seed-municipalities \
  --file data/electorate-go.json
railway ssh --service api -- python -m app.cli import-ibge-indicators \
  --file data/socioeconomic-go.json
railway ssh --service api -- python -m app.cli import-tse-history \
  --file data/election-history-go.json
railway ssh --service api -- python -m app.cli import-party-spectrum \
  --file data/party-spectrum.json

railway ssh --service api -- python -m app.cli create-user \
  --email demo@accorsi.local --name "Demonstração" --role analyst
```

O último pede a senha no seu terminal, duas vezes — digite **1331** nas duas.

### Como o modo demonstração funciona

Com `VITE_DEMO_EMAIL` definida, a tela de login mostra **apenas o campo de
senha**: quem entra digita `1331` e pronto. O e-mail vai junto, fixo, sem
aparecer.

O que esse modo **não** faz: ele não cria atalho no backend. A senha continua
sendo conferida contra o hash no banco, com o mesmo bloqueio por tentativas
repetidas e a mesma sessão assinada de sempre. A única diferença é a pessoa não
precisar digitar o e-mail. Foi feito assim de propósito — um "modo demo" que
pulasse a verificação viraria uma porta aberta que ninguém lembra de fechar
depois.

O papel é `analyst`, não `admin`: quem entra pela demonstração consulta os
dados mas não cria usuários nem importa cadastros.

`VITE_REGISTRATIONS_MODE=demo` mantém a aba de cadastros na base sintética.
Enquanto o acesso for por senha curta compartilhada, **não** troque para `api`
— senha de demonstração e dado real de apoiador não podem conviver.

Para virar uma instalação real depois: apague a variável
(`railway variable delete --service web VITE_DEMO_EMAIL`), crie contas
individuais com `create-user` e senhas fortes.

> Se o `railway ssh` reclamar de chave SSH, é um problema conhecido do CLI dele:
> `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519`. Se a chave estiver com
> permissão aberta: `chmod 600 ~/.ssh/id_ed25519`.

Abra o domínio gerado no passo 5 e entre com o e-mail e a senha que você criou.

---

## 9. Daqui pra frente

Toda alteração vai pro ar com três comandos — o Railway detecta o push e
publica sozinho:

```bash
cd ~/accorsi
git add .
git commit -m "descreva o que mudou"
git push
```

Quando quiser atualizar os dados (dados novos do TSE, por exemplo):

```bash
bash gerar_dados.sh
git add . && git commit -m "Atualiza os dados" && git push
```

---

## Antes de entrar dado real de apoiador

O módulo de cadastros ainda tem pendências de LGPD herdadas do projeto
original: o corte de anonimato (grupos com menos de cinco) é aplicado só no
navegador, a leitura de dado pessoal não é auditada e a exclusão a pedido não
apaga de fato. Filiação política é dado sensível pela lei (art. 5º, II).

Enquanto isso não for resolvido no servidor, use o módulo apenas com a base de
demonstração sintética.
