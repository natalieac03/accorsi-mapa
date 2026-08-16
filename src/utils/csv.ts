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
  // Formula-injection guard: prefix a leading =, +, - or @ with an apostrophe,
  // except when the cell is a plain number (e.g. "-0,007"), which spreadsheet
  // apps must keep parsing as a numeric value.
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
