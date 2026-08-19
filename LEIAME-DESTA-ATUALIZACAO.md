# O que mudou nesta atualização

Descompacte por cima da pasta do projeto, mantendo os caminhos. Só os
arquivos listados aqui mudaram. Nada de dado gerado (`src/data/`,
`backend/data/`) e nenhum `.env` seu vem no pacote: seus arquivos locais
continuam onde estão.

## 1. Tela de login ligada ou desligada por variável

Duas variáveis, uma em cada serviço do Railway. **As duas precisam ter o
mesmo valor.**

| Variável | Serviço | O que faz |
|---|---|---|
| `VITE_AUTH_REQUIRED` | `web` | `false` pula a tela de login |
| `AUTH_REQUIRED` | `api` | `false` faz a API aceitar requisição sem cookie de sessão |

Ligar a demonstração:

```bash
railway variable set --service web VITE_AUTH_REQUIRED=false
railway variable set --service api AUTH_REQUIRED=false
railway up --service web
```

Voltar ao normal:

```bash
railway variable set --service web VITE_AUTH_REQUIRED=true
railway variable set --service api AUTH_REQUIRED=true
railway up --service web
```

O `railway up --service web` é obrigatório: variável `VITE_` é lida na hora
do build e fica gravada dentro do JavaScript publicado. Trocar a variável sem
rebuildar não muda nada na tela. O `AUTH_REQUIRED` do `api` é lido em tempo
de execução, e o Railway reinicia o serviço sozinho ao salvar a variável.

Com o modo ligado, toda requisição vale como o usuário `demonstracao@local`,
perfil `coordinator`: vê tudo e mexe em cadastro, mas não administra usuário
nem lê o log de auditoria. A conta é criada sozinha no primeiro acesso, com
senha impossível de casar, então ela não serve para entrar pela tela de login
depois que o modo for desligado.

**A instalação fica pública nesse modo.** Qualquer pessoa com o endereço
entra e consegue criar, editar e apagar cadastro de apoiador. Deixe ligado só
durante a demonstração.

Arquivos: `backend/app/config.py`, `backend/app/dependencies.py`,
`backend/app/main.py`, `backend/tests/test_demo_mode.py` (novo),
`RAILWAY.md` (seção 7b), `.env.example`, `.env.production.example`.

## 2. Aba Estatísticas: texto da exportação removido

Saiu o bloco "Exportar este recorte" com o parágrafo de descrição. Os botões
(Excel, PDF resumido, PDF completo) e a opção do anexo municipal continuam
iguais, agora alinhados à direita da barra.

Arquivos: `src/components/stats/StatsWindow.tsx`, `src/index.css`.

## 3. Comentários do frontend enxugados

De 3.977 para 3.005 linhas de comentário em `src/`, em 63 arquivos. O que
saiu: narrativa histórica, justificativa de design repetida, comentário que
só repetia o que o código já dizia, metáfora. O que ficou: número, limiar,
unidade, código do TSE/IBGE, invariante (como "null nunca vira 0"), motivo de
bug ou contorno de biblioteca, aviso de ordem de execução.

Nenhum travessão sobrou em comentário, em nenhum arquivo de `src/`.

**Verificação de que só comentário mudou:** o build de produção foi gerado
antes e depois da limpeza. Os nomes dos arquivos em `dist/assets/` são hash
do conteúdo, e ficaram idênticos: se qualquer linha de código, string ou
regra de CSS tivesse mudado, o hash mudaria.

## 4. Correção pescada no caminho

`backend/tests/test_registrations.py` estava usando Porto Alegre, CEP
`90010-000` e coordenada do Rio Grande do Sul como dado de teste. Com o
validador de CEP e de coordenada já corrigido para Goiás, esses dois testes
passaram a falhar. Troquei o dado do teste para Goiânia e Anápolis, com CEP
`74003-010` / `75024-020` e coordenada dentro da caixa de Goiás. É o mesmo
resquício de Rio Grande do Sul de sempre, agora no dado de teste.

## Como conferir depois de descompactar

```bash
npm test
npx tsc -b
npm run build
npx oxlint src

cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python3 -m pytest -q
```

Todos passaram limpos aqui: 328 testes do frontend (202 passam, 126 ficam
SKIP até `gerar_dados.sh` rodar), tipo, build, lint, e 70 testes do backend
(65 passam, 5 ficam SKIP).
