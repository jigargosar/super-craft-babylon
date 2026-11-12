import { defineConfig } from "vitest/config";

// Unit tests only. Browser tests live in e2e/ and run with Playwright.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
