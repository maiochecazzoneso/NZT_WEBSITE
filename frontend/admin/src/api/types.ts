// Tipi del contratto API amministratore (docs/admin_api_contract.md). Base: /api/v1/admin.

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AdminMe {
  email: string;
}

export interface ProductDownloads {
  product_code: string;
  count: number;
}

export interface DayDownloads {
  /** YYYY-MM-DD */
  day: string;
  count: number;
}

export interface Stats {
  users_total: number;
  users_verified: number;
  users_new_7d: number;
  users_new_30d: number;
  marketing_consents: number;
  downloads_total: number;
  downloads_7d: number;
  downloads_by_product: ProductDownloads[];
  downloads_per_day: DayDownloads[];
  campaigns_sent: number;
}

export interface Entitlement {
  product_code: string;
  is_enabled: boolean;
  valid_until: string | null;
}

/** Il contratto non specifica il tipo dell'id (uuid o intero): trattato come opaco. */
export type CustomerId = string | number;

export interface Customer {
  id: CustomerId;
  email: string;
  role: string;
  is_verified: boolean;
  is_active: boolean;
  marketing_consent: boolean;
  created_at: string;
  entitlements: Entitlement[];
}

export interface CustomerList {
  total: number;
  items: Customer[];
}

export interface CustomerQuery {
  q: string;
  limit: number;
  offset: number;
}

export interface EntitlementInput {
  product_code: string;
  is_enabled: boolean;
  valid_until: string | null;
}

export interface Product {
  code: string;
  name: string;
  version: string;
  filename: string;
  object_key: string;
  sha256: string;
  is_active: boolean;
  created_at: string;
}

export type ProductInput = Omit<Product, 'created_at'>;

export type CampaignKind = 'communication' | 'marketing';
export type CampaignStatus = 'draft' | 'sending' | 'sent';

export interface Campaign {
  id: number | string;
  kind: CampaignKind;
  subject: string;
  body: string;
  product_code: string | null;
  status: CampaignStatus;
  recipients: number;
  sent: number;
  failed: number;
  created_at: string;
  sent_at: string | null;
}

export interface CampaignInput {
  kind: CampaignKind;
  subject: string;
  body: string;
  product_code?: string;
}

export interface AuditEntry {
  at: string;
  admin_email: string;
  action: string;
  target: string;
}
