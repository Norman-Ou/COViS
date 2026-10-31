import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.T2I_E2E_PORT ?? 4182);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure"
  },
  webServer: {
    // Scoring writes labels, so the server uses a fresh scratch copy of the fixture set.
    command: `rm -rf .cache/scoring-e2e && mkdir -p .cache && cp -R fixtures/scoring .cache/scoring-e2e && T2I_DATA_ROOT=fixtures/datasets T2I_SCORING_ROOT=.cache/scoring-e2e PORT=${port} pnpm start`,
    port,
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Firefox can leave goto pending after a fully loaded page (microsoft/playwright#42183).
    // Keep local runs strict; CI gets one retry and retains the failing attempt's trace.
    { name: "firefox", retries: process.env.CI ? 1 : 0, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ]
});
