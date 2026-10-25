import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { generateIconFromPrompt } from "../lib/icon-generator";
import { renderIconPng, validateCustomIconSvg } from "../lib/icon-png";

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


test("accepts self-contained model-authored SVG with local gradients", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><circle cx="64" cy="64" r="40" fill="url(#g)"/></svg>';
  const safeSvg = validateCustomIconSvg(svg);
  const rendered = await renderIconPng(safeSvg, 256);
  const metadata = await sharp(Buffer.from(rendered.pngBase64, "base64")).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
});

test("rejects active content and external SVG resources", () => {
  assert.throws(() => validateCustomIconSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /Active content/);
  assert.throws(() => validateCustomIconSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), /event-handler/);
  assert.throws(() => validateCustomIconSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>'), /Active content/);
  assert.throws(() => validateCustomIconSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.com/a.svg#x)"/></svg>'), /External URL/);
  assert.throws(() => validateCustomIconSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg><svg></svg>'), /exactly one root/);
});
