import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['infrastructure/importer-health/importers.health.ts'],
        setupFiles: ['infrastructure/importer-health/setup.ts'],
        testTimeout: 180_000,
        hookTimeout: 30_000,
        fileParallelism: false,
    },
});
