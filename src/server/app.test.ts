import { afterEach, describe, expect, it } from "vitest";
import { createPool } from "../db/pool.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { buildApp } from "./app.js";

// Nothing listens on port 1, so connections fail fast.
const unreachablePool = () => createPool({ DATABASE_URL: "postgres://x:y@localhost:1/none", PORT: 0 });

describe("GET /health", () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  it("returns 200 when the database is reachable", async () => {
    db = await createTestDb();
    const app = buildApp({ pool: db.pool });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
    await app.close();
  });

  it("returns 503 when the database is unreachable", async () => {
    const pool = unreachablePool();
    const app = buildApp({ pool });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", db: "unreachable" });
    await app.close();
    await pool.end();
  });

  it("returns 404 for unknown routes", async () => {
    const pool = unreachablePool();
    const app = buildApp({ pool });

    const res = await app.inject({ method: "GET", url: "/nope" });

    expect(res.statusCode).toBe(404);
    await app.close();
    await pool.end();
  });
});
