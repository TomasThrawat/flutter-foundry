import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	testMatch: "icon-maker.spec.ts",
	timeout: 90_000,
	retries: process.env.CI ? 1 : 0,
	reporter: "list",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:3000",
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command: "npm run dev -- --hostname 127.0.0.1",
		url: "http://127.0.0.1:3000/icon-maker",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
