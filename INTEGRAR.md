# Aba Oportunidades — integrada na base ACCORSI/GO

Este pacote é o recorte `painel-oportunidades` já adaptado a esta instalação,
mais o que a adaptação exigiu criar. **Não contém `src/data`**: extrair por
cima do repositório não toca em nenhum snapshot gerado.

## Como aplicar

```bash
# a partir da raiz do repositório
unzip -o oportunidades-accorsi.zip -d /tmp/op
cp -r /tmp/op/oportunidades-accorsi/src /tmp/op/oportunidades-accorsi/scripts .

# o CSS não é um arquivo novo: ele vai no fim do index.css
cat src/opportunities-window.css >> src/index.css && rm src/opportunities-window.css

npx tsc -b && npm test && npm run build
```

`src/App.tsx` é **modificado**, não novo — se você já mexeu nele desde o zip
que me mandou, aplique as três mudanças à mão: o `lazy(...)` de
`OpportunitiesWindow`, o estado `oportunidadesAbertas` com o bloco `<Suspense>`
correspondente, e o item de menu no `HeaderMenu`.

## Arquivos

| Arquivo | |
|---|---|
| `src/types/opportunity.ts` | do pacote, sem alteração |
| `src/utils/opportunity.ts` | do pacote, sem alteração |
| `src/utils/territoryFeatures.ts` | do pacote, sem alteração |
| `src/utils/clustering.ts`, `expectedPerformance.ts`, `opportunityGate.ts` | do pacote, sem alteração |
| `src/utils/opportunityTypes.ts` | do pacote **+ campo `avisoDeComparacao`** no contrato de evidência |
| `src/utils/opportunityInputs.ts` | **novo** — seleção de pleitos, disponibilidade por tipo, poder de separação dos limiares |
| `src/components/opportunities/OpportunitiesWindow.tsx` | do pacote, adaptado (ver abaixo) |
| `src/config/candidata.ts` | **novo, provisório** — ver a nota no cabeçalho do arquivo |
| `src/App.tsx` | modificado |
| `src/opportunities-window.css` | do pacote + estados novos (sem insumo, limiares) |
| `scripts/tests/opportunity*.test.ts` | 3 do pacote + 1 novo (`opportunityInputs`) |
| `scripts/diagnostico_oportunidades.ts` | **novo** — roda os motores fora do navegador |

Imports ajustados para a convenção da casa: `.ts` em import de valor, sem
extensão em `import type`. Sem isso, `node --experimental-strip-types` quebra
em `./clustering` — foi o que aconteceu na primeira execução aqui.

## O que a adaptação mudou de comportamento

**1. Seleção do pleito.** A janela escolhia o cargo com mais pleitos no
snapshot. Aqui isso elege as três candidaturas a Prefeito, todas com
`municipiosComVoto: 1` — a aba analisaria Goiânia e apresentaria o resultado
como mapa de Goiás, sem erro visível. Agora o critério é cobertura territorial
primeiro (metade do estado), recência depois.

**2. Comparação entre cargos, declarada.** Sobram 2022/Dep. Federal e
2018/Dep. Estadual. Cargos diferentes. É permitido porque o lift já é posição
relativa dentro de cada pleito — e sai escrito no aviso de cada território
classificado e no painel de método, em vez de acontecer em silêncio.

**3. "Sem insumo" ≠ "zero".** Três tipos não têm como ser calculados neste
snapshot. Mostrar `0` afirmaria que a busca aconteceu e não achou nada; a
verdade é que ela não aconteceu, e as duas leituras levam a decisões opostas.
A verificação é feita contra o dado carregado, não contra uma lista fixa: no
dia em que o ETL do bloco partidário rodar, os dois tipos voltam sozinhos.

**4. Poder de separação dos limiares.** O painel de método agora mostra
quantos territórios cada limiar deixa passar, e marca o que não separa.

## Estado atual, medido

`node --experimental-strip-types scripts/diagnostico_oportunidades.ts`

