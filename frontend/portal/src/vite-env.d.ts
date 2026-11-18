/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin pubblico dell'API (= NZT_API_PUBLIC_BASE_URL del backend), es. https://api.nztsolutions.it */
  readonly VITE_API_BASE_URL?: string;
  /** Origin(i) ammessi per l'URL di autorizzazione Google (separati da virgola). */
  readonly VITE_OAUTH_AUTHORIZE_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
