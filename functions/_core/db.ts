/**
 * Minimal wrapper around SpaceFast's env.DB (D1-shaped API).
 *
 * CEO Owl preview: registered users in `users`, roles in `user_roles`,
 * anonymous usage counters in `usage_events` (never submitted text),
 * fixed-hour-window rate limiting in `rate_limits`.
 *
 * Timestamps are ISO-8601 UTC strings; booleans are 0/1 integers.
 */

export interface DbStatement {
  bind(...params: unknown[]): DbResult;
}

export interface DbResult {
  all(): Promise<{ results: Record<string, unknown>[] }>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<unknown>;
}

export interface SpacefastDb {
  prepare(sql: string): DbStatement;
}

function toDbValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export function q(db: SpacefastDb, sql: string, ...params: unknown[]): DbResult {
  return db.prepare(sql).bind(...params.map(toDbValue));
}

export async function all(
  db: SpacefastDb,
  sql: string,
  ...params: unknown[]
): Promise<Record<string, unknown>[]> {
  const res = await q(db, sql, ...params).all();
  return res.results ?? [];
}

export async function first(
  db: SpacefastDb,
  sql: string,
  ...params: unknown[]
): Promise<Record<string, unknown> | null> {
  return (await q(db, sql, ...params).first()) ?? null;
}

export async function run(db: SpacefastDb, sql: string, ...params: unknown[]): Promise<void> {
  await q(db, sql, ...params).run();
}

/** Random id for primary keys (hex, 128-bit). */
export function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let schemaEnsured = false;

/** Runs a DDL statement, ignoring "already exists" races on cold start. */
async function ensureOnce(db: SpacefastDb, sql: string): Promise<void> {
  try {
    await run(db, sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|duplicate/i.test(message)) return;
    throw error;
  }
}

/** Creates the preview tables if they do not exist. Idempotent. */
export async function ensureSchema(db: SpacefastDb): Promise<void> {
  if (schemaEnsured) return;
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(320) UNIQUE NOT NULL,
      username VARCHAR(24) UNIQUE NOT NULL,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS user_roles (
      user_id VARCHAR(64) NOT NULL,
      role VARCHAR(32) NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE KEY uniq_user_role (user_id, role)
    )`,
  );
  await ensureOnce(db, `CREATE INDEX user_roles_user_idx ON user_roles (user_id)`);
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS usage_events (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      operation VARCHAR(32) NOT NULL,
      character_count INTEGER NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 0,
      error_code VARCHAR(64),
      latency_ms INTEGER NOT NULL DEFAULT 0
    )`,
  );
  await ensureOnce(
    db,
    `CREATE INDEX usage_events_user_created_idx ON usage_events (user_id, created_at DESC)`,
  );
  await ensureOnce(db, `CREATE INDEX usage_events_created_idx ON usage_events (created_at DESC)`);
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS rate_limits (
      user_id VARCHAR(64) NOT NULL,
      window_start VARCHAR(32) NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, window_start)
    )`,
  );
  schemaEnsured = true;
}
