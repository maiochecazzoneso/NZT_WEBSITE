// Validazione degli URL ricevuti dall'API prima di navigarci (difesa in profondità da open redirect
// e da schemi pericolosi come javascript:).

import { isLoopbackHttp } from '../config';

function parseHttpUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid URL');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !isLoopbackHttp(url)) throw new Error('URL must use https');
  if (url.username || url.password) throw new Error('URL must not contain credentials');
  return url;
}

export function validateAuthorizationUrl(raw: unknown, allowedOrigins: readonly string[]): string {
  const url = parseHttpUrl(raw);
  if (!allowedOrigins.includes(url.origin)) throw new Error('Unexpected authorization origin');
  return url.href;
}

export function validateDownloadUrl(raw: unknown): string {
  return parseHttpUrl(raw).href;
}
