import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Run tests sequentially — each test file uses its own SQLite DB
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
