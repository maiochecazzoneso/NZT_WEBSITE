// Client tipizzato dell'API amministratore. Tutte le chiamate passano da un fetcher "autorizzato"
// (SessionManager.authorizedFetch: DPoP + access token + 1 retry dopo refresh su 401), iniettato
// per poterlo sostituire nei test.

import { ApiError, type ApiResponse } from './http';
import type {
  AdminMe,
  AuditEntry,
  Campaign,
  CampaignInput,
  Customer,
  CustomerId,
  CustomerList,
  CustomerQuery,
  EntitlementInput,
  Product,
  ProductInput,
  Stats,
} from './types';

export const ADMIN_BASE = '/api/v1/admin';

export type AuthorizedFetcher = <T>(request: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}) => Promise<ApiResponse<T>>;

export function customersPath(query: CustomerQuery): string {
  const params = new URLSearchParams();
  const q = query.q.trim();
  if (q) params.set('q', q);
  params.set('limit', String(query.limit));
  params.set('offset', String(query.offset));
  return `${ADMIN_BASE}/customers?${params.toString()}`;
}

export function createAdminApi(fetcher: AuthorizedFetcher) {
  async function get<T>(path: string): Promise<T> {
    const { data } = await fetcher<T>({ method: 'GET', path });
    if (data === null) throw new ApiError('invalid-response', 200);
    return data;
  }
  async function post<T>(path: string, body?: unknown): Promise<T | null> {
    const { data } = await fetcher<T>({
      method: 'POST',
      path,
      ...(body !== undefined ? { body } : {}),
    });
    return data;
  }
  const id = (value: CustomerId | number | string) => encodeURIComponent(String(value));

  return {
    me: () => get<AdminMe>(`${ADMIN_BASE}/me`),
    stats: () => get<Stats>(`${ADMIN_BASE}/stats`),
    customers: (query: CustomerQuery) => get<CustomerList>(customersPath(query)),
    setEntitlement: async (customerId: CustomerId, input: EntitlementInput): Promise<void> => {
      await post(`${ADMIN_BASE}/customers/${id(customerId)}/entitlement`, input);
    },
    setCustomerActive: async (customerId: CustomerId, isActive: boolean): Promise<void> => {
      await post(`${ADMIN_BASE}/customers/${id(customerId)}/status`, { is_active: isActive });
    },
    products: () => get<Product[]>(`${ADMIN_BASE}/products`),
    saveProduct: async (input: ProductInput): Promise<Product> => {
      const data = await post<Product>(`${ADMIN_BASE}/products`, input);
      if (data === null) throw new ApiError('invalid-response', 200);
      return data;
    },
    campaigns: () => get<Campaign[]>(`${ADMIN_BASE}/campaigns`),
    createCampaign: async (input: CampaignInput): Promise<Campaign> => {
      const data = await post<Campaign>(`${ADMIN_BASE}/campaigns`, input);
      if (data === null) throw new ApiError('invalid-response', 200);
      return data;
    },
    testCampaign: async (campaignId: Campaign['id']): Promise<void> => {
      await post(`${ADMIN_BASE}/campaigns/${id(campaignId)}/test`);
    },
    sendCampaign: async (campaignId: Campaign['id']): Promise<Campaign> => {
      const data = await post<Campaign>(`${ADMIN_BASE}/campaigns/${id(campaignId)}/send`);
      if (data === null) throw new ApiError('invalid-response', 200);
      return data;
    },
    audit: () => get<AuditEntry[]>(`${ADMIN_BASE}/audit`),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
export type { Customer };
