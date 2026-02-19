import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  workers: 2,
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
    command: "NODE_ENV=production PORT=3001 npx tsx server.ts",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
