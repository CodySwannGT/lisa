import { defineConfig } from "@playwright/test";

const UI_TEST_PORT = 4783;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${UI_TEST_PORT}`,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: {
    command: `bun tests/e2e/fixtures/ui-live-status-server.ts ${UI_TEST_PORT}`,
    url: `http://127.0.0.1:${UI_TEST_PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
