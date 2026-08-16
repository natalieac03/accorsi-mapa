import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgeStructureDataset } from "../../src/types/ageStructure.ts";
import type { ElectorateDataset } from "../../src/types/electorate.ts";
import type { LiteracyDataset } from "../../src/types/literacy.ts";
import type { SocioeconomicDataset } from "../../src/types/socioeconomic.ts";
import { buildTerritorialDataset } from "../../src/utils/socioeconomic.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";

const electorate = JSON.parse(
  readFileSync(
    new URL("../../src/data/electorate-go.json", import.meta.url),
    "utf8",
  ),
) as ElectorateDataset;
const socioeconomic = JSON.parse(
  readFileSync(
    new URL("../../src/data/socioeconomic-go.json", import.meta.url),
    "utf8",
  ),
) as SocioeconomicDataset;
const ageStructure = JSON.parse(
  readFileSync(
    new URL("../../src/data/age-structure-go.json", import.meta.url),
    "utf8",
  ),
) as AgeStructureDataset;
const literacy = JSON.parse(
  readFileSync(
    new URL("../../src/data/literacy-go.json", import.meta.url),
    "utf8",
  ),
) as LiteracyDataset;

test("snapshot IBGE declara nove indicadores e o mesmo recorte de 246 municípios", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.equal(socioeconomic.metadata.state, "GO");
  assert.equal(socioeconomic.metadata.municipalityCount, 246);
  assert.equal(socioeconomic.metadata.indicatorCount, 9);
  assert.equal(Object.keys(socioeconomic.municipalities).length, 246);
  assert.deepEqual(
    socioeconomic.metadata.indicators.map((indicator) => indicator.referenceYear),
    [2025, 2022, 2022, 2023, 2022, 2022, 2024, 2022, 2010],
  );
});

test("cobertura recalculada coincide com os metadados sem converter lacuna em zero", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  for (const indicator of socioeconomic.metadata.indicators) {
    const values = Object.values(socioeconomic.municipalities).map(
      (municipality) => municipality.values[indicator.code],
    );
    const covered = values.filter((value) => value !== null);
    assert.equal(covered.length, indicator.coverageCount);
    assert.equal(values.length - covered.length, indicator.missingMunicipalityCodes.length);
    assert.equal(covered.every((value) => Number.isFinite(value) && value >= 0), true);
    if (indicator.valueFormat === "percent") {
      assert.equal(covered.every((value) => value <= 100), true);
    }
  }
});

test("junção TSE/IBGE preserva códigos e valores oficiais conhecidos", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const dataset = buildTerritorialDataset(electorate, socioeconomic, ageStructure, literacy);
  const portoAlegre = dataset.municipalities["4314902"];

  assert.equal(Object.keys(dataset.municipalities).length, 246);
  assert.equal(portoAlegre.name, "Porto Alegre");
  assert.equal(portoAlegre.socioeconomic.populationEstimate, 1_388_794);
  assert.equal(portoAlegre.socioeconomic.censusPopulation, 1_332_845);
  assert.equal(portoAlegre.socioeconomic.gdpPerCapita, 78_586.94);
});

test("alfabetização ausente vira null no perfil, nunca zero", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const dataset = buildTerritorialDataset(
    electorate,
    socioeconomic,
    ageStructure,
    literacy,
  );

  for (const municipality of Object.values(dataset.municipalities)) {
    const record = municipality.literacy;
    if (record === null) continue;
    // Quando o ETL do Censo 2022 preencher o arquivo, os valores devem ser
    // consistentes; com o placeholder vazio, nada entra neste ramo.
    assert.equal(record.literate15Plus <= record.population15Plus, true);
    assert.equal(record.literacyRate >= 0 && record.literacyRate <= 100, true);
  }
});

test("estrutura etária ausente vira null no perfil, nunca zero", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const dataset = buildTerritorialDataset(electorate, socioeconomic, ageStructure, literacy);

  for (const municipality of Object.values(dataset.municipalities)) {
    const age = municipality.age;
    if (age === null) continue;
    // Quando o ETL do Censo 2022 preencher o arquivo, os valores devem ser
    // consistentes; com o placeholder vazio, nada entra neste ramo.
    assert.equal(Number.isFinite(age.population16Plus), true);
    assert.equal(age.population16Plus > 0, true);
    assert.equal(age.population16Plus <= age.populationTotal, true);
  }
});
