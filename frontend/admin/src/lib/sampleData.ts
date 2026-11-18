// Dati di esempio STATICI (fittizi) per l'anteprima dell'interfaccia: nessuna chiamata di rete.
// Le forme coincidono con docs/admin_api_contract.md, così il collegamento all'API sarà immediato.

import type { AuditEntry, Campaign, Customer, Product, Stats } from '../api/types';

export const SAMPLE_STATS: Stats = {
  users_total: 128,
  users_verified: 97,
  users_new_7d: 9,
  users_new_30d: 34,
  marketing_consents: 41,
  downloads_total: 352,
  downloads_7d: 58,
  downloads_by_product: [
    { product_code: 'launcher_core', count: 280 },
    { product_code: 'toolkit_pro', count: 72 },
  ],
  downloads_per_day: [3, 5, 2, 0, 7, 9, 4, 6, 1, 0, 8, 12, 5, 7].map((count, i) => ({
    day: `2026-11-${String(5 + i).padStart(2, '0')}`,
    count,
  })),
  campaigns_sent: 3,
};

export const SAMPLE_CUSTOMERS: Customer[] = [
  {
    id: 1,
    email: 'mario.rossi@example.com',
    role: 'customer',
    is_verified: true,
    is_active: true,
    marketing_consent: true,
    created_at: '2026-09-02T09:15:00Z',
    entitlements: [{ product_code: 'launcher_core', is_enabled: true, valid_until: null }],
  },
  {
    id: 2,
    email: 'giulia.bianchi@example.com',
    role: 'customer',
    is_verified: true,
    is_active: true,
    marketing_consent: false,
    created_at: '2026-10-11T14:40:00Z',
    entitlements: [
      { product_code: 'launcher_core', is_enabled: true, valid_until: '2027-01-31T23:59:59Z' },
      { product_code: 'toolkit_pro', is_enabled: false, valid_until: null },
    ],
  },
  {
    id: 3,
    email: 'luca.verdi@example.com',
    role: 'customer',
    is_verified: false,
    is_active: false,
    marketing_consent: false,
    created_at: '2026-11-15T18:05:00Z',
    entitlements: [],
  },
];

export const SAMPLE_PRODUCTS: Product[] = [
  {
    code: 'launcher_core',
    name: 'NZT Launcher',
    version: '1.2.0',
    filename: 'NZT-Launcher.exe',
    object_key: 'binaries/launcher/1.2.0/NZT-Launcher.exe',
    sha256: 'a'.repeat(64),
    is_active: true,
    created_at: '2026-08-20T10:00:00Z',
  },
  {
    code: 'toolkit_pro',
    name: 'NZT Toolkit Pro',
    version: '0.9.1',
    filename: 'NZT-Toolkit.exe',
    object_key: 'binaries/toolkit/0.9.1/NZT-Toolkit.exe',
    sha256: 'b'.repeat(64),
    is_active: false,
    created_at: '2026-10-03T08:30:00Z',
  },
];

export const SAMPLE_CAMPAIGNS: Campaign[] = [
  {
    id: 1,
    kind: 'communication',
    subject: 'Nuova versione del Launcher disponibile',
    body: 'Esempio di testo.',
    product_code: 'launcher_core',
    status: 'sent',
    recipients: 90,
    sent: 88,
    failed: 2,
    created_at: '2026-11-02T09:00:00Z',
    sent_at: '2026-11-02T09:10:00Z',
  },
  {
    id: 2,
    kind: 'communication',
    subject: 'Manutenzione programmata',
    body: 'Esempio di testo.',
    product_code: null,
    status: 'draft',
    recipients: 0,
    sent: 0,
    failed: 0,
    created_at: '2026-11-17T16:20:00Z',
    sent_at: null,
  },
];

export const SAMPLE_AUDIT: AuditEntry[] = [
  {
    at: '2026-11-17T16:21:00Z',
    admin_email: 'admin@example.com',
    action: 'campaign.create',
    target: 'campaign:2',
  },
  {
    at: '2026-11-16T11:02:00Z',
    admin_email: 'admin@example.com',
    action: 'customer.entitlement',
    target: 'customer:2 toolkit_pro',
  },
  {
    at: '2026-11-15T19:47:00Z',
    admin_email: 'admin@example.com',
    action: 'customer.status',
    target: 'customer:3 is_active=false',
  },
];
