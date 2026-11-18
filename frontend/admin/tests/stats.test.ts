import { describe, expect, it } from 'vitest';
import { barLayout, chartMax, productShares, shortDay, sumCounts } from '../src/lib/stats';

const days = (counts: number[]) =>
  counts.map((count, i) => ({ day: `2026-11-${String(1 + i).padStart(2, '0')}`, count }));

describe('stats shaping', () => {
  it('chartMax never returns 0 (all-zero series)', () => {
    expect(chartMax(days([0, 0, 0]))).toBe(1);
    expect(chartMax(days([]))).toBe(1);
    expect(chartMax(days([3, 9, 4]))).toBe(9);
  });

  it('barLayout scales to the max, keeps zeros at height 0 and small values visible', () => {
    const { bars, max } = barLayout(days([0, 1, 100]), {
      width: 300,
      height: 100,
      gap: 10,
      minBar: 2,
    });
    expect(max).toBe(100);
    expect(bars).toHaveLength(3);
    expect(bars[0]?.height).toBe(0);
    expect(bars[1]?.height).toBe(2); // 1% = 1, alzato al minimo visibile
    expect(bars[2]).toMatchObject({ height: 100, y: 0 });
    // le barre non si sovrappongono e restano nel viewBox
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(300);
      expect(bar.y + bar.height).toBe(100);
    }
    expect((bars[1]?.x ?? 0) >= (bars[0]?.x ?? 0) + (bars[0]?.width ?? 0)).toBe(true);
  });

  it('barLayout ignores negative / non-finite counts and handles empty input', () => {
    const { bars } = barLayout(days([-5, Number.NaN, 4]));
    expect(bars.map((b) => b.count)).toEqual([0, 0, 4]);
    expect(barLayout([]).bars).toEqual([]);
  });

  it('shortDay formats YYYY-MM-DD as DD/MM without timezone shifts', () => {
    expect(shortDay('2026-11-05')).toBe('05/11');
    expect(shortDay('oggi')).toBe('oggi');
  });

  it('sumCounts', () => {
    expect(sumCounts(days([1, 2, 3]))).toBe(6);
  });

  it('productShares sorts by count (then code) and scales to the top product', () => {
    const shares = productShares([
      { product_code: 'b', count: 5 },
      { product_code: 'a', count: 5 },
      { product_code: 'c', count: 10 },
      { product_code: 'z', count: 0 },
    ]);
    expect(shares.map((s) => s.product_code)).toEqual(['c', 'a', 'b', 'z']);
    expect(shares.map((s) => s.percent)).toEqual([100, 50, 50, 0]);
    expect(productShares([])).toEqual([]);
  });
});
