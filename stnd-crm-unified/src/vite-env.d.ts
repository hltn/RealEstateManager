/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  /** Base URL backend (mặc định http://localhost:3000/api/v1). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
