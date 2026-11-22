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
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          exclude: [
            'tests/unit/heading-contract.test.ts',
            'node_modules',
            'dist',
            '.astro',
            '.tmp',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'contract-static',
          include: ['tests/contract/**/*.test.ts'],
          exclude: [
            'tests/contract/agent-tools-endpoints.test.ts',
            'tests/contract/cli-runner.test.ts',
            'tests/contract/external-script-simulation.test.ts',
            'tests/contract/harness-chat-endpoint.test.ts',
            'tests/contract/ingest-endpoints.test.ts',
            'tests/contract/internal-content-api.test.ts',
            'tests/contract/pdf2abp-endpoints.test.ts',
            'tests/contract/epub-heading-parity.test.ts',
            'tests/contract/image-assets.test.ts',
            'tests/contract/mermaid-integrity.test.ts',
            'tests/contract/reader-routability.test.ts',
            'tests/contract/reader-full-routability.test.ts',
            'node_modules',
            'dist',
            '.astro',
            '.tmp',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [
            'tests/contract/agent-tools-endpoints.test.ts',
            'tests/contract/cli-runner.test.ts',
            'tests/contract/external-script-simulation.test.ts',
            'tests/contract/harness-chat-endpoint.test.ts',
            'tests/contract/ingest-endpoints.test.ts',
            'tests/contract/internal-content-api.test.ts',
            'tests/contract/pdf2abp-endpoints.test.ts',
          ],
          testTimeout: 60000,
        },
      },
      {
        extends: true,
        test: {
          name: 'corpus',
          include: [
            'tests/unit/heading-contract.test.ts',
            'tests/contract/epub-heading-parity.test.ts',
            'tests/contract/image-assets.test.ts',
            'tests/contract/mermaid-integrity.test.ts',
            'tests/contract/reader-routability.test.ts',
            'tests/contract/reader-full-routability.test.ts',
          ],
          testTimeout: 120000,
        },
      },
      {
        extends: true,
        test: {
          name: 'artifacts',
          include: ['tests/acceptance/**/*.test.ts'],
          testTimeout: 120000,
        },
      },
      {
        extends: true,
        test: {
          name: 'system',
          include: ['tests/system/**/*.test.ts'],
          testTimeout: 120000,
        },
      },
    ],
  },
});
