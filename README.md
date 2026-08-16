# ACCORSI — Inteligência territorial de Goiás

Plataforma de análise territorial e eleitoral do estado de Goiás. Reúne, num
mapa único, os 246 municípios com eleitorado do TSE, indicadores
socioeconômicos e etários do IBGE, resultados eleitorais oficiais, leitura
ideológica por partido, recorte submunicipal por local de votação, um agente de
perguntas sobre os dados e um módulo de cadastros de apoiadores com minimização
de dados pessoais.

Frontend React + TypeScript com Google Maps; backend FastAPI + PostgreSQL.

> **Esta instalação nasce sem dados.** Diferente da versão do Rio Grande do Sul,
> onde os snapshots vinham prontos no repositório, aqui todo `src/data/*.json` é
> um placeholder com `"status": "pendente"` até você rodar:
>
> ```bash
> bash gerar_dados.sh
> ```
>
> Enquanto isso, o app sobe e o mapa desenha, mas as camadas aparecem vazias, e
> os testes que dependem do snapshot se declaram **pulados** com a instrução —
> em vez de falharem em vermelho por falta de dado. Assim que os arquivos
> existem, eles voltam a valer sozinhos.

## Trocar de estado

Todo o "que estado é este" mora em dois arquivos que precisam concordar:

| Arquivo | Usado por |
|---|---|
| `src/config/estado.ts` | interface, mapa, malha do IBGE |
| `scripts/estado.py` | scripts de ETL |

Sigla, nome, código do IBGE, número de municípios, centro e limites do mapa
saem daí. A contagem de municípios é validação **dura** nos processadores: uma
base que não cubra exatamente esse número é recusada, em vez de gerar um mapa
com buraco silencioso.

---

## O que a plataforma entrega

### Mapa e perfil municipal
Malha oficial dos 246 municípios, busca por município, CEP, bairro ou
endereço, e painel com eleitorado, participação estadual, ranking, biometria,
zonas eleitorais, deficiência cadastrada, faixa etária predominante e
distribuição por gênero.

### Análise territorial
Vinte indicadores em camadas coropléticas de cinco faixas por quintis:

| Fonte | Indicadores |
|---|---|
| TSE | eleitorado, biometria, deficiência cadastrada, participação feminina, nome social, eleitores por zona |
| IBGE — pesquisas | população estimada, população do Censo, densidade, PIB per capita, escolarização 6–14, população ocupada, salário médio formal, saneamento adequado, renda até ½ salário mínimo |
| IBGE — Censo 2022 | população apta a votar (16+), penetração eleitoral, eleitorado jovem potencial (16–24), população 60+, alfabetização 15+ |

Municípios sem valor oficial ficam em cinza, fora dos quintis e do ranking, e
são contabilizados à parte — nunca convertidos em zero.

### Histórico eleitoral
Resultados oficiais de Presidente e Governador nos dois turnos (anos conforme
o snapshot — `scripts/ajustar_anos.py` mostra a cobertura e remove anos): participação nos votos válidos, votos nominais e diferença entre
séries equivalentes, com ranking estadual e exportação. Quando não existe
candidatura equivalente no pleito comparado, a comparação é declarada
indisponível em vez de parear candidatos diferentes.

### Espectro ideológico
Índice contínuo de 0 a 10 por município, calculado como média das notas dos
partidos votados, ponderada pelos votos de cada um. As notas vêm do survey de
especialistas da Associação Brasileira de Ciência Política (ondas de 2018 e
2022), registradas com DOI em `src/data/party-spectrum.json` — arquivo
editável, sem código: alterar uma nota ou um limiar de bloco altera todo o
cálculo.

Também mede o **deslocamento** do índice entre dois pleitos, com aviso
explícito quando a comparação mistura ondas diferentes do survey.

Votos em partidos sem nota na onda aplicada ficam fora do numerador e do
denominador, contabilizados à parte, com a cobertura exibida na tela.

### Recorte submunicipal
Votação agregada por local de votação, cruzando votação por seção com o
cadastro de locais do TSE. Bolhas por local com área proporcional ao
eleitorado, e agregação por bairro somando os votos antes de calcular o
índice. Mede onde a pessoa **vota**, não onde mora — a ressalva está na tela.

### Cadastros de apoiadores
Formulário e importação em CSV com minimização estrutural: não recebe nome,
telefone, CPF nem intenção de voto. O CEP completo é usado apenas para
localizar e só cinco dígitos são persistidos; coordenadas são arredondadas;
referência externa vira HMAC. Agrupamentos com menos de cinco cadastros são
suprimidos na visualização e a exportação é exclusivamente agregada.

### Recorte, comparação e exportação
Grupo de até 30 municípios com agregação ponderada, comparação de até três
municípios, favoritos, histórico de navegação, link compartilhável, exportação
em CSV e exportação do mapa em PNG com legenda e atribuição de fonte.

---

## Fontes de dados

