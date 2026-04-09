import { defineConfig } from "@playwright/test";

const E2E_DB_URL = "postgresql://localhost/naming-things-e2e";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: `DATABASE_URL=${E2E_DB_URL} NODE_ENV=production PORT=3001 OPENROUTER_API_KEY=mock-key OPENROUTER_MOCK=1 npx tsx server.ts`,
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
