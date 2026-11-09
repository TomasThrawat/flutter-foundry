import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import {
	analyzeIconQuality,
	editSvgElements,
	exportIconBundle,
	generateIconVariants,
	optimizeSvg,
	prepareEditableSvg,
	svgToAndroidVectorDrawable,
	vectorizeRasterImage,
} from "../lib/icon-pipeline";

const sample =
	'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="0" y="0" width="512" height="512" fill="#000000"/><path d="M140 80 H330 V420 H140 Z" fill="#ffffff"/><path d="M190 220 H280 M190 280 H280 M190 340 H280" fill="none" stroke="#000000" stroke-width="18" stroke-linecap="round"/></svg>';

test("creates deterministic style variants with separate SVGs", () => {
	const variants = generateIconVariants({
		prompt: "white file folder with three horizontal lines on black background",
		size: 256,
	});
	assert.equal(variants.length, 4);
	assert.deepEqual(
		variants.map((item) => item.style),
		["minimal", "geometric", "rounded", "outline"],
	);
	assert.ok(variants.every((item) => item.svgMarkup.startsWith("<svg")));
	assert.equal(new Set(variants.map((item) => item.svgMarkup)).size, 4);
	assert.ok(
		variants.every(
			(item) => (item.svgMarkup.match(/<line /g) || []).length >= 3,
		),
	);
});

test("prepares stable element IDs and applies a targeted change only to the selected element", () => {
	const prepared = prepareEditableSvg(sample);
	assert.ok(prepared.elements.length >= 2);
	const target = prepared.elements.find((item) => item.tag === "path");
	assert.ok(target);
	const edited = editSvgElements(prepared.svgMarkup, [
		{
			id: target.id,
			action: "set-attributes",
			attributes: { fill: "#ff0000" },
		},
	]);
	assert.equal(edited.applied, 1);
	assert.match(edited.svgMarkup, /fill="#ff0000"/);
	assert.match(edited.svgMarkup, /stroke="#000000"/);
	assert.equal(edited.elements.length, prepared.elements.length);
});

test("rejects unsafe or unknown targeted element attributes", () => {
	const prepared = prepareEditableSvg(sample);
	const target = prepared.elements[0];
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: target.id,
					action: "set-attributes",
					attributes: { onclick: "alert(1)" },
				},
			]),
		/not editable/,
	);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: target.id,
					action: "set-attributes",
					attributes: { fill: "url(https://example.com/x)" },
				},
			]),
		/Unsafe value|Invalid fill/,
	);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: "missing-id",
					action: "remove-element",
				},
			]),
		/not found/,
	);
});

test("adds safe SVG primitives, edits their geometry and removes selected elements", () => {
	const prepared = prepareEditableSvg(sample);
	const inserted = editSvgElements(prepared.svgMarkup, [
		{
			id: "ff-added-circle",
			action: "add-element",
			tag: "circle",
			attributes: {
				cx: "256",
				cy: "256",
				r: "42",
				fill: "#ff0000",
				opacity: "0.8",
			},
		},
		{
			id: "ff-added-line",
			action: "add-element",
			tag: "line",
			attributes: {
				x1: "100",
				y1: "100",
				x2: "400",
				y2: "400",
				fill: "none",
				stroke: "#ffffff",
				"stroke-width": "12",
				"stroke-linecap": "round",
			},
		},
	]);
	assert.equal(inserted.applied, 2);
	assert.match(inserted.svgMarkup, /id="ff-added-circle"/);
	assert.match(inserted.svgMarkup, /stroke-linecap="round"/);
	const edited = editSvgElements(inserted.svgMarkup, [
		{
			id: "ff-added-circle",
			action: "set-attributes",
			attributes: {
				"stroke-width": "12",
				stroke: "#ffffff",
				transform: "translate(8 12) scale(1.1) rotate(4 256 256)",
			},
		},
	]);
	assert.match(edited.svgMarkup, /stroke-width="12"/);
	assert.match(
		edited.svgMarkup,
		/transform="translate\(8 12\) scale\(1.1\) rotate\(4 256 256\)"/,
	);
	const removed = editSvgElements(edited.svgMarkup, [
		{ id: "ff-added-circle", action: "remove-element" },
	]);
	assert.doesNotMatch(removed.svgMarkup, /ff-added-circle/);
	assert.match(removed.svgMarkup, /ff-added-line/);
});