| Fonte | Uso |
|---|---|
| TSE — Eleitorado 2026 | perfil do eleitorado dos 246 municípios |
| TSE — Votação por seção 2018/2022 | histórico eleitoral e recorte por local de votação |
| TSE — Votação por partido/município | eleições municipais de 2020 e 2024 |
| TSE — Eleitorado por local de votação | endereço, bairro e coordenada dos locais |
| IBGE — Malhas territoriais | polígonos municipais |
| IBGE — API de pesquisas | indicadores socioeconômicos |
| IBGE — Censo 2022 (tabela 9514) | estrutura etária e população 16+ |
| IBGE — Censo 2022 (tabela 9542) | alfabetização das pessoas de 15 anos ou mais |
| ABCP — survey de especialistas | posicionamento ideológico dos partidos |
| ViaCEP e Google Places | busca de CEP, bairro e endereço |

Todos os dados eleitorais e demográficos são públicos e agregados. Nenhuma
informação individual de eleitor é utilizada.

---

## Executar localmente

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # para começar sem PostgreSQL:
                              # DATABASE_URL=sqlite:///./acqr_dev.db
alembic upgrade head
uvicorn app.main:app --reload
```

Carregue os dados e crie o primeiro usuário:

```bash
python -m app.cli seed-municipalities   --file ../src/data/electorate-go.json
python -m app.cli import-ibge-indicators --file ../src/data/socioeconomic-go.json
python -m app.cli import-tse-history     --file ../src/data/election-history-go.json
python -m app.cli import-party-spectrum  --file ../src/data/party-spectrum.json
python -m app.cli create-user --email voce@exemplo.org --name "Seu Nome" --role admin
```

### Frontend

```bash
npm install
cp .env.example .env.local    # informe VITE_GOOGLE_MAPS_API_KEY
npm run dev
```

A chave do Google Maps precisa de Maps JavaScript API, Places API e Geocoding
API habilitadas. Ela fica visível no bundle entregue ao navegador — restrinja
por referenciador HTTP e defina cota diária.

### Qualidade

```bash
npm run check      # lint + testes + build
cd backend && pytest && ruff check .
```

---

## Regerar os dados

Os arquivos em `src/data/` são snapshots processados a partir das fontes
oficiais. Cada script valida cobertura, fechamento de totais e integridade
antes de escrever, e registra o SHA-256 das entradas.

O caminho mais curto é o script único, que baixa os pacotes do TSE, consulta a
API do IBGE, roda os processadores na ordem certa e confere o resultado:

```bash
bash gerar_dados.sh
```

Ele exige Python 3.11 ou mais novo (os processadores usam `datetime.UTC`) e
retoma downloads interrompidos, então pode ser executado de novo sem baixar
tudo outra vez. Para rodar cada etapa isoladamente:

```bash
# Eleitorado e correspondência TSE/IBGE
python3 scripts/process_tse.py

# Indicadores socioeconômicos do IBGE
python3 scripts/process_ibge.py

# Histórico eleitoral de Presidente e Governador
python3 scripts/process_tse_history.py

# Eleições municipais de 2020 e 2024
python3 scripts/process_tse_municipal.py \
  --input-dir ./tse-municipal \
  --electorate-file src/data/electorate-go.json \
  --output src/data/party-votes-go.json

# Recorte por local de votação (um cadastro por ano; ver nota abaixo)
python3 scripts/process_tse_sections.py \
  --sections-dir ./tse-secoes \
  --places-file 2022=./eleitorado_local_votacao_2022.zip \
  --places-file 2024=./eleitorado_local_votacao_2024.zip \
  --electorate-file src/data/electorate-go.json \
  --output-dir src/data/polling \
  --years 2022 2024

# Estrutura etária do Censo 2022
python3 scripts/process_ibge_age.py \
  --electorate-file src/data/electorate-go.json \
  --output src/data/age-structure-go.json \
  --cache-dir ./cache-ibge-age

# Alfabetização 15+ do Censo 2022 (tabela 9542, valores absolutos)
python3 scripts/process_ibge_literacy.py \
  --electorate-file src/data/electorate-go.json \
  --output src/data/literacy-go.json \
  --cache-dir ./cache-ibge-alfabetizacao
