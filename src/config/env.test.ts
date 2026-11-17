import { describe, expect, it } from "vitest";
import { parseConfig } from "./env.js";

const valid = {
  DATABASE_URL: "postgres://ops:ops@localhost:5433/ops",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

describe("parseConfig", () => {
  it("accepts a valid env and applies defaults", () => {
    expect(parseConfig(valid)).toEqual({ ...valid, PORT: 3000, ANTHROPIC_MODEL: "claude-haiku-5-5" });
  });

  it("coerces PORT from string to number", () => {
    expect(parseConfig({ ...valid, PORT: "8080" }).PORT).toBe(8080);
  });

  it("allows overriding the model", () => {
    expect(parseConfig({ ...valid, ANTHROPIC_MODEL: "claude-sonnet-5-5" }).ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseConfig({ ANTHROPIC_API_KEY: valid.ANTHROPIC_API_KEY })).toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    expect(() => parseConfig({ ...valid, DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("throws when PORT is not a number", () => {
    expect(() => parseConfig({ ...valid, PORT: "abc" })).toThrow(/PORT/);
  });

  it("throws when ANTHROPIC_API_KEY is missing or malformed", () => {
    expect(() => parseConfig({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parseConfig({ ...valid, ANTHROPIC_API_KEY: "oops" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("drops unrelated env vars", () => {
    expect(parseConfig({ ...valid, HOME: "/Users/x" })).not.toHaveProperty("HOME");
  });
});
