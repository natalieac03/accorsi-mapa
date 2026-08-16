const integerFormatter = new Intl.NumberFormat("pt-BR");

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export const ELECTORATE_COLORS = [
  "#fde3e1",
  "#f6a7a1",
  "#e85d55",
  "#c1121f",
  "#780000",
] as const;

export const MISSING_DATA_COLOR = "#788382";

export function formatInteger(value: number) {
  return integerFormatter.format(value);
}

export function formatPercent(value: number) {
  return `${decimalFormatter.format(value)}%`;
}

export function formatDecimal(value: number) {
  return decimalFormatter.format(value);
}

export function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function formatPercentagePoints(value: number) {
  return `${decimalFormatter.format(value)} p.p.`;
}

export function percentage(part: number, total: number) {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

export function getElectorateColor(value: number, thresholds: number[]) {
  const bucket = thresholds.findIndex((threshold) => value <= threshold);
  return ELECTORATE_COLORS[bucket === -1 ? ELECTORATE_COLORS.length - 1 : bucket];
}
