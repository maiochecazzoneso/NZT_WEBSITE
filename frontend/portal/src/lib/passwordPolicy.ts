// Policy password: specchio ESATTO di app/security/passwords.py del backend (D-A9).
// Python `re` con stringhe str è Unicode-aware: \w = str.isalnum() oppure "_" (≈ [\p{L}\p{N}_]),
// \d = cifra decimale Unicode (Nd), \s = str.isspace(). Quindi: lettera = [^\W\d_] (alfanumerico
// che non è cifra decimale), speciale = [^\w\s] oppure "_". Lunghezza in code point (len() Python).

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRule = 'minLength' | 'maxLength' | 'digit' | 'special' | 'letter';

const DIGIT = /\p{Nd}/u;
const ALNUM = /[\p{L}\p{N}]/u;
const JS_SPACE = /\s/u;

/** str.isspace() di Python: \s JS + separatori 0x1C–0x1F e NEL (0x85), escluso BOM (U+FEFF). */
function isPythonSpace(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0xfeff) return false;
  if ((code >= 0x1c && code <= 0x1f) || code === 0x85) return true;
  return JS_SPACE.test(ch);
}

export const PASSWORD_RULES: ReadonlyArray<{ rule: PasswordRule; label: string }> = [
  { rule: 'minLength', label: `Almeno ${PASSWORD_MIN_LENGTH} caratteri` },
  { rule: 'digit', label: 'Almeno un numero' },
  { rule: 'special', label: 'Almeno un carattere speciale (es. ! ? # _ -)' },
  { rule: 'letter', label: 'Almeno una lettera' },
];

export function passwordLength(password: string): number {
  return Array.from(password).length;
}

function hasLetter(password: string): boolean {
  for (const ch of password) {
    if (ALNUM.test(ch) && !DIGIT.test(ch)) return true;
  }
  return false;
}

function hasSpecial(password: string): boolean {
  for (const ch of password) {
    if (ch === '_') return true;
    if (!ALNUM.test(ch) && !isPythonSpace(ch)) return true;
  }
  return false;
}

export function passwordPolicyViolations(password: string): PasswordRule[] {
  const violations: PasswordRule[] = [];
  const length = passwordLength(password);
  if (length < PASSWORD_MIN_LENGTH) violations.push('minLength');
  if (length > PASSWORD_MAX_LENGTH) violations.push('maxLength');
  if (!DIGIT.test(password)) violations.push('digit');
  if (!hasSpecial(password)) violations.push('special');
  if (!hasLetter(password)) violations.push('letter');
  return violations;
}

/** Controllo minimo lato client (il backend valida con email-validator). */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
