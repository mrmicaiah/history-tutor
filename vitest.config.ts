import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.join(__dirname, 'worker', 'migrations');

/**
 * Vitest config for the Cloudflare workers pool (v0.15+).
 *
 * `cloudflareTest` is a Vite plugin that wires up Vitest's worker pool to
 * run tests inside Miniflare with real bindings. The migrations are read
 * from `worker/migrations/` at config time and exposed as the
 * `TEST_MIGRATIONS` binding -- the per-file setup applies them via
 * `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`.
 *
 * Bindings declared in `wrangler.toml` (just `DB`) come through the
 * `wrangler` option. Secrets aren't in wrangler.toml -- we provide stub
 * values via `miniflare.bindings` so the Env type is satisfied at runtime.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(migrationsPath);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ANTHROPIC_API_KEY: 'test-anthropic-key',
            ELEVENLABS_API_KEY: 'test-elevenlabs-key',
            ELEVENLABS_VOICE_ID: 'test-voice-id',
            PIN_HASH: '0'.repeat(64),
            SESSION_SECRET: '0'.repeat(64),
          },
          r2Buckets: ['AUDIO_CACHE'],
        },
      }),
    ],
    test: {
      include: ['worker/src/**/*.test.ts', 'pages/src/**/*.test.ts'],
      setupFiles: ['./worker/src/test/setup.ts'],
    },
  };
});
