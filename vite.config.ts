import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractChangelogSection } from "./scripts/changelog-utils.mjs";

const host = process.env.TAURI_DEV_HOST;
const webHost = process.env.WEB_HOST;
const apiTarget = process.env.VITE_API_BASE_URL || "http://127.0.0.1:3000";

function getPackageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return typeof packageJson.version === "string" && packageJson.version.trim().length > 0
      ? packageJson.version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

let gitHash: string;
try {
  gitHash = execFileSync(process.platform === "win32" ? "git" : "/usr/bin/git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  gitHash = process.env.VITE_GIT_HASH ?? "unknown";
}

const packageVersion = getPackageVersion();
const appBuildChannel = process.env.VITE_APP_CHANNEL === "release" ? "release" : "dev";
const releaseStage = process.env.VITE_RELEASE_STAGE === "stable" ? "stable" : "beta";
const defaultAppVersion = appBuildChannel === "release"
  ? packageVersion
  : `${packageVersion}-dev.${gitHash}`;
const appVersion = process.env.VITE_APP_VERSION?.trim() || defaultAppVersion;
const releaseNotesVersion = appBuildChannel === "release" ? appVersion : packageVersion;

function getBundledReleaseNotes(version: string): string {
  try {
    return extractChangelogSection(version);
  } catch {
    return "";
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_CHANNEL__: JSON.stringify(appBuildChannel),
    __APP_RELEASE_STAGE__: JSON.stringify(releaseStage),
    __APP_GIT_HASH__: JSON.stringify(gitHash),
    __APP_RELEASE_NOTES__: JSON.stringify(getBundledReleaseNotes(releaseNotesVersion)),
    __APP_RELEASES_URL__: JSON.stringify("https://github.com/Morgawr/kechimochi/releases"),
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
