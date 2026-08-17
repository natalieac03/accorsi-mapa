#!/usr/bin/env python3
"""Extrai a trajetória eleitoral COMPLETA de uma candidatura, eleição por eleição.

Por que um script separado dos demais: o `process_tse_sections.py` agrega por
PARTIDO, porque é isso que a leitura ideológica precisa. Uma aba dedicada a uma
candidata precisa do oposto — o voto NOMINAL dela, separado do partido, em cada
município e em cada local de votação. Gerar isso para todas as candidaturas
explodiria o tamanho dos arquivos (dezenas de milhares de candidatos × milhares
de locais); gerar só para as candidaturas em foco cabe folgadamente.

O que sai daqui, por eleição em que a pessoa concorreu:

* votos totais no estado e a posição dela entre as candidaturas do mesmo cargo;
* votos por município, com três denominadores diferentes, porque cada um
  responde a uma pergunta distinta:
    - % dos votos nominais válidos do cargo  -> força bruta no território
    - % do voto do próprio partido           -> quanto do PT ali é nominalmente dela
    - posição entre todas as candidaturas    -> domínio local
* votos por LOCAL DE VOTAÇÃO e por BAIRRO, quando existe o cadastro de locais
  daquele ano — é o recorte que mostra onde ela cresceu dentro da cidade;
* concentração: que fatia da votação dela veio dos N maiores municípios.

Disciplina de dados, igual à do resto do projeto: nada é inventado. Município
sem voto apurado sai ausente (não vira zero), ano sem arquivo é reportado em vez
de estimado, e a identificação da candidatura é sempre impressa para conferência
humana — casar a pessoa errada seria o pior erro possível aqui, e silencioso.

Uso típico (depois de baixar os pacotes com o gerar_dados.sh):

    python3 scripts/process_candidato_foco.py \\
        --nome "ADRIANA ACCORSI" \\
        --sections-dir dados_tse/secoes \\
        --candidates-dir dados_tse/candidaturas \\
        --places-dir dados_tse/locais \\
        --anos 2014 2016 2018 2020 2022 2024
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import unicodedata
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from estado import MUNICIPIOS, UF  # noqa: E402

SCHEMA_VERSION = 1
SOURCE_ENCODING = "latin-1"
ORDINARY_ELECTION_TYPE = 2

# Códigos de cargo do TSE. Cobrimos todos os que uma trajetória estadual pode
# ter; o script só materializa os que a pessoa realmente disputou.
OFFICES = {
    1: "Presidente",
    3: "Governador",
    5: "Senador",
    6: "Deputado Federal",
    7: "Deputado Estadual",
    8: "Deputado Distrital",
    11: "Prefeito",
    13: "Vereador",
}

# Marcadores de "sem informação" do TSE.
MISSING_MARKERS = {"", "#NULO#", "#NULO", "#NE#", "#NE", "#NI#", "NA", "N/A", "NULL"}

CANDIDATES_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand"
SECTIONS_URL = "https://dadosabertos.tse.jus.br/dataset/"

# Quantos municípios entram no cálculo de concentração exibido no resumo.
TOPO_CONCENTRACAO = (5, 10, 20)


# ----------------------------------------------------------------------------
# Utilidades de leitura (mesmo dialeto CSV do TSE usado nos demais scripts)
# ----------------------------------------------------------------------------
def open_csv(raw: BinaryIO) -> csv.DictReader:
    text = io.TextIOWrapper(raw, encoding=SOURCE_ENCODING, newline="")
    return csv.DictReader(text, delimiter=";", quotechar='"')


def clean_label(value: str | None) -> str:
    if value is None:
        return ""
    texto = value.strip().strip('"').strip()
    return "" if texto.upper() in MISSING_MARKERS else texto


def parse_int(value: str | None, campo: str, linha: int) -> int:
    texto = clean_label(value)
    if not texto:
        return 0
    try:
        return int(texto)
    except ValueError as erro:
        raise RuntimeError(f"{campo} não numérico na linha {linha}: {value!r}") from erro


def normalizar(texto: str) -> str:
    """Maiúsculas sem acento e sem espaço duplicado, para casar nomes do TSE."""
    decomposto = unicodedata.normalize("NFD", texto)
    sem_acento = "".join(c for c in decomposto if not unicodedata.combining(c))
    return " ".join(sem_acento.upper().split())


def normalize_code(value: str | None) -> str:
    return clean_label(value).lstrip("0") or "0"


def membros_csv(archive: ZipFile, prefixo: str) -> list[str]:
    return [
        nome
        for nome in archive.namelist()
        if Path(nome).name.lower().startswith(prefixo.lower())
        and nome.lower().endswith(".csv")
    ]


# ----------------------------------------------------------------------------
# Correspondência TSE -> IBGE
# ----------------------------------------------------------------------------
def carregar_municipios(
    caminho: Path, esperados: int = MUNICIPIOS
) -> tuple[dict[str, str], dict[str, str]]:
    payload = json.loads(caminho.read_text(encoding="utf-8"))
    registros = payload.get("municipalities") or {}
    metadata = payload.get("metadata") or {}
    if metadata.get("status") == "pendente" or not registros:
        raise SystemExit(
            f"{caminho.name} ainda é um placeholder. Rode `bash gerar_dados.sh` "
            "primeiro: sem a correspondência TSE/IBGE não dá para localizar os votos."
        )
    if len(registros) != esperados:
        raise SystemExit(
            f"{caminho.name} tem {len(registros)} municípios; {UF} deveria ter "
            f"{esperados}. Regere a base antes de continuar."
        )
    tse_para_ibge: dict[str, str] = {}
    nomes: dict[str, str] = {}
    for ibge, registro in registros.items():
        tse = normalize_code(str(registro.get("tseCode", "")))
        if tse:
            tse_para_ibge[tse] = ibge
        nomes[ibge] = str(registro.get("name", ""))
    return tse_para_ibge, nomes


# ----------------------------------------------------------------------------
# Identificação da candidatura
# ----------------------------------------------------------------------------
def localizar_candidaturas(
    caminho: Path, ano: int, nome_alvo: str
) -> list[dict[str, Any]]:
    """Todas as candidaturas da pessoa naquele ano (normalmente uma).

    Casamos por NOME COMPLETO normalizado, não por nome de urna: nome de urna
    se repete entre pessoas diferentes com facilidade. Devolvemos tudo o que
    casou para o operador conferir na saída — nunca escolhemos em silêncio.
    """
    alvo = normalizar(nome_alvo)
    encontrados: list[dict[str, Any]] = []
    with ZipFile(caminho) as archive:
        membros = membros_csv(archive, f"consulta_cand_{ano}_")
        if not membros:
            raise RuntimeError(f"Nenhum CSV consulta_cand_{ano}_*.csv em {caminho.name}.")
        for membro in membros:
            with archive.open(membro) as raw:
                leitor = open_csv(raw)
                campos = set(leitor.fieldnames or [])
                if "NM_CANDIDATO" not in campos:
                    continue
                for numero, linha in enumerate(leitor, start=2):
                    if clean_label(linha.get("SG_UF")).upper() not in {UF, "BR"}:
                        continue
                    nome = normalizar(clean_label(linha.get("NM_CANDIDATO")))
                    urna = normalizar(clean_label(linha.get("NM_URNA_CANDIDATO")))
                    if alvo not in (nome, urna) and not (
                        len(alvo) > 8 and (alvo in nome or alvo in urna)
                    ):
                        continue
                    cargo = parse_int(linha.get("CD_CARGO"), "CD_CARGO", numero)
                    if cargo not in OFFICES:
                        continue
                    encontrados.append(
                        {
                            "sqCandidato": clean_label(linha.get("SQ_CANDIDATO")),
                            # Unidade eleitoral: "GO" nos cargos estaduais e
                            # federais, código TSE do município nos municipais.
                            # É o que impede o número de urna de virar chave
                            # ambígua — "13" para Prefeito existe em 246 cidades.
                            "sgUe": normalizar_ue(linha.get("SG_UE")),
                            "nomeCompleto": clean_label(linha.get("NM_CANDIDATO")),
                            "nomeUrna": clean_label(linha.get("NM_URNA_CANDIDATO")),
                            "partido": clean_label(linha.get("SG_PARTIDO")).upper(),
                            "numero": clean_label(linha.get("NR_CANDIDATO")),
                            "officeCode": cargo,
                            "officeName": OFFICES[cargo],
                            "situacaoCandidatura": clean_label(
                                linha.get("DS_SITUACAO_CANDIDATURA")
                            ),
                            "resultado": clean_label(linha.get("DS_SIT_TOT_TURNO")),
                            "electionYear": ano,
                        }
                    )
    # Deduplica por SQ_CANDIDATO (o cadastro repete a pessoa por turno/arquivo).
    por_sq: dict[str, dict[str, Any]] = {}
    for registro in encontrados:
        chave = registro["sqCandidato"]
        if chave and chave not in por_sq:
            por_sq[chave] = registro
    return list(por_sq.values())


# ----------------------------------------------------------------------------
# Cadastro de locais de votação (opcional, por ano)
# ----------------------------------------------------------------------------
def carregar_locais(
    caminho: Path, tse_para_ibge: dict[str, str]
) -> dict[tuple[str, int, int, int], dict[str, Any]]:
    """(municipio, zona, secao, turno) -> local. Turno 0 quando o cadastro não informa."""
    indice: dict[tuple[str, int, int, int], dict[str, Any]] = {}
    with ZipFile(caminho) as archive:
        csvs = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        if not csvs:
            raise RuntimeError(f"Nenhum CSV em {caminho.name}.")
        with archive.open(csvs[0]) as raw:
            leitor = open_csv(raw)
            campos = set(leitor.fieldnames or [])
            col_bairro = next(
                (c for c in ("NM_BAIRRO", "DS_BAIRRO") if c in campos), None
            )
            col_turno = "NR_TURNO" if "NR_TURNO" in campos else None
            for numero, linha in enumerate(leitor, start=2):
                if clean_label(linha.get("SG_UF")).upper() != UF:
                    continue
                tse = normalize_code(linha.get("CD_MUNICIPIO"))
                ibge = tse_para_ibge.get(tse)
                if not ibge:
                    continue
                zona = parse_int(linha.get("NR_ZONA"), "NR_ZONA", numero)
                secao = parse_int(linha.get("NR_SECAO"), "NR_SECAO", numero)
                local = parse_int(
                    linha.get("NR_LOCAL_VOTACAO"), "NR_LOCAL_VOTACAO", numero
                )
                turno = (
                    parse_int(linha.get(col_turno), col_turno, numero) if col_turno else 0
                )
                chave = (tse, zona, secao, turno)
                if chave in indice:
                    continue
                bairro = clean_label(linha.get(col_bairro)) if col_bairro else ""
                indice[chave] = {
                    # Zero à esquerda preservado (zfill 5) para casar com o
                    # cadastro que o process_tse_sections.py grava. O
                    # normalize_code deste script REMOVE zeros à esquerda —
                    # ótimo para as chaves internas, fatal aqui: "9373-1-1015"
                    # nunca casaria com "09373-1-1015" do cadastro, e o mapa de
                    # votos dela por local sairia zerado sem dar erro.
                    "placeId": f"{tse.zfill(5)}-{zona}-{local}",
                    "ibgeCode": ibge,
                    "nome": clean_label(linha.get("NM_LOCAL_VOTACAO")),
                    "bairro": bairro,
                    "bairroChave": normalizar(bairro),
                }
    return indice


# ----------------------------------------------------------------------------
# Apuração por seção
# ----------------------------------------------------------------------------
def normalizar_ue(valor: str | None) -> str:
    """SG_UE é 'GO' nos cargos estaduais e código de município nos municipais.

    Só o código numérico passa por normalize_code — comparar '09373' com '9373'
    como se fossem unidades diferentes reintroduziria, calada, a divergência que
    a chave existe para evitar.
    """
    bruto = clean_label(valor).upper()
    return normalize_code(bruto) if bruto.isdigit() else bruto


def chave_por_numero(cargo: int, sg_ue: str, numero: str) -> str:
    """Identidade de candidatura sem SQ_CANDIDATO: cargo + unidade + número.

    Os pacotes antigos de votação por seção (2014 e anteriores) identificam quem
    recebeu o voto só por NR_VOTAVEL. Dentro de um cargo e de uma unidade
    eleitoral o número é único — é literalmente o que a pessoa digita na urna —
    então serve de chave. O que NÃO serve é o número sozinho: "13" para Prefeito
    é o PT de cada uma das 246 cidades, e somar tudo daria um total inflado com
    cara de verdade.
    """
    return f"ue:{normalizar_ue(sg_ue)}|{cargo}|{numero.lstrip('0') or '0'}"


def apurar(
    caminho: Path,
    ano: int,
    alvos_por_sq: dict[str, dict[str, Any]],
    tse_para_ibge: dict[str, str],
    locais: dict[tuple[str, int, int, int], dict[str, Any]] | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Percorre a votação por seção uma única vez, acumulando tudo que interessa.

    Um passe só porque estes arquivos têm dezenas de milhões de linhas: reler
    para cada métrica multiplicaria o tempo de processamento por nada.

    Devolve (pleitos, diagnóstico). O diagnóstico existe porque um ano que sai
    com zero voto precisa dizer POR QUE saiu com zero — antes disso o ano
    simplesmente sumia do resumo em silêncio, que é o pior desfecho possível.
    """
    pleitos: dict[str, dict[str, Any]] = {}
    diagnostico: dict[str, Any] = {
        "estrategias": set(),
        "linhasLidas": 0,
        "linhasNominais": 0,
        "colunasSemIdentificacao": [],
    }

    # A candidatura em foco pode ser encontrada por qualquer uma das duas
    # chaves; cada arquivo usa uma só, então não há risco de contar duas vezes.
    chaves_alvo: dict[str, dict[str, Any]] = {}
    for sq, alvo in alvos_por_sq.items():
        if sq:
            chaves_alvo[f"sq:{sq}"] = alvo
        if alvo.get("sgUe") and alvo.get("numero"):
            chaves_alvo[
                chave_por_numero(alvo["officeCode"], alvo["sgUe"], alvo["numero"])
            ] = alvo

    def pleito(cargo: int, turno: int) -> dict[str, Any]:
        chave = f"{ano}-{cargo}-{turno}"
        if chave not in pleitos:
            pleitos[chave] = {
                "id": chave,
                "electionYear": ano,
                "officeCode": cargo,
                "officeName": OFFICES.get(cargo, str(cargo)),
                "round": turno,
                # denominadores por município
                "validosPorMunicipio": defaultdict(int),
                "partidoPorMunicipio": defaultdict(int),
                # votos de cada candidatura, para ranking
                "porCandidatura": defaultdict(lambda: defaultdict(int)),
                "totalPorCandidatura": defaultdict(int),
                # a candidatura em foco
                "focoPorMunicipio": defaultdict(int),
                "focoPorLocal": defaultdict(int),
                "focoPorBairro": defaultdict(lambda: defaultdict(int)),
                "focoTotal": 0,
                "secoesSemLocal": 0,
                "datasEleicao": set(),
            }
        return pleitos[chave]

    partidos_foco = {alvo["partido"] for alvo in alvos_por_sq.values()}

    with ZipFile(caminho) as archive:
        membros = membros_csv(archive, f"votacao_secao_{ano}_")
        if not membros:
            raise RuntimeError(f"Nenhum CSV votacao_secao_{ano}_*.csv em {caminho.name}.")
        for membro in membros:
            with archive.open(membro) as raw:
                leitor = open_csv(raw)
                campos = set(leitor.fieldnames or [])
                col_partido = next(
                    (c for c in ("SG_PARTIDO", "SG_PARTIDO_VOTAVEL") if c in campos),
                    None,
                )
                # A estratégia de identificação é decidida por ARQUIVO, não por
                # linha: misturar as duas dentro do mesmo pacote partiria os
                # votos de uma pessoa em duas chaves e estragaria o ranking.
                col_numero = next(
                    (c for c in ("NR_VOTAVEL", "NR_CANDIDATO") if c in campos), None
                )
                if "SQ_CANDIDATO" in campos:
                    estrategia = "SQ_CANDIDATO"
                elif col_numero:
                    estrategia = f"{col_numero} + SG_UE (pacote antigo, sem SQ)"
                else:
                    diagnostico["colunasSemIdentificacao"].append(membro)
                    continue
                diagnostico["estrategias"].add(estrategia)
                col_ue = "SG_UE" if "SG_UE" in campos else None

                for numero, linha in enumerate(leitor, start=2):
                    diagnostico["linhasLidas"] += 1
                    if clean_label(linha.get("SG_UF")).upper() != UF:
                        continue
                    if (
                        parse_int(linha.get("CD_TIPO_ELEICAO"), "CD_TIPO_ELEICAO", numero)
                        != ORDINARY_ELECTION_TYPE
                    ):
                        continue
                    cargo = parse_int(linha.get("CD_CARGO"), "CD_CARGO", numero)
                    if cargo not in OFFICES:
                        continue
                    tse = normalize_code(linha.get("CD_MUNICIPIO"))
                    ibge = tse_para_ibge.get(tse)
                    if not ibge:
                        continue

                    if estrategia == "SQ_CANDIDATO":
                        sq = clean_label(linha.get("SQ_CANDIDATO"))
                        if not sq or sq.startswith("-"):
                            continue  # branco, nulo e agregados não nominais
                        chave_voto = f"sq:{sq}"
                    else:
                        bruto = clean_label(linha.get(col_numero))
                        if not bruto or bruto.startswith("-"):
                            continue
                        votavel = parse_int(bruto, col_numero, numero)
                        # 95 a 98 nunca são número de candidatura: são os códigos
                        # de branco, nulo e anulado sob judice.
                        if votavel <= 0 or 95 <= votavel <= 98:
                            continue
                        # Sem SG_UE não dá para desambiguar cargo municipal
                        # nenhum; o município da própria linha é a unidade.
                        ue = clean_label(linha.get(col_ue)).upper() if col_ue else ""
                        if not ue:
                            ue = UF if cargo not in {11, 13} else tse
                        chave_voto = chave_por_numero(cargo, ue, str(votavel))

                    votos = parse_int(linha.get("QT_VOTOS"), "QT_VOTOS", numero)
                    if votos <= 0:
                        continue
                    diagnostico["linhasNominais"] += 1
                    turno = parse_int(linha.get("NR_TURNO"), "NR_TURNO", numero)
                    atual = pleito(cargo, turno)
                    atual["datasEleicao"].add(clean_label(linha.get("DT_ELEICAO")))
                    atual["validosPorMunicipio"][ibge] += votos
                    atual["porCandidatura"][chave_voto][ibge] += votos
                    atual["totalPorCandidatura"][chave_voto] += votos

                    if col_partido:
                        sigla = clean_label(linha.get(col_partido)).upper()
                        if sigla and sigla in partidos_foco:
                            atual["partidoPorMunicipio"][ibge] += votos

                    if chave_voto not in chaves_alvo:
                        continue

                    # --- daqui para baixo, só a candidatura em foco ---
                    atual["focoPorMunicipio"][ibge] += votos
                    atual["focoTotal"] += votos
                    if locais is None:
                        continue
                    zona = parse_int(linha.get("NR_ZONA"), "NR_ZONA", numero)
                    secao = parse_int(linha.get("NR_SECAO"), "NR_SECAO", numero)
                    local = locais.get((tse, zona, secao, turno)) or locais.get(
                        (tse, zona, secao, 0)
                    )
                    if local is None:
                        atual["secoesSemLocal"] += votos
                        continue
                    atual["focoPorLocal"][local["placeId"]] += votos
                    if local["bairroChave"]:
                        atual["focoPorBairro"][local["ibgeCode"]][
                            local["bairroChave"]
                        ] += votos

    return pleitos, diagnostico


