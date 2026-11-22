import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      electron: path.resolve(__dirname, './tests/mocks/electron.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    include: ['tests/benchmarks/**/*.test.ts'],
  },
});
