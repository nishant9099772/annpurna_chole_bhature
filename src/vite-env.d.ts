/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_NETLIFY_URL?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_NETLIFY_BUILD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
