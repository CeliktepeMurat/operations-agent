import type pg from "pg";
import { loadConfig } from "../config/env.js";
import { createPool } from "../db/pool.js";

export type TestDb = {
  pool: pg.Pool;
  schema: string;
  cleanup: () => Promise<void>;
};

/** Creates an isolated, throwaway Postgres schema. Requires the Docker database. */
export async function createTestDb(): Promise<TestDb> {
  const config = loadConfig();
  const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  const admin = createPool(config);
  await admin.query(`CREATE SCHEMA ${schema}`);

  // search_path makes unqualified table names resolve inside the test schema.
  const pool = createPool(config, { options: `-c search_path=${schema}` });

  return {
    pool,
    schema,
    cleanup: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