# ----------------------------------------------------------------------------
# Consolidação
# ----------------------------------------------------------------------------
def consolidar(
    pleito: dict[str, Any],
    alvo: dict[str, Any],
    nomes: dict[str, str],
    locais: dict[tuple[str, int, int, int], dict[str, Any]] | None,
) -> dict[str, Any] | None:
    if pleito["focoTotal"] <= 0:
        return None

    # A chave dela no acumulador depende do formato do pacote daquele ano: SQ
    # quando o arquivo traz SQ_CANDIDATO, número de urna + unidade quando não.
    # Aqui aceitamos as duas e usamos a que de fato apareceu.
    chaves_dela = {f"sq:{alvo['sqCandidato']}"}
    if alvo.get("sgUe") and alvo.get("numero"):
        chaves_dela.add(
            chave_por_numero(alvo["officeCode"], alvo["sgUe"], alvo["numero"])
        )

    # posição estadual entre todas as candidaturas do mesmo cargo/turno
    ordenadas = sorted(
        pleito["totalPorCandidatura"].items(), key=lambda item: -item[1]
    )
    posicao_estadual = next(
        (i for i, (chave, _) in enumerate(ordenadas, start=1) if chave in chaves_dela),
        None,
    )

    municipios: dict[str, Any] = {}
    for ibge, votos in sorted(pleito["focoPorMunicipio"].items()):
        validos = pleito["validosPorMunicipio"].get(ibge, 0)
        partido = pleito["partidoPorMunicipio"].get(ibge, 0)
        # posição dela entre as candidaturas COM VOTO naquele município
        no_municipio = sorted(
            (
                (chave, mapa.get(ibge, 0))
                for chave, mapa in pleito["porCandidatura"].items()
                if mapa.get(ibge, 0) > 0
            ),
            key=lambda item: -item[1],
        )
        posicao = next(
            (
                i
                for i, (chave, _) in enumerate(no_municipio, start=1)
                if chave in chaves_dela
            ),
            None,
        )
        municipios[ibge] = {
            "nome": nomes.get(ibge, ""),
            "votos": votos,
            "validos": validos,
            # None e não 0: sem denominador a taxa não existe, não é zero.
            "percentualValidos": round(votos / validos * 100, 4) if validos else None,
            "votosDoPartido": partido or None,
            "percentualDoPartido": (
                round(votos / partido * 100, 4) if partido else None
            ),
            "posicaoNoMunicipio": posicao,
            "candidaturasComVoto": len(no_municipio),
        }

    # concentração: fatia da votação vinda dos N maiores municípios
    ordenados = sorted(
        (dados["votos"] for dados in municipios.values()), reverse=True
    )
    total = pleito["focoTotal"]
    concentracao = {
        f"top{n}": round(sum(ordenados[:n]) / total * 100, 2) for n in TOPO_CONCENTRACAO
    }

    bairros = {
        ibge: {
            chave: votos
            for chave, votos in sorted(
                mapa.items(), key=lambda item: -item[1]
            )
        }
        for ibge, mapa in pleito["focoPorBairro"].items()
    }

    return {
        "id": pleito["id"],
        "electionYear": pleito["electionYear"],
        "officeCode": pleito["officeCode"],
        "officeName": pleito["officeName"],
        "round": pleito["round"],
        "electionDates": sorted(d for d in pleito["datasEleicao"] if d),
        "candidatura": {
            chave: alvo[chave]
            for chave in (
                "sqCandidato",
                "nomeCompleto",
                "nomeUrna",
                "partido",
                "numero",
                "situacaoCandidatura",
                "resultado",
            )
        },
        "votosNoEstado": total,
        "posicaoNoEstado": posicao_estadual,
        "candidaturasNoPleito": len(pleito["totalPorCandidatura"]),
        "municipiosComVoto": len(municipios),
        "concentracaoPercentual": concentracao,
        "votosSemLocalDeVotacao": pleito["secoesSemLocal"],
        "temRecorteSubmunicipal": bool(pleito["focoPorLocal"]),
        "municipios": municipios,
        "locais": dict(sorted(pleito["focoPorLocal"].items())) or None,
        "bairros": bairros or None,
    }


