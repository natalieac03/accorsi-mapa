# Cópia dos dados para o deploy no Railway

Estes cinco arquivos são cópias de `../../src/data/*.json`. A duplicação
existe só por causa de como o Railway isola serviços em monorepo: o serviço
`api` tem Root Directory `backend/`, então nada fora dessa pasta entra na
imagem — inclusive `src/data/`, que fica um nível acima.

Se atualizar qualquer snapshot em `src/data/` (rodando os scripts de
`scripts/`), copie o arquivo de novo para cá antes de fazer commit:

```bash
cp src/data/*.json backend/data/
```

Fora do Railway (rodando `compose.prod.yaml` ou localmente) esta cópia não é
usada; os comandos de carga do `DEPLOY.md` apontam para `src/data/`.

## agent-tools.json

Cópia de `../../shared/agent-tools.json`, pelo mesmo motivo dos outros: o
serviço `api` no Railway só enxerga `backend/`. Sem esta cópia o agente
responde "contrato de ferramentas não encontrado". Se atualizar o contrato em
`shared/`, copie de novo para cá antes do commit.
