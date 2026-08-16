import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CepLookupError,
  parseViaCepResponse,
} from "../../src/services/cep.ts";
import type { MunicipalitySearchOption } from "../../src/types/search.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";
import {
  buildCepLocationLabel,
  classifyTerritorialPlace,
  extractTerritorialAddressParts,
  formatCep,
  getCepDigits,
  isCepQuery,
  isCompleteCep,
  isInsideRsBoundingBox,
  isRioGrandeDoSulAddress,
  normalizeSearchText,
  resolveMunicipalityFromAddress,
  searchMunicipalities,
} from "../../src/utils/search.ts";

const municipalities: MunicipalitySearchOption[] = [
  { id: "4318705", name: "São Leopoldo", electorate: 170_000 },
  { id: "4314902", name: "Porto Alegre", electorate: 1_061_485 },
  { id: "4304606", name: "Canoas", electorate: 252_875 },
  { id: "4316907", name: "Santa Maria", electorate: 210_000 },
];

const electorateDataset = JSON.parse(
  readFileSync(
    new URL("../../src/data/electorate-go.json", import.meta.url),
    "utf8",
  ),
) as {
  municipalities: Record<
    string,
    { ibgeCode: string; name: string; electorate: number }
  >;
};

test("normaliza acentos, pontuação e caixa", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(normalizeSearchText("  São-Leopoldo/RS "), "sao leopoldo rs");
});

test("busca município sem exigir acentos", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(
    searchMunicipalities("sao leo", municipalities)[0]?.name,
    "São Leopoldo",
  );
  assert.equal(
    searchMunicipalities("cano", municipalities)[0]?.id,
    "4304606",
  );
});

test("índice real contém 246 municípios pesquisáveis e sem nomes duplicados", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const realMunicipalities = Object.values(
    electorateDataset.municipalities,
  ).map((municipality) => ({
    id: municipality.ibgeCode,
    name: municipality.name,
    electorate: municipality.electorate,
  }));
  const normalizedNames = new Set(
    realMunicipalities.map((municipality) =>
      normalizeSearchText(municipality.name),
    ),
  );

  assert.equal(realMunicipalities.length, 246);
  assert.equal(normalizedNames.size, 246);
  assert.equal(
    searchMunicipalities("sao leopoldo", realMunicipalities)[0]?.id,
    "4318705",
  );
});

test("valida e formata CEP", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(getCepDigits("90010-150"), "90010150");
  assert.equal(formatCep("90010150"), "90010-150");
  assert.equal(isCepQuery("90010-150"), true);
  assert.equal(isCompleteCep("90010-150"), true);
  assert.equal(isCompleteCep("90010"), false);
  assert.equal(isCepQuery("Porto Alegre"), false);
});

test("valida respostas do ViaCEP antes de usar o código IBGE", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const result = parseViaCepResponse({
    cep: "90010-150",
    logradouro: "Rua dos Andradas",
    complemento: "",
    bairro: "Centro Histórico",
    localidade: "Porto Alegre",
    uf: "GO",
    ibge: "4314902",
  });

  assert.equal(result.ibge, "4314902");
  assert.throws(
    () => parseViaCepResponse({ erro: "true" }),
    (error: unknown) =>
      error instanceof CepLookupError && error.code === "NOT_FOUND",
  );
  assert.throws(
    () =>
      parseViaCepResponse({
        cep: "74000-000",
        localidade: "Goiânia",
        uf: "GO",
        ibge: "5208707",
      }),
    (error: unknown) =>
      error instanceof CepLookupError && error.code === "OUTSIDE_RS",
  );
});

test("preserva logradouro, bairro e CEP no rótulo territorial", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const label = buildCepLocationLabel({
    cep: "90010-150",
    logradouro: "Rua dos Andradas",
    complemento: "lado ímpar",
    bairro: "Centro Histórico",
    localidade: "Porto Alegre",
    uf: "GO",
  });

  assert.equal(label.title, "Rua dos Andradas · Centro Histórico");
  assert.match(label.address, /Centro Histórico/);
  assert.match(label.address, /90010-150/);
});

test("extrai o recorte de bairro e endereço dos componentes do Google", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const parts = extractTerritorialAddressParts([
    {
      longText: "Moinhos de Vento",
      shortText: "Moinhos de Vento",
      types: ["neighborhood"],
    },
    {
      longText: "Rua Padre Chagas",
      shortText: "R. Padre Chagas",
      types: ["route"],
    },
    {
      longText: "90570-080",
      shortText: "90570-080",
      types: ["postal_code"],
    },
  ]);

  assert.deepEqual(parts, {
    cep: "90570-080",
    neighborhood: "Moinhos de Vento",
    street: "Rua Padre Chagas",
  });
  assert.equal(classifyTerritorialPlace(["neighborhood", "political"], parts), "neighborhood");
  assert.equal(classifyTerritorialPlace(["route"], parts), "address");
});

test("reconhece o estado retornado pelo endereço", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(
    isRioGrandeDoSulAddress([
      {
        longText: "Goiás",
        shortText: "GO",
        types: ["administrative_area_level_1"],
      },
    ]),
    true,
  );
  assert.equal(
    isRioGrandeDoSulAddress([
      {
        longText: "Santa Catarina",
        shortText: "SC",
        types: ["administrative_area_level_1"],
      },
    ]),
    false,
  );
  assert.equal(isRioGrandeDoSulAddress([]), null);
});

test("relaciona componente administrativo ao município local", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const result = resolveMunicipalityFromAddress(
    [
      {
        longText: "Porto Alegre",
        shortText: "Porto Alegre",
        types: ["administrative_area_level_2"],
      },
    ],
    "Moinhos de Vento",
    municipalities,
  );

  assert.equal(result?.id, "4314902");
});

test("faz a triagem inicial pela caixa geográfica de Goiás", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(
    isInsideRsBoundingBox({ lat: -30.0346, lng: -51.2177 }),
    true,
  );
  assert.equal(
    isInsideRsBoundingBox({ lat: -16.6869, lng: -49.2648 }),
    false,
  );
});
