import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/src-tauri/**'],
    coverage: {
      include: ['src/**'],
      exclude: ['src-tauri/**', '**/node_modules/**', '**/dist/**', '**/e2e/**', 'src/**/*.d.ts', 'src/**/types.ts'],
      reporter: ['text', 'json', 'html', 'json-summary'],
    },
  },
});
