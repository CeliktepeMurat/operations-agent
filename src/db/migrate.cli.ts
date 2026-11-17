import { loadConfig } from "../config/env.js";
import { runMigrations } from "./migrate.js";
import { createPool } from "./pool.js";

const pool = createPool(loadConfig());

try {
  const ran = await runMigrations(pool);
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "No pending migrations.");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
