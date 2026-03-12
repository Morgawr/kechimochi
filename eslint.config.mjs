import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    rules: {
      "sonarjs/cognitive-complexity": ["error", 15],
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
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
    ignores: ["dist/**", "node_modules/**", "src-tauri/**"]
  }
);
