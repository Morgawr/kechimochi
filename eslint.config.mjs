import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { configs as sonarjsConfigs } from "eslint-plugin-sonarjs";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjsConfigs.recommended,
  {
    rules: {
      "sonarjs/cognitive-complexity": ["error", 15],
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-console": "warn",
    },
  },
  {
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "sonarjs/no-duplicate-string": "off",
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/e2e/**"],
          message: "e2e-only modules cannot be imported from src/ or tests/. Keep e2e constants in e2e/.",
        }],
      }],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "src-tauri/**"]
  }
);
