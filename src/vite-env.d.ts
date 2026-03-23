/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_APP_VERSION?: string;
    readonly VITE_APP_CHANNEL?: string;
    readonly VITE_RELEASE_STAGE?: string;
    readonly VITE_GIT_HASH?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