test("rejects unsafe tags, duplicate ids and unsafe attributes when inserting SVG primitives", () => {
	const prepared = prepareEditableSvg(sample);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: "bad-tag",
					action: "add-element",
					tag: "script" as never,
					attributes: { d: "M0 0" },
				},
			]),
		/Unsupported SVG element type/,
	);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: prepared.elements[0].id,
					action: "add-element",
					tag: "circle",
					attributes: { r: "2" },
				},
			]),
		/already exists/,
	);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: "bad-color",
					action: "add-element",
					tag: "circle",
					attributes: { r: "2", fill: "url(https://example.com/x)" },
				},
			]),
		/Unsafe value|Invalid fill/,
	);
});

test("quality analysis detects low contrast and strokes that disappear at launcher size", async () => {
	const source =
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="0" y="0" width="512" height="512" fill="#000000"/><circle cx="256" cy="256" r="100" fill="#202020"/><path d="M100 100 L412 412" fill="none" stroke="#202020" stroke-width="2"/></svg>';
	const report = await analyzeIconQuality(source);
	assert.ok(
		report.findings.some((finding) => finding.code === "low-artwork-contrast"),
	);
	assert.ok(
		report.findings.some(
			(finding) => finding.code === "thin-small-size-stroke",
		),
	);
	assert.ok((report.metrics.minimumContrastRatio ?? 99) < 3);
	assert.ok((report.metrics.minimumStrokeWidthAt48px ?? 99) < 1);
});

test("quality analysis reports dimensions, element count and artwork metrics", async () => {
	const report = await analyzeIconQuality(sample);
	assert.equal(report.dimensions.aspectRatio, 1);
	assert.equal(report.metrics.elementCount, 3);
	assert.ok(report.score >= 0 && report.score <= 100);
	assert.ok(Array.isArray(report.findings));
});

test("quality analysis measures visible artwork on a transparent canvas", async () => {
	const transparentSvg =
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><circle cx="256" cy="256" r="120" fill="#ffffff"/></svg>';
	const report = await analyzeIconQuality(transparentSvg);
	assert.ok(
		!report.findings.some((finding) => finding.code === "no-visible-artwork"),
	);
	assert.ok(report.metrics.artworkWidth > 0);
	assert.ok(report.metrics.artworkHeight > 0);
	assert.ok(report.metrics.artworkCoverage > 0.12);
	assert.ok(report.metrics.artworkCoverage < 0.78);
});

test("quality analysis samples an opaque canvas background from the border", async () => {
	const report = await analyzeIconQuality(sample);
	assert.ok(
		!report.findings.some((finding) => finding.code === "no-visible-artwork"),
	);
	assert.ok(report.metrics.artworkCoverage > 0.12);
	assert.ok(report.metrics.artworkCoverage < 0.78);
});

test("quality analysis reports a fully transparent canvas with no visible artwork", async () => {
	const emptySvg =
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path d="M10 10 H20 V20 Z" fill="none" stroke="none"/></svg>';
	const report = await analyzeIconQuality(emptySvg);
	assert.ok(
		report.findings.some((finding) => finding.code === "no-visible-artwork"),
	);
	assert.equal(report.metrics.artworkWidth, 0);
	assert.equal(report.metrics.artworkHeight, 0);
});

test("rejects duplicate IDs across editable and non-editable SVG elements", () => {
	const duplicate =
		'<svg xmlns="http://www.w3.org/2000/svg" id="root"><defs id="shared"></defs><path id="shared" d="M10 10 H20 V20 Z"/></svg>';
	assert.throws(
		() => prepareEditableSvg(duplicate),
		/duplicate element id: shared/,
	);
});

test("generated SVG element IDs skip IDs already used by non-editable elements", () => {
	const source =
		'<svg xmlns="http://www.w3.org/2000/svg"><defs id="ff-element-1"></defs><path d="M10 10 H20 V20 Z"/></svg>';
	const prepared = prepareEditableSvg(source);
	assert.equal(prepared.elements[0].id, "ff-element-2");
});

