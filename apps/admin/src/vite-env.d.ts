/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin pubblico dell'API (= NZT_API_PUBLIC_BASE_URL del backend), es. https://api.nztsolutions.it */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
