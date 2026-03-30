import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@sangati/shared': resolve('./packages/shared/src/index.ts'),
      '@sangati/db':     resolve('./packages/db/src/index.ts'),
      '@sangati/core':   resolve('./packages/core/src/index.ts'),
      '@sangati/api':    path.resolve('apps/api/src'),
    },
  },
});
