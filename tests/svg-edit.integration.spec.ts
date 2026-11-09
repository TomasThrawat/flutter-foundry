import { test, expect } from "@playwright/test";
import { runSvgEdit } from "../lib/svg-edit";

test("official SVG-Edit loads and exposes its editor API", async ({ page }) => {
  await page.goto(process.env.SVG_EDIT_URL || "https://svgedit.netlify.app/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const editor = (window as unknown as { svgEditor?: { isReady?: boolean; loadSvgString?: unknown; svgCanvas?: unknown } }).svgEditor;
    return Boolean(editor?.isReady && typeof editor.loadSvgString === "function" && editor.svgCanvas);
  }, undefined, { timeout: 45_000 });

  const state = await page.evaluate(() => {
    const editor = (window as unknown as { svgEditor?: { isReady?: boolean; loadSvgString?: unknown; svgCanvas?: { getSvgString?: unknown } } }).svgEditor;
    return {
      ready: Boolean(editor?.isReady),
      load: typeof editor?.loadSvgString,
      serialize: typeof editor?.svgCanvas?.getSvgString
    };
  });
  expect(state.ready).toBe(true);
  expect(state.load).toBe("function");
  expect(["function", "undefined"]).toContain(state.serialize);
});

test("runSvgEdit performs an end-to-end SVG-Edit round trip and returns a PNG preview", async () => {
  test.setTimeout(90_000);
  const input = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="42" fill="#ffffff"/></svg>';
  const result = await runSvgEdit(input);
  const preview = Buffer.from(result.previewPngBase64, "base64");

  expect(result.svg).toContain("<circle");
  expect(result.svg).toContain('viewBox="0 0 128 128"');
  expect(preview.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(result.editorUrl).toMatch(/^https:\/\/(svgedit\.netlify\.app|unpkg\.com)\//);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
});
