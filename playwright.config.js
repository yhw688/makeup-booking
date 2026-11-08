const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./test/e2e",
  testMatch: "*.spec.js",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3137",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: "node test/e2e/server.js",
    url: "http://127.0.0.1:3137/api/health",
    reuseExistingServer: false,
  },
});
