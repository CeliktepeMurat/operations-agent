import { loadConfig } from "../../src/config/env.js";
import { createPool } from "../../src/db/pool.js";
import { generateSeedData } from "./generate.js";
import { insertSeedData } from "./insert.js";

const SEED = 42;

const config = loadConfig();

// Seeding truncates every table; never do that to a remote DB by accident.
const host = new URL(config.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1"].includes(host) && !process.argv.includes("--force")) {
  console.error(`Refusing to seed non-local database at "${host}". Re-run with --force if you're sure.`);
  process.exit(1);
}

const pool = createPool(config);

try {
  const data = generateSeedData({ seed: SEED, now: new Date() });
  await insertSeedData(pool, data);

  const { rows } = await pool.query<{ status: string; count: number }>(
    "SELECT status, count(*)::int AS count FROM orders GROUP BY status ORDER BY status",
  );
  console.log(`Seeded ${data.customers.length} customers, ${data.products.length} products, ${data.orders.length} orders.`);
  console.log("Orders by status:", Object.fromEntries(rows.map((r) => [r.status, r.count])));
} catch (err) {
  console.error("Seed failed:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
