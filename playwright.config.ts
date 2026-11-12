import { defineConfig } from "@playwright/test";

const PORT = 5199; // the tests' own dev server. Port 5173 belongs to the tab the user watches.
const TEST_TIMEOUT_MS = 90_000;
const SERVER_START_MS = 60_000;

export default defineConfig({
  testDir: "e2e",
  timeout: TEST_TIMEOUT_MS,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome", // the installed Chrome, no browser download
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: SERVER_START_MS,
  },
});
