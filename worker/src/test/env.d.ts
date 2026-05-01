/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Type augmentation for the test environment.
//
// vitest-pool-workers exposes the test worker's bindings via `Cloudflare.Env`
// (the global namespace pattern introduced in pool 0.15+). We augment that
// namespace with our own Env shape plus the TEST_MIGRATIONS array we inject
// from vitest.config.ts so `env.DB`, `env.TEST_MIGRATIONS`, etc. type-check
// in test files.

import type { Env as WorkerEnv } from '../env';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
