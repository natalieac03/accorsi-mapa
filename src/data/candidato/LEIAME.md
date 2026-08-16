# Trajetória da candidatura em foco

Os arquivos `<slug>.json` desta pasta são gerados por
`scripts/process_candidato_foco.py` e trazem, para cada eleição disputada:

- votos no estado, posição entre todas as candidaturas do cargo e concentração
  (fatia da votação vinda dos 5, 10 e 20 maiores municípios);
- por município: votos, `% dos válidos`, `% do próprio partido` e a posição
  local — três leituras diferentes porque respondem a perguntas diferentes;
- por local de votação e por bairro, nos anos em que existe cadastro de locais.

Nada é preenchido por estimativa: município sem voto apurado fica ausente (não
vira zero) e ano sem arquivo é declarado em `metadata.anosSemDado`.

Homônimos NÃO são somados. Se o mesmo nome aparecer em duas candidaturas do
mesmo cargo e ano, o script para e exige `--partido` ou `--sq` — somar duas
pessoas produziria um total inflado com aparência de verdade.
