/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  /** Base URL backend (mặc định http://localhost:3000/api/v1). */
  readonly VITE_API_URL?: string;
  /** Bật module CRM prototype ('true'/'false'); mặc định: bật ở dev, tắt ở production. */
  readonly VITE_CRM_PROTOTYPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