```

As camadas que dependem de dados ainda não gerados aparecem desabilitadas com
mensagem explicativa; a aplicação funciona normalmente sem elas.

**Locais de votação e turnos.** O cadastro do TSE traz uma linha por seção *por
turno*, e parte das seções vota em prédios diferentes em cada turno (em Goiás/2022,
21 das 27.429). O `process_tse_sections.py` monta um índice seção → local
separado para cada turno, de modo que os votos do 2º turno são atribuídos ao
prédio onde foram de fato depositados, e não ao do 1º. O resumo informa quantas
seções foram realocadas. Se duas linhas do *mesmo* turno mandarem uma seção para
locais diferentes — o que o cadastro não explica — a primeira é mantida e o caso
é listado em alerta, nunca descartado em silêncio.

**Um cadastro de locais por ano.** O TSE renumera seções entre eleições, então
cada ano processado exige o `--places-file ANO=CAMINHO` do seu próprio ano — o
script recusa rodar sem ele, em vez de casar votos de uma eleição com o mapa de
seções de outra. Processar 2018 com o cadastro de 2022, por exemplo, estoura o
limite de 2% de votos órfãos (em Bagé, 44,8% das seções de 2018 não existem no
cadastro de 2022). Os anos são lidos do mais recente para o mais antigo, e o
eleitorado e o endereço de cada local vêm do cadastro mais novo em que ele
aparece — nunca somados entre anos.

O recorte padrão cobre **2022** (Presidente e Governador) e **2024** (Prefeito e
Vereador). O calendário alterna eleição geral e municipal, e o script sabe disso:
em ano geral o Presidente vem no pacote nacional e o Governador no do estado; em
ano municipal só existe o pacote do estado. Para incluir 2018 é preciso, além do
cadastro de locais daquele ano, o `--candidates-dir` com o `consulta_cand_2018.zip`,
porque o pacote de seção de 2018 não traz a sigla do partido na linha. Quando os
dados de 2026 saírem, é só acrescentar mais um par de arquivos. Os dois cenários
estão cobertos por fixtures sintéticos — `scripts/tests/rounds_fixture.py` para a
realocação entre turnos e `scripts/tests/multiyear_fixture.py` para a renumeração
entre anos:

```bash
python3 scripts/tests/rounds_fixture.py
python3 scripts/process_tse_sections.py \
  --sections-dir scripts/tests/fixtures/polling-rounds \
  --places-file 2022=scripts/tests/fixtures/polling-rounds/eleitorado_local_votacao.zip \
  --electorate-file scripts/tests/fixtures/polling-rounds/electorate-fixture.json \
  --output-dir scripts/tests/fixtures/polling-rounds/out \
  --years 2022 --expected-municipalities 1
python3 scripts/tests/rounds_fixture.py --check scripts/tests/fixtures/polling-rounds/out

python3 scripts/tests/multiyear_fixture.py
python3 scripts/process_tse_sections.py \
  --sections-dir scripts/tests/fixtures/polling-multiyear \
  --places-file 2022=scripts/tests/fixtures/polling-multiyear/eleitorado_local_votacao_2022.zip \
  --places-file 2024=scripts/tests/fixtures/polling-multiyear/eleitorado_local_votacao_2024.zip \
  --electorate-file scripts/tests/fixtures/polling-multiyear/electorate-fixture.json \
  --output-dir scripts/tests/fixtures/polling-multiyear/out \
  --years 2022 2024 --expected-municipalities 1
python3 scripts/tests/multiyear_fixture.py --check scripts/tests/fixtures/polling-multiyear/out
```

---

## Deploy

- **Servidor próprio:** [`DEPLOY.md`](DEPLOY.md) — Docker Compose com
  PostgreSQL, API e Caddy fazendo TLS e proxy reverso.
- **Railway:** [`RAILWAY.md`](RAILWAY.md) — três serviços, banco gerenciado e
  proxy de borda da plataforma.

Em ambos, a SPA e a API respondem na **mesma origem**: isso elimina o CORS e
permite cookie `SameSite=lax`, fechando a via de login CSRF que domínios
separados abririam.

---

## Segurança e privacidade

- Sessão por cookie `HttpOnly` com token opaco de 384 bits; o banco guarda
  apenas o HMAC do token.
- Proteção CSRF por duplo envio verificada também contra o estado do servidor.
- Senhas com Argon2; login sem oráculo de enumeração de usuário.
- Quatro perfis de acesso, trilha de auditoria e registro de cargas com
  checksum.
- Em produção, a API recusa subir com SQLite, segredo fraco, cookie inseguro,
  CORS com curinga ou `ALLOWED_HOSTS` aberto.

Os cadastros de apoiadores envolvem dado sensível sob a LGPD (art. 5º, II).
Antes de inserir dados reais de pessoas, revise os controles de acesso à
listagem individual, a auditoria de leitura e a rotina de expurgo por
retenção.

---

## Limites analíticos

A plataforma descreve resultados apurados e dados demográficos oficiais. **Não
é projeção, intenção de voto nem pesquisa eleitoral.**

- As notas ideológicas medem a percepção de especialistas sobre o partido
  nacional, não o diretório municipal nem a candidatura.
- Em eleição municipal o rótulo partidário é fraco: coligação local, troca de
  legenda e candidatura personalista reduzem o poder informativo da sigla.
- O recorte por local de votação mede onde a pessoa vota, não onde mora.
- A penetração eleitoral pode exceder 100% em municípios com títulos não
  transferidos — é informação legítima, não erro.
- Indicadores do TSE e do IBGE são municipais; selecionar um CEP ou bairro
  não os transforma em dados daquele bairro.

Cada uma dessas ressalvas é exibida na própria interface, junto do número a
que se refere.
