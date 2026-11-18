import { describe, expect, it, vi } from 'vitest';
import { createOAuthCallbackConsumer, parseOAuthCallback } from '../src/lib/oauthCallback';

describe('Google callback URL handling', () => {
  it('reads code/state once and strips them from the URL with history.replaceState', () => {
    const consume = createOAuthCallbackConsumer();
    const history = { replaceState: vi.fn() };
    const location = {
      pathname: '/auth/google/callback',
      search: '?state=abc&code=4%2F0Ab&scope=openid',
      hash: '',
    };
    expect(consume(location, history)).toEqual({ type: 'code', code: '4/0Ab', state: 'abc' });
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/auth/google/callback');
    // Seconda invocazione (es. doppio effetto StrictMode): stesso risultato, URL non riletto
    expect(consume({ ...location, search: '' }, history)).toEqual({
      type: 'code',
      code: '4/0Ab',
      state: 'abc',
    });
    expect(history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('handles IdP errors and missing parameters', () => {
    expect(parseOAuthCallback('?error=access_denied&state=x')).toEqual({
      type: 'error',
      error: 'access_denied',
    });
    expect(parseOAuthCallback('')).toEqual({ type: 'missing' });
    expect(parseOAuthCallback('?code=abc')).toEqual({ type: 'missing' });
    expect(parseOAuthCallback(`?code=${'a'.repeat(2049)}&state=s`)).toEqual({ type: 'missing' });
  });

  it('does not touch history when there is nothing to strip', () => {
    const consume = createOAuthCallbackConsumer();
    const history = { replaceState: vi.fn() };
    consume({ pathname: '/auth/google/callback', search: '', hash: '' }, history);
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
