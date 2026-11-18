import { describe, expect, it, vi } from 'vitest';
import { createAdminApi, customersPath, type AuthorizedFetcher } from '../src/api/admin';
import { ApiError } from '../src/api/http';

function setup(data: unknown = null, status = 200) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetcher: AuthorizedFetcher = async <T>(request: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
  }) => {
    calls.push(request);
    return { status, data: data as T | null };
  };
  return { api: createAdminApi(fetcher), calls };
}

describe('admin API client paths and payloads', () => {
  it('builds the customers query (trimmed q, limit, offset)', () => {
    expect(customersPath({ q: '  mario ', limit: 50, offset: 100 })).toBe(
      '/api/v1/admin/customers?q=mario&limit=50&offset=100',
    );
    expect(customersPath({ q: '', limit: 50, offset: 0 })).toBe(
      '/api/v1/admin/customers?limit=50&offset=0',
    );
    expect(customersPath({ q: 'a&b=c', limit: 1, offset: 0 })).toContain('q=a%26b%3Dc');
  });

  it('GET endpoints', async () => {
    const { api, calls } = setup({ ok: true });
    await api.stats();
    await api.products();
    await api.campaigns();
    await api.audit();
    await api.me();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/v1/admin/stats',
      'GET /api/v1/admin/products',
      'GET /api/v1/admin/campaigns',
      'GET /api/v1/admin/audit',
      'GET /api/v1/admin/me',
    ]);
  });

  it('POST endpoints use the contract bodies and encode ids', async () => {
    const { api, calls } = setup(null, 204);
    await api.setEntitlement('a/b', { product_code: 'p', is_enabled: true, valid_until: null });
    await api.setCustomerActive(7, false);
    await api.testCampaign(3);
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/v1/admin/customers/a%2Fb/entitlement',
        body: { product_code: 'p', is_enabled: true, valid_until: null },
      },
      { method: 'POST', path: '/api/v1/admin/customers/7/status', body: { is_active: false } },
      { method: 'POST', path: '/api/v1/admin/campaigns/3/test' },
    ]);
  });

  it('create/send campaign and save product return the parsed body', async () => {
    const campaign = { id: 1, status: 'draft' };
    const { api, calls } = setup(campaign, 201);
    expect(await api.createCampaign({ kind: 'communication', subject: 's', body: 'b' })).toBe(
      campaign,
    );
    expect(await api.sendCampaign(1)).toBe(campaign);
    expect(calls[1]).toEqual({ method: 'POST', path: '/api/v1/admin/campaigns/1/send' });
  });

  it('a 2xx without body on a data endpoint is an error', async () => {
    const { api } = setup(null);
    await expect(api.stats()).rejects.toThrow('Empty response');
  });

  it('HTTP errors (401/403/429/409) propagate untouched as ApiError', async () => {
    const errors = [
      new ApiError('http', 401, 'Invalid access token'),
      new ApiError('http', 403, 'Admin role required'),
      new ApiError('http', 429, 'Too many requests', 12),
      new ApiError('http', 409, 'Campaign is not a draft'),
    ];
    for (const error of errors) {
      const fetcher = vi.fn().mockRejectedValue(error);
      const api = createAdminApi(fetcher as unknown as AuthorizedFetcher);
      await expect(api.sendCampaign(1)).rejects.toBe(error);
    }
  });
});