def escrever(payload: dict[str, Any], destino: Path) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(destino.suffix + ".tmp")
    temporario.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporario.replace(destino)


def parse_args() -> argparse.Namespace:
    raiz = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nome", required=True, help="Nome completo como no TSE.")
    parser.add_argument("--slug", help="Nome do arquivo de saída (padrão: do --nome).")
    parser.add_argument(
        "--partido",
        help="Sigla para desempatar homônimos (ex.: PT). Necessário quando o "
        "mesmo nome aparece em mais de uma candidatura no mesmo cargo e ano.",
    )
    parser.add_argument(
        "--sq",
        nargs="+",
        default=[],
        help="SQ_CANDIDATO específicos, quando nem o partido desempata.",
    )
    parser.add_argument("--sections-dir", type=Path, required=True)
    parser.add_argument("--candidates-dir", type=Path, required=True)
    parser.add_argument(
        "--places-dir",
        type=Path,
        help="Pasta com eleitorado_local_votacao_<ano>.zip. Sem ela, sai só o "
        "recorte municipal — o submunicipal é silenciosamente impossível, "
        "então o resumo avisa quais anos ficaram sem.",
    )
    parser.add_argument("--anos", type=int, nargs="+", required=True)
    parser.add_argument(
        "--electorate-file", type=Path, default=raiz / "src" / "data" / "electorate-go.json"
    )
    parser.add_argument(
        "--output-dir", type=Path, default=raiz / "src" / "data" / "candidato"
    )
    parser.add_argument(
        "--expected-municipalities",
        type=int,
        default=MUNICIPIOS,
        help="Cobertura municipal exigida. Só mude para rodar sobre o fixture "
        "sintético de testes; a produção usa o valor de scripts/estado.py.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    tse_para_ibge, nomes = carregar_municipios(
        args.electorate_file.resolve(), args.expected_municipalities
    )

    slug = args.slug or normalizar(args.nome).lower().replace(" ", "-")
    todos: list[dict[str, Any]] = []
    anos_sem_dado: list[str] = []
    anos_sem_locais: list[int] = []

    for ano in sorted(set(args.anos)):
        cadastro = args.candidates_dir / f"consulta_cand_{ano}.zip"
        secoes = args.sections_dir / f"votacao_secao_{ano}_{UF}.zip"
        if not cadastro.is_file():
            anos_sem_dado.append(f"{ano} (falta {cadastro.name})")
            continue
        if not secoes.is_file():
            anos_sem_dado.append(f"{ano} (falta {secoes.name})")
            continue

        candidaturas = localizar_candidaturas(cadastro, ano, args.nome)
        if args.sq:
            candidaturas = [c for c in candidaturas if c["sqCandidato"] in set(args.sq)]
        elif args.partido:
            alvo_partido = args.partido.strip().upper()
            candidaturas = [c for c in candidaturas if c["partido"] == alvo_partido]
        if not candidaturas:
            anos_sem_dado.append(f"{ano} (sem candidatura registrada para o nome)")
            continue

        # Homônimos disputando o MESMO cargo no MESMO ano são pessoas diferentes.
        # Somá-los produziria um total inflado com cara de verdade — então o
        # script para e exige desempate, em vez de escolher por conta própria.
        por_cargo: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for candidatura in candidaturas:
            por_cargo[candidatura["officeCode"]].append(candidatura)
        ambiguos = {
            cargo: lista for cargo, lista in por_cargo.items() if len(lista) > 1
        }
        if ambiguos:
            linhas = [
                f"Mais de uma candidatura com o nome {args.nome!r} em {ano}:"
            ]
            for cargo, lista in sorted(ambiguos.items()):
                for candidatura in lista:
                    linhas.append(
                        f"  {OFFICES.get(cargo, cargo)}: SQ={candidatura['sqCandidato']} "
                        f"· {candidatura['partido']} {candidatura['numero']} "
                        f"· urna {candidatura['nomeUrna']!r}"
                    )
            linhas.append(
                "São pessoas diferentes. Desempate com --partido SIGLA ou "
                "--sq SQ_CANDIDATO [SQ_CANDIDATO ...]."
            )
            raise SystemExit("\n".join(linhas))

        print(f"\n=== {ano} ===")
        for candidatura in candidaturas:
            print(
                f"  candidatura: {candidatura['nomeCompleto']} "
                f"({candidatura['nomeUrna']}, {candidatura['partido']} "
                f"{candidatura['numero']}) · {candidatura['officeName']} "
                f"· {candidatura['resultado'] or 'situação não informada'}"
            )

        locais = None
        if args.places_dir:
            arquivo_locais = args.places_dir / f"eleitorado_local_votacao_{ano}.zip"
            if arquivo_locais.is_file():
                locais = carregar_locais(arquivo_locais, tse_para_ibge)
                print(f"  cadastro de locais: {len(locais):,} seções mapeadas")
            else:
                anos_sem_locais.append(ano)

        alvos_por_sq = {c["sqCandidato"]: c for c in candidaturas}
        pleitos, diagnostico = apurar(
            secoes, ano, alvos_por_sq, tse_para_ibge, locais
        )
        estrategias = sorted(diagnostico["estrategias"])
        if estrategias and estrategias != ["SQ_CANDIDATO"]:
            print(f"  identificação da candidatura: {', '.join(estrategias)}")
        if diagnostico["colunasSemIdentificacao"]:
            print(
                "  ALERTA: sem SQ_CANDIDATO nem número de urna em "
                f"{', '.join(diagnostico['colunasSemIdentificacao'])} — "
                "esses arquivos ficaram de fora."
            )

        pleitos_do_ano = 0
        for pleito in pleitos.values():
            alvo = next(
                (
                    c
                    for c in candidaturas
                    if c["officeCode"] == pleito["officeCode"]
                ),
                None,
            )
            if alvo is None:
                continue
            consolidado = consolidar(pleito, alvo, nomes, locais)
            if consolidado is None:
                continue
            todos.append(consolidado)
            pleitos_do_ano += 1
            print(
                f"  {consolidado['id']} {consolidado['officeName']} "
                f"turno {consolidado['round']}: {consolidado['votosNoEstado']:,} votos "
                f"· {consolidado['municipiosComVoto']} municípios "
                f"· {consolidado['posicaoNoEstado']}º no estado "
                f"· top5 = {consolidado['concentracaoPercentual']['top5']}%"
                + (
                    f" · {len(consolidado['locais'] or {})} locais"
                    if consolidado["temRecorteSubmunicipal"]
                    else ""
                )
            )

        # Ano com candidatura registrada e nenhum voto casado é sintoma, não
        # resultado. Antes isto sumia do resumo sem uma linha sequer — foi
        # exatamente o que aconteceu com 2014 na primeira geração de Goiás.
        if pleitos_do_ano == 0:
            cargos = ", ".join(sorted({c["officeName"] for c in candidaturas}))
            anos_sem_dado.append(
                f"{ano} (candidatura de {cargos} localizada no cadastro, mas "
                f"nenhum voto casou com ela em {secoes.name})"
            )
            print(
                f"  ALERTA: nenhum voto casou em {ano}. "
                f"{diagnostico['linhasLidas']:,} linhas lidas, "
                f"{diagnostico['linhasNominais']:,} nominais de {UF}. "
                f"Chave usada: {', '.join(estrategias) or 'nenhuma'}."
            )
            for candidatura in candidaturas:
                print(
                    f"    procurado: SQ={candidatura['sqCandidato']} · "
                    f"UE={candidatura['sgUe']} · nº {candidatura['numero']} · "
                    f"cargo {candidatura['officeCode']}"
                )

    if not todos:
        raise SystemExit(
            "Nenhuma votação encontrada. Confira o --nome exatamente como o TSE "
            "registra e se os pacotes dos anos pedidos estão nas pastas informadas."
        )

    todos.sort(key=lambda p: (-p["electionYear"], p["officeCode"], p["round"]))
    payload = {
        "metadata": {
            "schemaVersion": SCHEMA_VERSION,
            "state": UF,
            "nomeConsultado": args.nome,
            "slug": slug,
            "processedAtUtc": datetime.now(UTC).isoformat(timespec="seconds"),
            "pleitos": len(todos),
            "anos": sorted({p["electionYear"] for p in todos}),
            "cargos": sorted({p["officeName"] for p in todos}),
            "anosSemDado": anos_sem_dado,
            "anosSemCadastroDeLocais": anos_sem_locais,
            "source": "Tribunal Superior Eleitoral — Dados Abertos",
            "sourceUrl": SECTIONS_URL,
            "candidatesUrl": CANDIDATES_URL,
            "privacyLevel": "Resultados públicos agregados; nenhum dado de eleitor.",
        },
        "contests": todos,
    }

    destino = args.output_dir.resolve() / f"{slug}.json"
    if args.dry_run:
        print(f"\n--dry-run: nada gravado (seria {destino}).")
    else:
        escrever(payload, destino)
        print(f"\nJSON gerado: {destino}")

    print(f"\nResumo: {len(todos)} pleitos, anos {payload['metadata']['anos']}.")
    if anos_sem_dado:
        print("ALERTA: anos sem dado processado:")
        for aviso in anos_sem_dado:
            print(f"  - {aviso}")
    if anos_sem_locais:
        print(
            f"ALERTA: sem cadastro de locais em {anos_sem_locais} — esses anos saem "
            "só com recorte municipal, sem bairro."
        )


if __name__ == "__main__":
    main()
