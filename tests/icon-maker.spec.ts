import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("generates an icon, inserts a safe shape, and removes the selected element", async ({ page }) => {
	await page.goto("/icon-maker");
	const svg = page.locator("#svg-input");
	await page.locator("#icon-prompt").fill("minimal camera icon");
	await page.getByRole("button", { name: "Generate icon" }).click();
	await expect(svg).toHaveValue(/<svg/);
	await expect.poll(async () => page.getByLabel("Target element").locator("option").count()).toBeGreaterThan(1);

	await page.getByLabel("Add shape").selectOption("circle");
	await page.getByRole("button", { name: "Add shape" }).click();
	await expect(svg).toHaveValue(/ff-added-\d+/, { timeout: 30_000 });
	const insertedId = (await svg.inputValue()).match(/id="(ff-added-\d+)"/)?.[1];
	expect(insertedId).toBeTruthy();
	await page.getByLabel("Target element").selectOption(insertedId!);
	await page.getByRole("button", { name: "Delete selected element" }).click();
	await expect(svg).not.toHaveValue(new RegExp(insertedId!), { timeout: 30_000 });
	await expect(page.getByText(/Minimum stroke at 48 px:/)).toBeVisible();
});

test("restoring an earlier SVG version clears stale generated variants", async ({ page }) => {
	await page.goto("/icon-maker");
	await page.locator("#icon-prompt").fill("simple document icon");
	await page.getByRole("button", { name: "Generate icon" }).click();
	await expect(page.locator("#svg-input")).toHaveValue(/<svg/);
	await page.getByRole("button", { name: "Create 4 variants" }).click();
	await expect(page.getByRole("heading", { name: "Style variants" })).toBeVisible({ timeout: 45_000 });
	await page.getByLabel("Saved versions (this browser)").selectOption("0");
	await expect(page.getByRole("heading", { name: "Style variants" })).toHaveCount(0);
});

test("keeps the Icon Maker controls available at a narrow mobile viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/icon-maker");
	await expect(page.getByRole("heading", { name: "Icon Maker" })).toBeVisible();
	await expect(page.locator("#icon-prompt")).toBeVisible();
	await expect(page.getByRole("button", { name: "Generate icon" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Export Android + iOS + Flutter ZIP" })).toBeVisible();
});


test("downloads the generated ZIP as a binary archive", async ({ page }) => {
	await page.goto("/icon-maker");
	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Export Android + iOS + Flutter ZIP" }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe("flutter-foundry-icon-pack.zip");
	const path = await download.path();
	expect(path).not.toBeNull();
	const archive = await readFile(path!);
	expect(Array.from(archive.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
	expect(archive.length).toBeGreaterThan(1024);
});
