import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  const formatted = new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(Math.abs(value)));
  return `${value < 0 ? '-' : ''}$${formatted}`;
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** Compact pesos colombianos for tight chart labels. Avoids "$1.2M", which looks like USD. */
export function formatCompact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    return `${sign}$${millions.toLocaleString('es-CO', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} mill.`;
  }
  if (abs >= 10_000) {
    return `${sign}$${Math.round(abs / 1_000).toLocaleString('es-CO')} mil`;
  }
  return formatCurrency(value);
}

export function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
