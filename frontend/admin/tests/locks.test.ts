import { describe, expect, it, vi } from 'vitest';
import { withLock } from '../src/lib/locks';

describe('withLock', () => {
  it('uses navigator.locks.request(name, {mode: exclusive}) when available', async () => {
    const request = vi.fn(
      (_name: string, _options: LockOptions, callback: () => Promise<unknown>) => callback(),
    );
    vi.stubGlobal('navigator', { locks: { request } });
    await expect(withLock('nzt_admin_token_refresh', async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith(
      'nzt_admin_token_refresh',
      { mode: 'exclusive' },
      expect.any(Function),
    );
  });

  it('falls back to an in-tab FIFO mutex without the Web Locks API', async () => {
    vi.stubGlobal('navigator', {});
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const task = (id: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start ${id}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${id}`);
      active -= 1;
      if (id === 'b') throw new Error('boom');
      return id;
    };
    const results = await Promise.allSettled([
      withLock('x', task('a')),
      withLock('x', task('b')),
      withLock('x', task('c')),
    ]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