test("rejects malformed targeted edits instead of treating unknown actions as deletion", () => {
	const prepared = prepareEditableSvg(sample);
	const target = prepared.elements[0];
	assert.throws(
		() => editSvgElements(prepared.svgMarkup, [null as never]),
		/valid element id/,
	);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: target.id,
					action: "remove-attributes",
					attributes: undefined,
				} as never,
			]),
		/Choose 1 to 12 attributes/,
	);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: target.id,
					action: "set-attributes",
					attributes: [],
				} as never,
			]),
		/1 to 12 attributes/,
	);
	assert.throws(
		() =>
			editSvgElements(prepared.svgMarkup, [
				{
					id: target.id,
					action: "replace-element",
				} as never,
			]),
		/Unsupported SVG edit action/,
	);
});

test("SVG optimization removes comments and inter-tag whitespace while preserving geometry", () => {
	const source =
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"> <!-- remove this comment --> \n <circle cx="256" cy="256" r="120" fill="#fff"/> \n </svg>';
	const optimized = optimizeSvg(source);
	assert.ok(optimized.optimizedBytes <= optimized.originalBytes);
	assert.match(optimized.svgMarkup, /<circle/);
	assert.match(optimized.svgMarkup, /viewBox=/);
	assert.doesNotMatch(optimized.svgMarkup, /remove this comment/);
	assert.doesNotMatch(optimized.svgMarkup, />\s+</);
});

test("converts basic geometry into Android VectorDrawable and monochrome foreground", () => {
	const result = svgToAndroidVectorDrawable(sample, { stripBackground: true });
	assert.match(result.xml, /<vector/);
	assert.match(result.xml, /android:pathData=/);
	assert.equal(result.backgroundColor, "#FF000000");
	const mono = svgToAndroidVectorDrawable(sample, {
		monochrome: true,
		stripBackground: true,
	});
	assert.match(mono.xml, /android:fillColor="#FFFFFFFF"/);
	assert.doesNotMatch(mono.xml, /android:fillColor="#FF000000"/);
});

function extractLocalZipEntries(zip: Buffer): Map<string, Buffer> {
	const entries = new Map<string, Buffer>();
	let offset = 0;
	while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
		const method = zip.readUInt16LE(offset + 8);
		const compressedSize = zip.readUInt32LE(offset + 18);
		const nameLength = zip.readUInt16LE(offset + 26);
		const extraLength = zip.readUInt16LE(offset + 28);
		const nameStart = offset + 30;
		const dataStart = nameStart + nameLength + extraLength;
		const name = zip
			.subarray(nameStart, nameStart + nameLength)
			.toString("utf8");
		const compressed = zip.subarray(dataStart, dataStart + compressedSize);
		const data = method === 8 ? inflateRawSync(compressed) : compressed;
		entries.set(name, data);
		offset = dataStart + compressedSize;
	}
	return entries;
}

test("flattens transparent iOS and Flutter launcher images onto the selected solid background", async () => {
	const transparentSvg =
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><circle cx="256" cy="256" r="120" fill="#ffffff"/></svg>';
	const bundle = await exportIconBundle(transparentSvg, {
		appName: "Transparent Test",
		packageName: "com.example.transparent",
		pngSizes: [128],
		iosBackgroundColor: "#123456",
	});
	const entries = extractLocalZipEntries(
		Buffer.from(bundle.zipBase64, "base64"),
	);
	for (const path of [
		"ios/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png",
		"flutter/assets/launcher_icon.png",
	]) {
		const image = entries.get(path);
		assert.ok(image, `${path} should be included in the export`);
		const decoded = await sharp(image)
			.raw()
			.toBuffer({ resolveWithObject: true });
		assert.equal(decoded.info.channels, 3);
		assert.deepEqual(
			Array.from(decoded.data.subarray(0, 3)),
			[0x12, 0x34, 0x56],
		);
	}
	const configFile = entries.get("flutter/flutter_launcher_icons.yaml");
	assert.ok(configFile);
	const config = configFile.toString("utf8");
	assert.match(config, /adaptive_icon_background: "#123456"/);
	assert.match(config, /background_color_ios: "#123456"/);
});

