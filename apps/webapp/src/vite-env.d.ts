/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin (without the /api/v1 prefix). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-time API base injected by vite.config.ts `define`. */
declare const __API_BASE__: string;
