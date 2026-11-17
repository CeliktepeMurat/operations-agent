import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../db/migrations");

/** Applies pending .sql migrations in filename order, each in its own transaction. */
export async function runMigrations(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const pending = files.filter((f) => !applied.has(f));

  for (const file of pending) {
    const sql = await readFile(path.join(dir, file), "utf8");

    // A transaction must stay on one connection, so check one out explicitly.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return pending;
}
