import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3000", viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHAT_TEST_CHROMIUM, args: process.env.CHAT_TEST_CHROMIUM ? ["--no-sandbox", "--disable-dev-shm-usage"] : [] } },
  webServer: { command: "npm run start -- --port 3000 --hostname 127.0.0.1", url: "http://127.0.0.1:3000", timeout: 60_000, reuseExistingServer: false },
});
