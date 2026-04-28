import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'letta-teams-sdk',
        replacement: fileURLToPath(new URL('./packages/letta-teams-sdk/src/index.ts', import.meta.url)),
      },
      {
        find: /^letta-teams-sdk\/(.*)$/,
        replacement: fileURLToPath(new URL('./packages/letta-teams-sdk/src/$1.ts', import.meta.url)),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
    setupFiles: ['./packages/letta-teams-sdk/src/__mocks__/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/**/src/**/*.ts'],
      exclude: [
        'packages/**/src/**/*.test.ts',
        'packages/**/src/**/*.d.ts',
        'packages/**/src/**/__mocks__/**',
      ],
    },
  },
});
