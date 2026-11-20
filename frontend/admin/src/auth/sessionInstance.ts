// Istanza unica della sessione amministratore (dipendenze reali del browser) e client API.

import { createAdminApi } from '../api/admin';
import { apiFetch } from '../api/http';
import { withLock } from '../lib/locks';
import { createKeyManager } from './keyManager';
import { indexedDbKeyStore } from './keyStore';
import { createBroadcastChannel, SessionManager } from './session';
import { createTokenStore } from './tokenStore';

export const session = new SessionManager({
  fetcher: apiFetch,
  keys: createKeyManager(indexedDbKeyStore, withLock),
  tokens: createTokenStore(),
  lock: withLock,
  channel: createBroadcastChannel(),
});

export const adminApi = createAdminApi((request) => session.authorizedFetch(request));
