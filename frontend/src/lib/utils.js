import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Valor monetário; `null`/`undefined` viram travessão, nunca R$ 0,00. */
export function money(value, currency = 'BRL') {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency });
}

export function num(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('pt-BR');
}
