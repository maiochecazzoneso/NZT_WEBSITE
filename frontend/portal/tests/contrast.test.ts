import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Contrasto WCAG 2.x calcolato sui token reali di @nzt/ui (frontend/ui/src/styles/tokens.css).
const css = readFileSync(
  new URL('../../ui/src/styles/tokens.css', import.meta.url),
  'utf8',
);

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match?.[1]) throw new Error(`token ${name} not found`);
  return match[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('token contrast (WCAG AA, text >= 4.5:1)', () => {
  const text = ['text-primary', 'text-muted'];
  const backgrounds = ['bg-primary', 'bg-surface', 'bg-surface-elevated'];
  for (const fg of text) {
    for (const bg of backgrounds) {
      it(`${fg} on ${bg}`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('primary button text (#050505 on #FAFAFA)', () => {
    expect(contrast('#050505', '#fafafa')).toBeGreaterThanOrEqual(4.5);
  });

  it('text-subtle is NOT text-safe (portal never uses it for text)', () => {
    expect(contrast(token('text-subtle'), token('bg-primary'))).toBeLessThan(4.5);
  });
});
