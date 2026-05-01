import { applyD1Migrations, env } from 'cloudflare:test';

/**
 * Per-test-file setup. Runs once before any tests in a given file load.
 *
 * `applyD1Migrations` is idempotent (it tracks applied migrations in
 * `d1_migrations`). With vitest-pool-workers' default isolatedStorage, each
 * test file gets a fresh DB, so this effectively applies all migrations to
 * a clean database at the start of each file.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
