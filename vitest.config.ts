import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: rely on real environment variables (e.g. CI).
}

export default defineConfig({});
