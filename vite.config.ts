import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";

const host = process.env.TAURI_DEV_HOST;
const webHost = process.env.WEB_HOST;
const apiTarget = process.env.VITE_API_BASE_URL || "http://127.0.0.1:3000";

let gitHash: string;
try {
  gitHash = execFileSync(process.platform === "win32" ? "git" : "/usr/bin/git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
    gitHash = process.env.VITE_GIT_HASH ?? "unknown";
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __APP_GIT_HASH__: JSON.stringify(gitHash),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: webHost || host || false,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
