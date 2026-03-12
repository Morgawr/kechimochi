import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/src-tauri/**'],
    coverage: {
      include: ['src/**'],
      exclude: ['src-tauri/**', '**/node_modules/**', '**/dist/**', '**/e2e/**'],
      reporter: ['text', 'json', 'html', 'json-summary'],
    },
  },
});
