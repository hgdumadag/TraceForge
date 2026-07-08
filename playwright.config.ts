import { defineConfig } from "@playwright/test";

/** E2E tests run against the BUILT app (npm run build first):
 * one API process serving the compiled web UI, with a throwaway data dir. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4899",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:4899/api/health",
    timeout: 30000,
    reuseExistingServer: false
  }
});
