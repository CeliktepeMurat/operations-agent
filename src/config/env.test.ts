import { describe, expect, it } from "vitest";
import { parseConfig } from "./env.js";

const validUrl = "postgres://ops:ops@localhost:5433/ops";

describe("parseConfig", () => {
  it("accepts a valid env and applies the PORT default", () => {
    expect(parseConfig({ DATABASE_URL: validUrl })).toEqual({ DATABASE_URL: validUrl, PORT: 3000 });
  });

  it("coerces PORT from string to number", () => {
    expect(parseConfig({ DATABASE_URL: validUrl, PORT: "8080" }).PORT).toBe(8080);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseConfig({})).toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    expect(() => parseConfig({ DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("throws when PORT is not a number", () => {
    expect(() => parseConfig({ DATABASE_URL: validUrl, PORT: "abc" })).toThrow(/PORT/);
  });

  it("drops unrelated env vars", () => {
    expect(parseConfig({ DATABASE_URL: validUrl, HOME: "/Users/x" })).not.toHaveProperty("HOME");
  });
});
