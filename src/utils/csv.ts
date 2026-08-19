export type CsvCell = string | number;

export function formatCsvDecimal(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(".", ",");
}

const NUMERIC_CELL_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

export function escapeCsvCell(value: CsvCell) {
  const original = String(value);
  // Proteção contra injeção de fórmula: prefixa =, +, - ou @ com apóstrofo,
  // exceto em número puro (ex.: "-0,007"), que a planilha deve ler como número.
  const needsProtection =
    /^[=+\-@]/.test(original) && !NUMERIC_CELL_PATTERN.test(original);
  const protectedValue = needsProtection ? `'${original}` : original;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function createCsv(headers: string[], rows: CsvCell[][]) {
  const header = headers.map(escapeCsvCell).join(";");
  const body = rows.map((row) => row.map(escapeCsvCell).join(";")).join("\n");
  return `\uFEFF${header}\n${body}${body ? "\n" : ""}`;
}
