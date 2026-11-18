import { describe, expect, it } from 'vitest';
import type { ProductInput } from '../src/api/types';
import {
  dateToValidUntil,
  looksLikeEmail,
  validateObjectKey,
  validateProduct,
  validUntilToDate,
} from '../src/lib/validation';
import { describeAudience, isSending, progressPercent } from '../src/lib/campaigns';

const valid: ProductInput = {
  code: 'launcher_core',
  name: 'NZT Launcher',
  version: '1.2.0',
  filename: 'NZT-Launcher.exe',
  object_key: 'binaries/launcher/1.2.0/NZT-Launcher.exe',
  sha256: 'a'.repeat(64),
  is_active: true,
};

describe('product validation (contract rules)', () => {
  it('accepts a valid entry', () => {
    expect(validateProduct(valid)).toEqual({});
  });

  it.each(['A', 'x', 'Has-Dash', 'UPPER', 'a'.repeat(65), 'spazio qui'])(
    'rejects code %j',
    (code) => {
      expect(validateProduct({ ...valid, code }).code).toBeDefined();
    },
  );

  it.each([
    ['launcher/x.exe', /binaries/],
    ['binaries/../secret', /\.\./],
    ['binaries/a b.exe', /ammessi/],
    ['binaries/è.exe', /ammessi/],
    ['binaries/dir/', /file/],
  ])('rejects object_key %j', (key, expected) => {
    expect(validateObjectKey(key)).toMatch(expected);
  });

  it('sha256 must be 64 lowercase hex', () => {
    expect(validateProduct({ ...valid, sha256: 'A'.repeat(64) }).sha256).toBeDefined();
    expect(validateProduct({ ...valid, sha256: 'a'.repeat(63) }).sha256).toBeDefined();
    expect(validateProduct({ ...valid, sha256: 'g'.repeat(64) }).sha256).toBeDefined();
  });

  it('requires name, version and filename', () => {
    const errors = validateProduct({ ...valid, name: ' ', version: '', filename: '' });
    expect(Object.keys(errors).sort()).toEqual(['filename', 'name', 'version']);
  });
});

describe('dates and emails', () => {
  it('valid_until conversion', () => {
    expect(dateToValidUntil('2027-01-31')).toBe('2027-01-31T23:59:59Z');
    expect(dateToValidUntil('')).toBeNull();
    expect(dateToValidUntil('31/01/2027')).toBeNull();
    expect(validUntilToDate('2027-01-31T23:59:59Z')).toBe('2027-01-31');
    expect(validUntilToDate(null)).toBe('');
  });

  it('looksLikeEmail', () => {
    expect(looksLikeEmail(' admin@example.com ')).toBe(true);
    expect(looksLikeEmail('admin@')).toBe(false);
    expect(looksLikeEmail('a b@c.d')).toBe(false);
  });
});

describe('campaign helpers', () => {
  it('describes the audience shown in the confirmation step', () => {
    expect(describeAudience({ kind: 'communication', product_code: null })).toBe(
      'tutti i clienti verificati e attivi',
    );
    expect(describeAudience({ kind: 'communication', product_code: 'launcher_core' })).toContain(
      'launcher_core',
    );
    expect(describeAudience({ kind: 'marketing', product_code: null })).toMatch(
      /consenso marketing/,
    );
  });

  it('polls only while a campaign is sending', () => {
    expect(isSending([{ status: 'draft' }, { status: 'sent' }])).toBe(false);
    expect(isSending([{ status: 'sending' }])).toBe(true);
    expect(isSending(null)).toBe(false);
  });

  it('progressPercent is clamped and safe for 0 recipients', () => {
    expect(progressPercent({ recipients: 0, sent: 0, failed: 0 })).toBe(0);
    expect(progressPercent({ recipients: 10, sent: 4, failed: 1 })).toBe(50);
    expect(progressPercent({ recipients: 10, sent: 20, failed: 0 })).toBe(100);
  });
});
