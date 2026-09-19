import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globalSetup: './tests/global-setup.ts',
    // These tests hit a single real SQLite file (see tests/global-setup.ts)
    // through the app's own Prisma singleton, the same one the routes
    // themselves import. SQLite doesn't handle concurrent writers from
    // separate processes gracefully, so every test file runs in one
    // worker, one at a time, rather than vitest's default of parallel
    // workers/processes — slower, but avoids flaky "database is locked"
    // failures that would have nothing to do with the code being tested.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
