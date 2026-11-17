import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { runMigrations } from "./migrate.js";

let db: TestDb;
let dir: string;

beforeEach(async () => {
  db = await createTestDb();
  dir = await mkdtemp(path.join(tmpdir(), "migrations-"));
});

afterEach(async () => {
  await db.cleanup();
  await rm(dir, { recursive: true, force: true });
});

const write = (name: string, sql: string) => writeFile(path.join(dir, name), sql);

const tableExists = async (table: string) => {
  const { rows } = await db.pool.query("SELECT to_regclass($1) AS t", [`${db.schema}.${table}`]);
  return rows[0]?.t !== null;
};

describe("runMigrations", () => {
  it("applies pending migrations in filename order and records them", async () => {
    await write("002_b.sql", "CREATE TABLE b (id int REFERENCES a(id));");
    await write("001_a.sql", "CREATE TABLE a (id int PRIMARY KEY);");
    await write("notes.txt", "not a migration");

    expect(await runMigrations(db.pool, dir)).toEqual(["001_a.sql", "002_b.sql"]);

    const { rows } = await db.pool.query("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows.map((r) => r.name)).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("does not re-run already applied migrations", async () => {
    await write("001_a.sql", "CREATE TABLE a (id int);");
    await runMigrations(db.pool, dir);
    await write("002_b.sql", "CREATE TABLE b (id int);");

    expect(await runMigrations(db.pool, dir)).toEqual(["002_b.sql"]);
  });

  it("rolls back a failing migration completely and stops", async () => {
    await write("001_a.sql", "CREATE TABLE a (id int);");
    await write("002_bad.sql", "CREATE TABLE half (id int); SELECT * FROM does_not_exist;");
    await write("003_c.sql", "CREATE TABLE c (id int);");

    await expect(runMigrations(db.pool, dir)).rejects.toThrow(/002_bad\.sql/);

    expect(await tableExists("a")).toBe(true);
    expect(await tableExists("half")).toBe(false);
    expect(await tableExists("c")).toBe(false);
    const { rows } = await db.pool.query("SELECT name FROM schema_migrations");
    expect(rows.map((r) => r.name)).toEqual(["001_a.sql"]);
  });
});
