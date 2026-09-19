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
    //
    // Vitest 4 removed `poolOptions`/`singleFork` entirely (see
    // https://vitest.dev/guide/migration#pool-rework) — `maxWorkers: 1`
    // is the direct replacement for "pin this to a single worker".
    // Deliberately NOT setting `isolate: false`: some migration notes
    // conflate that with the old singleFork setting, but isolate governs
    // whether each test file gets a fresh module registry, which is an
    // unrelated concern from "don't run two SQLite writers at once" —
    // changing it could let state leak between test files with no
    // upside for the actual problem being solved here.
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
