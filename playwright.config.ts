import { defineConfig } from "@playwright/test";

// The one dev server everyone shares. The executor session starts it. See CLAUDE.md.
const BASE_URL = "http://localhost:5173";
const TEST_TIMEOUT_MS = 90_000;
// One browser at a time. Software rendering is slow, and hold-to-repeat tests count actions per second.
const WORKERS = 1;

export default defineConfig({
  testDir: "e2e",
  timeout: TEST_TIMEOUT_MS,
  workers: WORKERS,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    channel: "chrome", // the installed Chrome, no browser download
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
});
