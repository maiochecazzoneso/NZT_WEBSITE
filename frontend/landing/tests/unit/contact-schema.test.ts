import { describe, expect, it } from 'vitest';
import { contactRequestSchema, contactSchema } from '@/lib/contact-schema';

const valid = {
  name: 'Mario Rossi',
  email: 'mario.rossi@example.com',
  company: 'ACME Srl',
  phone: '+39 02 1234567',
  service: 'generale',
  message: 'Buongiorno,\nvorrei un confronto.',
};

describe('schema del modulo contatti', () => {
  it('accetta un payload valido e rimuove gli spazi esterni', () => {
    const parsed = contactRequestSchema.parse({ ...valid, name: '  Mario Rossi  ' });
    expect(parsed.name).toBe('Mario Rossi');
  });

  it('rifiuta chiavi non previste (anti mass-assignment)', () => {
    expect(contactRequestSchema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
    expect(contactRequestSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, turnstileToken: 'x' }).success).toBe(false);
  });

  it('rifiuta oggetti e array al posto degli scalari (operator injection)', () => {
    for (const injected of [{ $gt: '' }, { $ne: null }, ['a@b.it'], 42, null]) {
      expect(contactRequestSchema.safeParse({ ...valid, email: injected }).success).toBe(false);
      expect(contactRequestSchema.safeParse({ ...valid, name: injected }).success).toBe(false);
    }
  });

  it('rifiuta valori di servizio fuori elenco', () => {
    expect(contactRequestSchema.safeParse({ ...valid, service: 'admin' }).success).toBe(false);
  });

  it('rifiuta a capo e caratteri di controllo nei campi a riga singola (header injection)', () => {
    for (const field of ['name', 'company'] as const) {
      for (const payload of ['ACME\r\nBcc: x@evil.example', 'ACME\nSrl', 'AC\u0000ME', 'AC ME']) {
        expect(contactRequestSchema.safeParse({ ...valid, [field]: payload }).success).toBe(false);
      }
    }
    expect(
      contactRequestSchema.safeParse({ ...valid, email: 'a@b.it\r\nBcc: x@evil.example' }).success,
    ).toBe(false);
  });

  it('ammette gli a capo nel messaggio ma non gli altri caratteri di controllo', () => {
    expect(
      contactRequestSchema.safeParse({ ...valid, message: 'riga 1\r\nriga 2\tfine' }).success,
    ).toBe(true);
    expect(contactRequestSchema.safeParse({ ...valid, message: 'testo\u0000nullo' }).success).toBe(
      false,
    );
    expect(contactRequestSchema.safeParse({ ...valid, message: 'testo\u001b[31m' }).success).toBe(
      false,
    );
  });

  it('applica le lunghezze massime', () => {
    expect(contactRequestSchema.safeParse({ ...valid, name: 'a'.repeat(121) }).success).toBe(false);
    expect(contactRequestSchema.safeParse({ ...valid, message: 'a'.repeat(4001) }).success).toBe(
      false,
    );
    expect(
      contactRequestSchema.safeParse({ ...valid, email: `${'a'.repeat(250)}@b.it` }).success,
    ).toBe(false);
    expect(
      contactRequestSchema.safeParse({ ...valid, turnstileToken: 'a'.repeat(2049) }).success,
    ).toBe(false);
  });

  it('rifiuta email e telefoni malformati', () => {
    for (const email of ['non-una-email', 'a@b', '<script>@x.it', 'a b@c.it']) {
      expect(contactRequestSchema.safeParse({ ...valid, email }).success).toBe(false);
    }
    expect(
      contactRequestSchema.safeParse({ ...valid, phone: '<script>alert(1)</script>' }).success,
    ).toBe(false);
    expect(contactRequestSchema.safeParse({ ...valid, phone: '' }).success).toBe(true);
  });
});
