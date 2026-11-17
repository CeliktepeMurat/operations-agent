import { loadConfig } from "../config/env.js";
import { createPool } from "../db/pool.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config);
const app = buildApp({ pool, logger: true });

// Let in-flight requests finish before closing DB connections.
async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  // 0.0.0.0 so the server is reachable inside containers / on hosting platforms.
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  await pool.end();
  process.exit(1);
}