test("exports opaque iOS assets and a Flutter-ready launcher-icons bundle", async () => {
	const bundle = await exportIconBundle(sample, {
		appName: "Test App",
		packageName: "com.example.test",
		pngSizes: [128, 256],
		iosBackgroundColor: "#123456",
	});
	const zip = Buffer.from(bundle.zipBase64, "base64");
	assert.equal(zip.readUInt32LE(0), 0x04034b50);
	const entries = extractLocalZipEntries(zip);
	assert.ok(
		entries.has("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"),
	);
	assert.ok(
		entries.has("ios/Assets.xcassets/AppIcon.appiconset/Contents.json"),
	);
	assert.ok(entries.has("flutter/flutter_launcher_icons.yaml"));
	assert.ok(entries.has("flutter/pubspec.yaml.snippet"));
	assert.ok(entries.has("flutter/assets/adaptive_foreground.png"));
	assert.ok(entries.has("flutter/assets/adaptive_monochrome.png"));
	const configFile = entries.get("flutter/flutter_launcher_icons.yaml");
	assert.ok(configFile);
	const config = configFile.toString("utf8");
	assert.match(config, /remove_alpha_ios: true/);
	assert.match(config, /image_path_ios_dark_transparent/);
	assert.match(config, /image_path_ios_tinted_grayscale/);
	const iosPng = entries.get(
		"ios/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png",
	);
	assert.ok(iosPng);
	const iosMetadata = await sharp(iosPng).metadata();
	assert.equal(iosMetadata.hasAlpha, false);
	const flutterLauncherPng = entries.get("flutter/assets/launcher_icon.png");
	assert.ok(flutterLauncherPng);
	const flutterLauncher = await sharp(flutterLauncherPng).metadata();
	assert.equal(flutterLauncher.hasAlpha, false);
	const foregroundPng = entries.get("flutter/assets/adaptive_foreground.png");
	assert.ok(foregroundPng);
	const foregroundMetadata = await sharp(foregroundPng).metadata();
	assert.equal(foregroundMetadata.hasAlpha, true);
	assert.ok(entries.has("manifest.json"));
	assert.ok(bundle.fileCount > 20);
});

test("vectorizes a small raster image into editable SVG rectangles and PNG preview", async () => {
	const image = await sharp({
		create: {
			width: 12,
			height: 12,
			channels: 4,
			background: { r: 255, g: 255, b: 255, alpha: 1 },
		},
	})
		.composite([
			{
				input: {
					create: {
						width: 6,
						height: 12,
						channels: 4,
						background: { r: 0, g: 0, b: 0, alpha: 1 },
					},
				},
				left: 3,
				top: 0,
			},
		])
		.png()
		.toBuffer();
	const converted = await vectorizeRasterImage(image.toString("base64"), {
		size: 24,
		colors: 4,
	});
	assert.match(converted.svgMarkup, /<rect/);
	assert.ok(converted.palette.length >= 1);
	const metadata = await sharp(
		Buffer.from(converted.pngBase64, "base64"),
	).metadata();
	assert.equal(metadata.width, 512);
	assert.equal(metadata.height, 512);
});

test("preserves partial alpha as SVG opacity and in the PNG preview", async () => {
	const width = 24;
	const height = 24;
	const pixels = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			pixels[offset] = 240;
			pixels[offset + 1] = 80;
			pixels[offset + 2] = 20;
			pixels[offset + 3] = x < width / 2 ? 128 : 255;
		}
	}
	const image = await sharp(pixels, { raw: { width, height, channels: 4 } })
		.png()
		.toBuffer();

	const converted = await vectorizeRasterImage(image.toString("base64"), {
		size: 24,
		colors: 4,
	});
	assert.match(converted.svgMarkup, /fill-opacity="0\.502"/);
	assert.match(converted.svgMarkup, /fill-opacity="1"/);

	const preview = await sharp(Buffer.from(converted.pngBase64, "base64"))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const alphaAt = (x: number, y: number) =>
		preview.data[(y * preview.info.width + x) * 4 + 3];
	assert.ok(
		alphaAt(40, 256) > 0 && alphaAt(40, 256) < 255,
		"semi-transparent pixels must remain translucent",
	);
	assert.equal(alphaAt(256, 256), 255, "opaque pixels must remain opaque");
});

test("rejects SVG gradients and filters rather than silently changing Android vector appearance", () => {
	const gradient =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/></svg>';
	const filtered =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter><circle cx="256" cy="256" r="100" filter="url(#blur)"/></svg>';
	assert.throws(() => svgToAndroidVectorDrawable(gradient), /cannot convert/i);
	assert.throws(
		() => svgToAndroidVectorDrawable(filtered),
		/unsupported or unsafe SVG element: <filter>/i,
	);
});
