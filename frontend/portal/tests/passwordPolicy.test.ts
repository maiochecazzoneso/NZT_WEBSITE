import { describe, expect, it } from 'vitest';
import {
  looksLikeEmail,
  passwordLength,
  passwordPolicyViolations,
  type PasswordRule,
} from '../src/lib/passwordPolicy';

// Vettori generati eseguendo app.security.passwords.password_policy_errors del backend
// (Python 3.12) sugli stessi input: il client deve dare ESATTAMENTE lo stesso esito.
const BACKEND_VECTORS: Array<[string, PasswordRule[]]> = [
  ['', ['minLength', 'digit', 'special', 'letter']],
  ['short1!', ['minLength']],
  ['abcdefghijkl', ['digit', 'special']],
  ['abcdefghij12', ['special']],
  ['abcdefghij!!', ['digit']],
  ['123456789012!', ['letter']],
  ['SuperSecurePassword123!', []],
  ['correct horse 1', ['special']],
  ['correct horse 1!', []],
  ['àèìòùàèìòù1!', []],
  ['αβγδεζηθικλμ1_', []],
  ['________1aaa', []],
  ['aaaaaaaaaaa1!', []],
  ['a'.repeat(120) + '12345678', ['special']],
  ['a'.repeat(127) + '1!', ['maxLength']],
  ['abc def ghi 1 ', ['special']],
  ['ab́cdefghij1x', []],
  ['١٢٣٤٥٦٧٨٩٠١٢a!', []],
  ['abcdefghijk½!', ['digit']],
  ['abcdefghijk1﻿', []],
  ['abcdefghijk1\u001c', ['special']],
  ['\u{1F600}'.repeat(10) + 'a1', []],
  ['Ⅻ'.repeat(11) + '1!', []],
];

describe('password policy mirrors the backend (D-A9)', () => {
  it.each(BACKEND_VECTORS)('%j -> %j', (password, expected) => {
    expect(passwordPolicyViolations(password)).toEqual(expected);
  });

  it('counts code points like Python len()', () => {
    expect(passwordLength('\u{1F600}')).toBe(1);
    expect('\u{1F600}'.length).toBe(2);
  });
});

describe('looksLikeEmail', () => {
  it.each([
    ['mario@example.com', true],
    ['  mario@example.com ', true],
    ['mario@example', false],
    ['mario example.com', false],
    ['', false],
    [`${'a'.repeat(251)}@x.it`, false],
  ])('%s -> %s', (value, expected) => {
    expect(looksLikeEmail(value)).toBe(expected);
  });
});
