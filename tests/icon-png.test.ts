import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { generateIconFromPrompt } from "../lib/icon-generator";
import { renderIconPng } from "../lib/icon-png";

test("renders a generated icon as a square PNG without a browser", async () => {
  const icon = generateIconFromPrompt({
    prompt: "white camera icon on pure black background with purple accent",
    size: 128
  });
  const rendered = await renderIconPng(icon.svgMarkup, icon.size);
  const png = Buffer.from(rendered.pngBase64, "base64");
  const metadata = await sharp(png).metadata();

  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(rendered.width, 128);
  assert.equal(rendered.height, 128);
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  assert.ok(png.length > 100);
});

test("rejects an invalid icon size or missing SVG", async () => {
  await assert.rejects(() => renderIconPng("<svg />", 32), /128 to 1024/);
  await assert.rejects(() => renderIconPng("not svg", 128), /valid SVG/);
});
