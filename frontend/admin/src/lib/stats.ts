// Elaborazione dei dati di /stats per la UI (funzioni pure, testate).

import type { DayDownloads, ProductDownloads } from '../api/types';

export interface Bar {
  day: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarLayout {
  bars: Bar[];
  max: number;
  /** Altezza del grafico (asse y a 0 in basso). */
  height: number;
  width: number;
}

/** Valore massimo mostrato: almeno 1 (serie tutta a zero) per evitare divisioni per zero. */
export function chartMax(points: readonly DayDownloads[]): number {
  return Math.max(1, ...points.map((p) => (Number.isFinite(p.count) ? Math.max(0, p.count) : 0)));
}

/**
 * Geometria delle barre in un viewBox `width` x `height`. Le barre con conteggio > 0 hanno sempre
 * almeno `minBar` unità di altezza (visibili); quelle a zero hanno altezza 0.
 */
export function barLayout(
  points: readonly DayDownloads[],
  { width = 560, height = 140, gap = 6, minBar = 2 } = {},
): BarLayout {
  const max = chartMax(points);
  if (points.length === 0) return { bars: [], max, height, width };
  const slot = width / points.length;
  const barWidth = Math.max(1, slot - gap);
  const bars = points.map((point, index) => {
    const count = Number.isFinite(point.count) ? Math.max(0, point.count) : 0;
    const h = count === 0 ? 0 : Math.max(minBar, (count / max) * height);
    return {
      day: point.day,
      count,
      x: index * slot + (slot - barWidth) / 2,
      y: height - h,
      width: barWidth,
      height: h,
    };
  });
  return { bars, max, height, width };
}

/** "2026-11-18" -> "18/11" (senza passare da Date: nessuno slittamento di fuso orario). */
export function shortDay(day: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[2]}/${match[1]}` : day;
}

export function sumCounts(points: readonly { count: number }[]): number {
  return points.reduce((total, p) => total + (Number.isFinite(p.count) ? p.count : 0), 0);
}

export interface ProductShare extends ProductDownloads {
  /** Percentuale 0-100 rispetto al prodotto più scaricato (per la barra), arrotondata. */
  percent: number;
}

/** Prodotti ordinati per download decrescenti (a parità, per codice). */
export function productShares(items: readonly ProductDownloads[]): ProductShare[] {
  const sorted = [...items].sort(
    (a, b) => b.count - a.count || a.product_code.localeCompare(b.product_code),
  );
  const top = Math.max(1, sorted[0]?.count ?? 0);
  return sorted.map((item) => ({ ...item, percent: Math.round((item.count / top) * 100) }));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('it-IT').format(value);
}