```
referência : Deputado Federal 2022 (246 municípios)
comparação : Deputado Estadual 2018 (236 municípios)
descartados: Prefeito 2024 (1), Prefeito 2020 (1), Prefeito 2016 (1)
prior      : estimado, força 73.2 · taxa de referência 2,911%
âncoras    : 20 → Goiás (2,89), Silvânia (2,82), Guaraíta (2,45)…

Base consolidada             5 municípios
Recuperação                 39 municípios
Força pessoal               sem insumo (bloco partidário)
Afinidade não convertida    sem insumo (bloco partidário)
Expansão                    39 municípios
Nova fronteira             186 municípios
Mobilização                 sem insumo (comparecimento)
sem tipo nenhum: 16

Desempenho alto      lift ≥ 1.25            20/246
Desempenho baixo     lift < 0.75           187/246
Perfil compatível    similaridade ≥ 70%    245/246   << não separa
Volume suficiente    ≥ 200 válidos         246/246   << não separa
```

## O que isso revela, e que não é bug

**O limiar de similaridade não está separando nada.** A similaridade de Gower
contra estas âncoras varia entre 66% e 87% — distribuição estreita —, então o
corte de 70% aprova 245 de 246 municípios. É por isso que "Nova fronteira"
recolhe 186 municípios: 76% do estado. Um tipo que cobre três quartos do
território não é recomendação, é plano de fundo.

Não mexi no número. Mover limiar depois de ver o resultado é exatamente o que
o portão da Rodada 3 existe para impedir, e a regra vale igual para a Rodada 2.
O que fiz foi tornar o problema visível na tela. A decisão é sua, e há três
saídas diferentes:

- **Cortar por quantil** em vez de valor absoluto (o top 25% de similaridade
  seria ≥ 84,8% neste dado) — vira um corte que se recalibra sozinho a cada
  estado, mas muda o significado de "compatível" de absoluto para relativo.
- **Subir o corte para ~85%** (55 de 246 passam) — mantém o significado
  absoluto, mas o número vira específico deste estado e dessas âncoras.
- **Revisar as features**: 14 variáveis com peso igual, várias correlacionadas
  entre si (PIB per capita, salário médio, baixa renda medem quase a mesma
  coisa), achatam a distância de Gower. Menos variáveis, ou peso por bloco
  temático, alargariam a distribuição.

`O limiar de volume` (≥ 200 válidos) também aprova todo mundo — aqui é
esperado: o menor município de Goiás tem eleitorado bem acima disso. Ele vale
para a escala submunicipal, quando ela chegar.

## Testes

92 testes desta aba, todos passando:

```bash
node --experimental-strip-types --test scripts/tests/opportunity*.test.ts
```

A suíte completa continua com as mesmas 36 falhas que já existiam antes desta
integração — todas por snapshot ainda em placeholder no zip que você mandou
(`campaign-registrations-demo.json` com `status: "pendente"`, entre outros),
nenhuma relacionada a estes arquivos. Confirmei rodando a suíte numa cópia
intocada: 328 testes / 36 falhas antes, 420 testes / 36 falhas depois.

## O que ficou de fora

- **`npx tsc -b` e `npm run build` não foram rodados** — o zip do projeto veio
  sem `package.json`, `tsconfig` e `node_modules`, então não há como checar o
  `.tsx` contra React e lucide-react aqui. Os módulos puros rodam e passam.
- **Exportação (PDF/Excel) e ferramenta do agente**: a `explicacao` já é gerada
  para isso, mas ninguém consome ainda. Encaixa em `reportModel` e numa nona
  entrada em `shared/agent-tools.json` (espelhada em `backend/data/`).
- **Os dois ETLs** que liberariam os três tipos restantes: votação por partido
  do cargo proporcional, e comparecimento por município.
- **A contradição com `reportAnalysis.ts:384`**, que documenta que nenhum
  recorte deve se chamar "oportunidade" porque isso é decisão de campanha. A
  aba nova nomeia. Vale reconciliar antes que as duas doutrinas apareçam no
  mesmo PDF.
