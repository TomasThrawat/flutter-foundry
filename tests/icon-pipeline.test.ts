import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  analyzeIconQuality,
  editSvgElements,
  exportIconBundle,
  generateIconVariants,
  optimizeSvg,
  prepareEditableSvg,
  svgToAndroidVectorDrawable,
  vectorizeRasterImage
} from "../lib/icon-pipeline";

const sample = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="0" y="0" width="512" height="512" fill="#000000"/><path d="M140 80 H330 V420 H140 Z" fill="#ffffff"/><path d="M190 220 H280 M190 280 H280 M190 340 H280" fill="none" stroke="#000000" stroke-width="18" stroke-linecap="round"/></svg>';

test("creates deterministic style variants with separate SVGs", () => {
  const variants = generateIconVariants({ prompt: "white camera icon on black background", size: 256 });
  assert.equal(variants.length, 4);
  assert.deepEqual(variants.map((item) => item.style), ["minimal", "geometric", "rounded", "outline"]);
  assert.ok(variants.every((item) => item.svgMarkup.startsWith("<svg")));
  assert.notEqual(variants[0].svgMarkup, variants[1].svgMarkup);
});

test("prepares stable element IDs and applies a targeted change only to the selected element", () => {
  const prepared = prepareEditableSvg(sample);
  assert.ok(prepared.elements.length >= 2);
  const target = prepared.elements.find((item) => item.tag === "path");
  assert.ok(target);
  const edited = editSvgElements(prepared.svgMarkup, [{
    id: target!.id,
    action: "set-attributes",
    attributes: { fill: "#ff0000" }
  }]);
  assert.equal(edited.applied, 1);
  assert.match(edited.svgMarkup, /fill="#ff0000"/);
  assert.match(edited.svgMarkup, /stroke="#000000"/);
  assert.equal(edited.elements.length, prepared.elements.length);
});

test("rejects unsafe or unknown targeted element attributes", () => {
  const prepared = prepareEditableSvg(sample);
  const target = prepared.elements[0];
  assert.throws(() => editSvgElements(prepared.svgMarkup, [{
    id: target.id,
    action: "set-attributes",
    attributes: { onclick: "alert(1)" }
  }]), /not editable/);
  assert.throws(() => editSvgElements(prepared.svgMarkup, [{
    id: target.id,
    action: "set-attributes",
    attributes: { fill: "url(https://example.com/x)" }
  }]), /Unsafe value|Invalid fill/);
  assert.throws(() => editSvgElements(prepared.svgMarkup, [{
    id: "missing-id",
    action: "remove-element"
  }]), /not found/);
});

test("quality analysis reports dimensions, element count and artwork metrics", async () => {
  const report = await analyzeIconQuality(sample);
  assert.equal(report.dimensions.aspectRatio, 1);
  assert.equal(report.metrics.elementCount, 3);
  assert.ok(report.score >= 0 && report.score <= 100);
  assert.ok(Array.isArray(report.findings));
});

test("SVG optimization removes inter-tag whitespace while preserving geometry", () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"> \n <circle cx="256" cy="256" r="120" fill="#fff"/> \n </svg>';
  const optimized = optimizeSvg(source);
  assert.ok(optimized.optimizedBytes <= optimized.originalBytes);
  assert.match(optimized.svgMarkup, /<circle/);
  assert.match(optimized.svgMarkup, /viewBox=/);
});

test("converts basic geometry into Android VectorDrawable and monochrome foreground", () => {
  const result = svgToAndroidVectorDrawable(sample, { stripBackground: true });
  assert.match(result.xml, /<vector/);
  assert.match(result.xml, /android:pathData=/);
  assert.equal(result.backgroundColor, "#FF000000");
  const mono = svgToAndroidVectorDrawable(sample, { monochrome: true, stripBackground: true });
  assert.match(mono.xml, /android:fillColor="#FFFFFFFF"/);
  assert.doesNotMatch(mono.xml, /android:fillColor="#FF000000"/);
});

test("exports a ZIP containing Android and iOS app icon resources", async () => {
  const bundle = await exportIconBundle(sample, { appName: "Test App", packageName: "com.example.test", pngSizes: [128, 256] });
  const zip = Buffer.from(bundle.zipBase64, "base64");
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml")));
  assert.ok(zip.includes(Buffer.from("ios/Assets.xcassets/AppIcon.appiconset/Contents.json")));
  assert.ok(zip.includes(Buffer.from("manifest.json")));
  assert.ok(bundle.fileCount > 15);
});

test("vectorizes a small raster image into editable SVG rectangles and PNG preview", async () => {
  const image = await sharp({
    create: { width: 12, height: 12, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).composite([{ input: { create: { width: 6, height: 12, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }, left: 3, top: 0 }]).png().toBuffer();
  const converted = await vectorizeRasterImage(image.toString("base64"), { size: 24, colors: 4 });
  assert.match(converted.svgMarkup, /<rect/);
  assert.ok(converted.palette.length >= 1);
  const metadata = await sharp(Buffer.from(converted.pngBase64, "base64")).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});
