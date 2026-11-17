import pg from "pg";
import type { Config } from "../config/env.js";

// Parse bigint (IDs, cents) as number instead of string; fail loudly if it can't be exact.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`bigint ${value} exceeds safe integer range`);
  return n;
});

export function createPool(config: Config, extra: pg.PoolConfig = {}): pg.Pool {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, ...extra });

  // Without a listener, an idle connection dropping would crash the process.
  pool.on("error", (err) => {
    console.error("Idle Postgres client error:", err.message);
  });

  return pool;
}
