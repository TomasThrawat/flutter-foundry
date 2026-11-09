import { deflateRawSync } from "node:zlib";
import {
	DOMParser,
	XMLSerializer,
	type Document as XmlDocument,
	type Element as XmlElement,
} from "@xmldom/xmldom";
import sharp from "sharp";
import {
	generateIconFromPrompt,
	type IconGenerationInput,
	type IconStyle,
} from "./icon-generator";
import { renderIconPng, validateCustomIconSvg } from "./icon-png";

const SAFE_TAGS = new Set([
	"svg",
	"g",
	"defs",
	"title",
	"desc",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"linearGradient",
	"radialGradient",
	"stop",
	"clipPath",
	"mask",
]);
const EDITABLE_TAGS = new Set([
	"g",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
]);
const EDITABLE_ATTRIBUTES = new Set([
	"fill",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"opacity",
	"fill-opacity",
	"stroke-opacity",
	"x",
	"y",
	"width",
	"height",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"x1",
	"y1",
	"x2",
	"y2",
	"d",
	"points",
	"transform",
	"font-size",
	"font-weight",
	"text-anchor",
]);
const COLOR_NAMES: Record<string, string> = {
	black: "#000000",
	white: "#ffffff",
	red: "#ff0000",
	blue: "#0000ff",
	green: "#008000",
	yellow: "#ffff00",
	orange: "#ffa500",
	purple: "#800080",
	gray: "#808080",
	grey: "#808080",
	transparent: "#00000000",
	none: "#00000000",
};
const SVG_NS = "http://www.w3.org/2000/svg";
const ANDROID_NS = "http://schemas.android.com/apk/res/android";

function parseSvg(svgMarkup: string): {
	doc: XmlDocument;
	root: XmlElement;
	clean: string;
} {
	const safe = validateCustomIconSvg(svgMarkup);
	const errors: string[] = [];
	const doc = new DOMParser({
		onError: (level, message) => {
			if (level === "error" || level === "fatalError") errors.push(message);
		},
	}).parseFromString(safe, "image/svg+xml");
	const root = doc.documentElement;
	if (
		errors.length ||
		!root ||
		(root.localName || root.nodeName).toLowerCase() !== "svg"
	)
		throw new Error(
			"The SVG could not be parsed as a single valid SVG document.",
		);
	const nodes = Array.from(root.getElementsByTagName("*"));
	for (const node of [root, ...nodes]) {
		const tag = node.localName || node.nodeName;
		if (!SAFE_TAGS.has(tag))
			throw new Error("Unsupported or unsafe SVG element: <" + tag + ">.");
		for (let i = 0; i < node.attributes.length; i++) {
			const attribute = node.attributes.item(i);
			if (!attribute) continue;
			const name = attribute.name.toLowerCase(),
				value = attribute.value.trim();
			if (
				name.startsWith("on") ||
				name === "style" ||
				name === "src" ||
				name === "srcset"
			)
				throw new Error("Unsafe SVG attribute: " + attribute.name + ".");
			if (
				(name === "href" || name === "xlink:href") &&
				value &&
				!value.startsWith("#")
			)
				throw new Error("Only local SVG fragment references are allowed.");
			if (
				/url\s*\(/i.test(value) &&
				!/url\(\s*["']?#[-\w:.]+["']?\s*\)/i.test(value)
			)
				throw new Error("External SVG references are not allowed.");
			if (/javascript:|vbscript:|data:text\/html|@import/i.test(value))
				throw new Error("Unsafe SVG attribute value.");
		}
	}
	return { doc, root, clean: new XMLSerializer().serializeToString(root) };
}
function allElements(root: XmlElement): XmlElement[] {
	return [root, ...Array.from(root.getElementsByTagName("*"))];
}
function serialize(root: XmlElement): string {
	return new XMLSerializer().serializeToString(root);
}

export type ElementSummary = {
	id: string;
	tag: string;
	fill: string | null;
	stroke: string | null;
	label: string;
};
export function prepareEditableSvg(svgMarkup: string): {
	svgMarkup: string;
	elements: ElementSummary[];
} {
	const parsed = parseSvg(svgMarkup),
		root = parsed.root,
		elements = allElements(root);
	const used = new Set<string>();
	for (const element of elements) {
		const id = element.getAttribute("id") || "";
		if (!id) continue;
		if (id.length > 128 || id !== id.trim() || /\s/.test(id))
			throw new Error("SVG contains an invalid element id.");
		if (used.has(id))
			throw new Error("SVG contains a duplicate element id: " + id + ".");
		used.add(id);
	}
	let next = 1;
	const summaries: ElementSummary[] = [];
	for (const element of elements.slice(1)) {
		const tag = element.localName || element.nodeName;
		if (!EDITABLE_TAGS.has(tag)) continue;
		let id = element.getAttribute("id") || "";
		if (!id) {
			do {
				id = "ff-element-" + next++;
			} while (used.has(id));
			element.setAttribute("id", id);
			used.add(id);
		}
		summaries.push({
			id,
			tag,
			fill: element.getAttribute("fill") || null,
			stroke: element.getAttribute("stroke") || null,
			label: tag + " · " + id,
		});
	}
	return { svgMarkup: serialize(root), elements: summaries };
}

export type SvgElementOperation =
	| { id: string; action: "set-attributes"; attributes: Record<string, string> }
	| { id: string; action: "remove-attributes"; attributes: string[] }
	| { id: string; action: "remove-element" };

function validateAttributeValue(name: string, value: string): void {
	if (typeof value !== "string" || value.length > 4000)
		throw new Error("Invalid value for " + name + ".");
	if (
		/javascript:|vbscript:|data:|url\(\s*(?!["']?#)[^)]+\)|<|>|[;]/i.test(value)
	)
		throw new Error("Unsafe value for " + name + ".");
	if (name === "fill" || name === "stroke") {
		if (
			!/^(none|transparent|currentColor|#[0-9a-f]{3,8}|[a-z]{1,24}|url\(\s*["']?#[\w:.-]+["']?\s*\))$/i.test(
				value,
			)
		)
			throw new Error("Invalid " + name + " color.");
		return;
	}
	if (name === "d") {
		if (!/^[MmZzLlHhVvCcSsQqTtAaEe0-9eE+.,\s-]+$/.test(value))
			throw new Error("Path data contains unsupported characters.");
		return;
	}
	if (name === "points") {
		if (!/^[0-9eE+.,\s-]+$/.test(value))
			throw new Error("Polygon points contain unsupported characters.");
		return;
	}
	if (name === "transform") {
		if (
			!/^(?:(?:translate|scale|rotate|skewX|skewY|matrix)\(\s*[-+0-9eE.,\s]+\)\s*)+$/i.test(
				value,
			)
		)
			throw new Error("Unsupported transform syntax.");
		return;
	}
	if (name === "stroke-linecap" && !["butt", "round", "square"].includes(value))
		throw new Error("Invalid stroke-linecap.");
	if (
		name === "stroke-linejoin" &&
		!["miter", "round", "bevel"].includes(value)
	)
		throw new Error("Invalid stroke-linejoin.");
	if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px|%)?$/i.test(value))
		throw new Error("Invalid numeric value for " + name + ".");
	const numeric = Number.parseFloat(value);
	if (!Number.isFinite(numeric) || Math.abs(numeric) > 10000)
		throw new Error(name + " is outside the supported range.");
	if (name.includes("opacity") && (numeric < 0 || numeric > 1))
		throw new Error(name + " must be between 0 and 1.");
}

export function editSvgElements(
	svgMarkup: string,
	operations: SvgElementOperation[],
): { svgMarkup: string; applied: number; elements: ElementSummary[] } {
	if (
		!Array.isArray(operations) ||
		operations.length < 1 ||
		operations.length > 20
	)
		throw new Error(
			"Provide between 1 and 20 targeted SVG element operations.",
		);
	const root = parseSvg(svgMarkup).root;
	let applied = 0;
	for (const operation of operations) {
		if (
			!operation ||
			typeof operation !== "object" ||
			typeof operation.id !== "string" ||
			!operation.id.trim() ||
			operation.id.length > 128
		)
			throw new Error("Each targeted edit requires a valid element id.");
		const target = allElements(root).find(
			(element) => element.getAttribute?.("id") === operation.id,
		);
		if (!target || target === root)
			throw new Error(
				"SVG element not found or not editable: " + operation.id + ".",
			);
		const tag = target.localName || target.nodeName;
		if (!EDITABLE_TAGS.has(tag))
			throw new Error(
				"Element " + operation.id + " is not an editable graphic element.",
			);
		if (operation.action === "set-attributes") {
			if (
				!operation.attributes ||
				typeof operation.attributes !== "object" ||
				Array.isArray(operation.attributes)
			)
				throw new Error("A set operation must contain 1 to 12 attributes.");
			const entries = Object.entries(operation.attributes);
			if (!entries.length || entries.length > 12)
				throw new Error("A set operation must contain 1 to 12 attributes.");
			for (const [name, value] of entries) {
				if (!EDITABLE_ATTRIBUTES.has(name))
					throw new Error("Attribute is not editable: " + name + ".");
				validateAttributeValue(name, value);
				target.setAttribute(name, value);
			}
		} else if (operation.action === "remove-attributes") {
			if (
				!Array.isArray(operation.attributes) ||
				!operation.attributes.length ||
				operation.attributes.length > 12
			)
				throw new Error("Choose 1 to 12 attributes to remove.");
			for (const name of operation.attributes) {
				if (typeof name !== "string" || !EDITABLE_ATTRIBUTES.has(name))
					throw new Error("Attribute is not editable: " + String(name) + ".");
				target.removeAttribute(name);
			}
		} else if (operation.action === "remove-element") {
			if (!target.parentNode)
				throw new Error("The selected element cannot be removed.");
			target.parentNode.removeChild(target);
		} else {
			throw new Error("Unsupported SVG edit action.");
		}
		applied++;
	}
	const prepared = prepareEditableSvg(serialize(root));
	return {
		svgMarkup: prepared.svgMarkup,
		applied,
		elements: prepared.elements,
	};
}

export type IconQualityFinding = {
	severity: "warning" | "info";
	code: string;
	message: string;
	recommendation: string;
};
export type IconQualityReport = {
	score: number;
	dimensions: {
		viewBoxWidth: number;
		viewBoxHeight: number;
		aspectRatio: number;
		renderedWidth: number;
		renderedHeight: number;
	};
	metrics: {
		elementCount: number;
		approximateColors: number;
		artworkWidth: number;
		artworkHeight: number;
		artworkCoverage: number;
		horizontalCenterOffset: number;
		verticalCenterOffset: number;
	};
	findings: IconQualityFinding[];
	elements: ElementSummary[];
};
export async function analyzeIconQuality(
	svgMarkup: string,
): Promise<IconQualityReport> {
	const prepared = prepareEditableSvg(svgMarkup),
		root = parseSvg(prepared.svgMarkup).root;
	const viewBox = (root.getAttribute("viewBox") || "0 0 512 512")
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (
		viewBox.length !== 4 ||
		viewBox.some((value: number) => !Number.isFinite(value)) ||
		viewBox[2] <= 0 ||
		viewBox[3] <= 0
	)
		throw new Error("SVG viewBox must contain four valid positive dimensions.");
	const vw = viewBox[2],
		vh = viewBox[3];
	const rendered = await sharp(Buffer.from(prepared.svgMarkup))
		.resize(256, 256, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const data = rendered.data,
		info = rendered.info;
	const paletteCounts = new Map<string, number>();
	const borderCounts = new Map<
		string,
		{ count: number; red: number; green: number; blue: number }
	>();
	const alphaThreshold = 12,
		borderPixelCount = Math.max(1, 2 * info.width + 2 * info.height - 4);
	let visibleBorderPixels = 0;
	for (let y = 0; y < info.height; y++)
		for (let x = 0; x < info.width; x++) {
			const i = (y * info.width + x) * 4;
			if (data[i + 3] < alphaThreshold) continue;
			const red = data[i],
				green = data[i + 1],
				blue = data[i + 2];
			const paletteKey = (red >> 4) + "," + (green >> 4) + "," + (blue >> 4);
			paletteCounts.set(paletteKey, (paletteCounts.get(paletteKey) || 0) + 1);
			if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
				visibleBorderPixels++;
				const bin = borderCounts.get(paletteKey);
				if (bin) {
					bin.count++;
					bin.red += red;
					bin.green += green;
					bin.blue += blue;
				} else borderCounts.set(paletteKey, { count: 1, red, green, blue });
			}
		}
	let dominantBorder: {
		count: number;
		red: number;
		green: number;
		blue: number;
	} | null = null;
	for (const bin of borderCounts.values())
		if (!dominantBorder || bin.count > dominantBorder.count)
			dominantBorder = bin;
	const background = dominantBorder
		? {
				red: dominantBorder.red / dominantBorder.count,
				green: dominantBorder.green / dominantBorder.count,
				blue: dominantBorder.blue / dominantBorder.count,
			}
		: null;
	const transparentBackground = visibleBorderPixels < borderPixelCount;
	let minX = info.width,
		minY = info.height,
		maxX = -1,
		maxY = -1;
	for (let y = 0; y < info.height; y++)
		for (let x = 0; x < info.width; x++) {
			const i = (y * info.width + x) * 4;
			if (data[i + 3] < alphaThreshold) continue;
			const different =
				transparentBackground ||
				!background ||
				Math.abs(data[i] - background.red) +
					Math.abs(data[i + 1] - background.green) +
					Math.abs(data[i + 2] - background.blue) >
					45;
			if (different) {
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
		}
	const hasForeground = maxX >= minX && maxY >= minY,
		artW = hasForeground ? maxX - minX + 1 : 0,
		artH = hasForeground ? maxY - minY + 1 : 0;
	const coverage = hasForeground
		? (artW * artH) / (info.width * info.height)
		: 0;
	const centerX = hasForeground
		? Math.abs((minX + maxX) / 2 - info.width / 2) / info.width
		: 0;
	const centerY = hasForeground
		? Math.abs((minY + maxY) / 2 - info.height / 2) / info.height
		: 0;
	const elementCount = allElements(root).length - 1,
		colors = paletteCounts.size,
		findings: IconQualityFinding[] = [];
	if (Math.abs(vw - vh) / Math.max(vw, vh) > 0.02)
		findings.push({
			severity: "warning",
			code: "non-square-viewbox",
			message: "The SVG viewBox is not square.",
			recommendation: "Use a square canvas for consistent app-icon rendering.",
		});
	if (!hasForeground)
		findings.push({
			severity: "warning",
			code: "no-visible-artwork",
			message:
				"No distinct artwork was detected against the estimated canvas background.",
			recommendation:
				"Check foreground/background colors and confirm the icon is visible.",
		});
	if (hasForeground && coverage < 0.12)
		findings.push({
			severity: "warning",
			code: "small-artwork",
			message: "The artwork occupies a small part of the canvas.",
			recommendation:
				"Increase artwork size while keeping a clear launcher safe margin.",
		});
	if (hasForeground && coverage > 0.78)
		findings.push({
			severity: "warning",
			code: "tight-safe-area",
			message: "The artwork nearly fills the canvas.",
			recommendation:
				"Add outer padding so launcher masks do not crop important details.",
		});
	if (hasForeground && (centerX > 0.07 || centerY > 0.07))
		findings.push({
			severity: "warning",
			code: "off-center",
			message: "The detected artwork is noticeably off-center.",
			recommendation: "Reposition the artwork closer to the canvas center.",
		});
	if (
		hasForeground &&
		(minX < 5 || minY < 5 || maxX > info.width - 6 || maxY > info.height - 6)
	)
		findings.push({
			severity: "warning",
			code: "edge-cropping-risk",
			message: "Artwork touches the canvas edge.",
			recommendation:
				"Increase safe padding to prevent clipping in circle and squircle masks.",
		});
	if (elementCount > 250)
		findings.push({
			severity: "warning",
			code: "complex-svg",
			message: "The SVG contains " + elementCount + " elements.",
			recommendation: "Simplify repeated geometry before shipping the icon.",
		});
	if (colors > 24)
		findings.push({
			severity: "info",
			code: "large-palette",
			message:
				"The preview contains approximately " +
				colors +
				" quantized color groups.",
			recommendation:
				"Reduce unnecessary color variation if a simpler icon style is intended.",
		});
	if (!findings.length)
		findings.push({
			severity: "info",
			code: "balanced",
			message: "No obvious layout or complexity issues were detected.",
			recommendation:
				"Review the icon at launcher size and inside the target app before release.",
		});
	const score = Math.max(
		0,
		100 -
			findings.reduce((sum, f) => sum + (f.severity === "warning" ? 14 : 3), 0),
	);
	return {
		score,
		dimensions: {
			viewBoxWidth: vw,
			viewBoxHeight: vh,
			aspectRatio: Number((vw / vh).toFixed(4)),
			renderedWidth: info.width,
			renderedHeight: info.height,
		},
		metrics: {
			elementCount,
			approximateColors: colors,
			artworkWidth: artW,
			artworkHeight: artH,
			artworkCoverage: Number(coverage.toFixed(4)),
			horizontalCenterOffset: Number(centerX.toFixed(4)),
			verticalCenterOffset: Number(centerY.toFixed(4)),
		},
		findings,
		elements: prepared.elements,
	};
}

export function generateIconVariants(
	input: Omit<IconGenerationInput, "style"> & {
		styles?: Exclude<IconStyle, "auto">[];
	},
): Array<{
	style: Exclude<IconStyle, "auto">;
	svgMarkup: string;
	prompt: string;
	colors: {
		backgroundColor?: string;
		foregroundColor?: string;
		accentColor?: string;
	};
}> {
	const styles: Exclude<IconStyle, "auto">[] = input.styles?.length
		? input.styles
		: ["minimal", "geometric", "rounded", "outline"];
	if (styles.length > 6 || new Set(styles).size !== styles.length)
		throw new Error("Choose 1 to 6 unique icon styles.");
	return styles.map((style: Exclude<IconStyle, "auto">) => {
		const icon = generateIconFromPrompt({ ...input, style });
		return {
			style,
			svgMarkup: icon.svgMarkup,
			prompt: icon.prompt,
			colors: {
				backgroundColor: icon.colors.background,
				foregroundColor: icon.colors.foreground,
				accentColor: icon.colors.accent,
			},
		};
	});
}

export function optimizeSvg(svgMarkup: string): {
	svgMarkup: string;
	originalBytes: number;
	optimizedBytes: number;
	savedBytes: number;
} {
	const clean = parseSvg(svgMarkup).clean;
	const optimized = clean
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/>\s+</g, "><")
		.trim();
	const originalBytes = Buffer.byteLength(svgMarkup, "utf8"),
		optimizedBytes = Buffer.byteLength(optimized, "utf8");
	return {
		svgMarkup: optimized,
		originalBytes,
		optimizedBytes,
		savedBytes: Math.max(0, originalBytes - optimizedBytes),
	};
}

function parseNumber(element: XmlElement, name: string, fallback = 0): number {
	const value = Number.parseFloat(element.getAttribute(name) || "");
	return Number.isFinite(value) ? value : fallback;
}
function fmt(value: number): string {
	return Number(value.toFixed(3)).toString();
}
function rectPath(element: XmlElement): string {
	const x = parseNumber(element, "x"),
		y = parseNumber(element, "y"),
		w = parseNumber(element, "width"),
		h = parseNumber(element, "height");
	if (w <= 0 || h <= 0)
		throw new Error("Vector export found a rectangle with invalid dimensions.");
	const rx = Math.max(
			0,
			Math.min(parseNumber(element, "rx", parseNumber(element, "ry")), w / 2),
		),
		ry = Math.max(0, Math.min(parseNumber(element, "ry", rx), h / 2));
	if (!rx || !ry)
		return (
			"M" +
			fmt(x) +
			" " +
			fmt(y) +
			"h" +
			fmt(w) +
			"v" +
			fmt(h) +
			"h-" +
			fmt(w) +
			"z"
		);
	return (
		"M" +
		fmt(x + rx) +
		" " +
		fmt(y) +
		"h" +
		fmt(w - 2 * rx) +
		"q" +
		fmt(rx) +
		" 0 " +
		fmt(rx) +
		" " +
		fmt(ry) +
		"v" +
		fmt(h - 2 * ry) +
		"q0 " +
		fmt(ry) +
		" -" +
		fmt(rx) +
		" " +
		fmt(ry) +
		"h-" +
		fmt(w - 2 * rx) +
		"q-" +
		fmt(rx) +
		" 0 -" +
		fmt(rx) +
		" -" +
		fmt(ry) +
		"v-" +
		fmt(h - 2 * ry) +
		"q0 -" +
		fmt(ry) +
		" " +
		fmt(rx) +
		" -" +
		fmt(ry) +
		"z"
	);
}
function shapeToPath(element: XmlElement): string {
	const tag = element.localName || element.nodeName;
	if (tag === "path") {
		const d = element.getAttribute("d");
		if (!d) throw new Error("Vector export found a path without path data.");
		return d;
	}
	if (tag === "rect") return rectPath(element);
	if (tag === "circle" || tag === "ellipse") {
		const cx = parseNumber(element, "cx"),
			cy = parseNumber(element, "cy"),
			rx =
				tag === "circle"
					? parseNumber(element, "r")
					: parseNumber(element, "rx"),
			ry = tag === "circle" ? rx : parseNumber(element, "ry");
		if (rx <= 0 || ry <= 0)
			throw new Error("Vector export found an invalid " + tag + ".");
		return (
			"M" +
			fmt(cx - rx) +
			" " +
			fmt(cy) +
			"a" +
			fmt(rx) +
			" " +
			fmt(ry) +
			" 0 1 0 " +
			fmt(2 * rx) +
			" 0a" +
			fmt(rx) +
			" " +
			fmt(ry) +
			" 0 1 0 -" +
			fmt(2 * rx) +
			" 0"
		);
	}
	if (tag === "line")
		return (
			"M" +
			fmt(parseNumber(element, "x1")) +
			" " +
			fmt(parseNumber(element, "y1")) +
			"L" +
			fmt(parseNumber(element, "x2")) +
			" " +
			fmt(parseNumber(element, "y2"))
		);
	if (tag === "polygon" || tag === "polyline") {
		const nums = (element.getAttribute("points") || "")
			.trim()
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(Number);
		if (nums.length < 4 || nums.length % 2)
			throw new Error("Vector export found invalid " + tag + " points.");
		let d = "M" + fmt(nums[0]) + " " + fmt(nums[1]);
		for (let i = 2; i < nums.length; i += 2)
			d += "L" + fmt(nums[i]) + " " + fmt(nums[i + 1]);
		return d + (tag === "polygon" ? "z" : "");
	}
	throw new Error("Unsupported vector shape: " + tag + ".");
}
function androidColor(value: string | null): string {
	if (!value || value === "none" || value === "transparent") return "#00000000";
	const color = COLOR_NAMES[value.toLowerCase()] || value;
	if (/^#[0-9a-f]{3}$/i.test(color)) {
		const normalized = color.toUpperCase();
		return (
			"#FF" +
			normalized[1] +
			normalized[1] +
			normalized[2] +
			normalized[2] +
			normalized[3] +
			normalized[3]
		);
	}
	if (/^#[0-9a-f]{6}$/i.test(color))
		return "#FF" + color.slice(1).toUpperCase();
	if (/^#[0-9a-f]{8}$/i.test(color))
		return "#" + color.slice(7).toUpperCase() + color.slice(1, 7).toUpperCase();
	if (color === "#00000000") return color;
	throw new Error(
		"Android VectorDrawable cannot convert color: " + value + ".",
	);
}
function androidTransform(value: string): { open: string; close: string } {
	const match = value
		.trim()
		.match(/^(translate|scale|rotate)\(\s*([-+0-9.eE,\s]+)\)$/i);
	if (!match)
		throw new Error(
			"Unsupported SVG transform for Android VectorDrawable: " + value + ".",
		);
	const nums = match[2]
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (nums.some((n) => !Number.isFinite(n)))
		throw new Error("Invalid SVG transform parameters.");
	let attrs = "";
	if (match[1] === "translate")
		attrs =
			'android:translateX="' +
			fmt(nums[0] || 0) +
			'" android:translateY="' +
			fmt(nums[1] || 0) +
			'"';
	if (match[1] === "scale")
		attrs =
			'android:scaleX="' +
			fmt(nums[0]) +
			'" android:scaleY="' +
			fmt(nums.length > 1 ? nums[1] : nums[0]) +
			'"';
	if (match[1] === "rotate")
		attrs =
			'android:rotation="' +
			fmt(nums[0]) +
			'" android:pivotX="' +
			fmt(nums[1] || 0) +
			'" android:pivotY="' +
			fmt(nums[2] || 0) +
			'"';
	return { open: "<group " + attrs + ">", close: "</group>" };
}
export function svgToAndroidVectorDrawable(
	svgMarkup: string,
	options: { monochrome?: boolean; stripBackground?: boolean } = {},
): {
	xml: string;
	backgroundColor: string;
	viewportWidth: number;
	viewportHeight: number;
} {
	const root = parseSvg(svgMarkup).root,
		viewBox = (root.getAttribute("viewBox") || "0 0 512 512")
			.trim()
			.split(/[\s,]+/)
			.map(Number);
	if (
		viewBox.length !== 4 ||
		viewBox.some((n: number) => !Number.isFinite(n)) ||
		viewBox[2] <= 0 ||
		viewBox[3] <= 0
	)
		throw new Error(
			"A valid SVG viewBox is required for Android vector export.",
		);
	const vx = viewBox[0],
		vy = viewBox[1],
		vw = viewBox[2],
		vh = viewBox[3];
	if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001)
		throw new Error(
			"Android VectorDrawable export currently requires a viewBox origin of 0,0.",
		);
	const backgroundRect = Array.from(root.childNodes).find(
		(node) =>
			node.nodeType === 1 &&
			((node as XmlElement).localName || (node as XmlElement).nodeName) ===
				"rect" &&
			Math.abs(parseNumber(node as XmlElement, "x")) < 0.001 &&
			Math.abs(parseNumber(node as XmlElement, "y")) < 0.001 &&
			Math.abs(parseNumber(node as XmlElement, "width") - vw) < 0.01 &&
			Math.abs(parseNumber(node as XmlElement, "height") - vh) < 0.01,
	) as XmlElement | undefined;
	const bgRaw =
			backgroundRect?.getAttribute("fill") ||
			(backgroundRect ? "#000000" : "none"),
		bg = androidColor(bgRaw);
	const renderNode = (
		element: XmlElement,
		inherited: { fill: string; stroke: string; opacity: number },
	): string => {
		const tag = element.localName || element.nodeName;
		if (tag === "title" || tag === "desc" || tag === "defs") return "";
		if (tag === "svg")
			return Array.from(element.childNodes)
				.map((child) =>
					child.nodeType === 1
						? renderNode(child as XmlElement, inherited)
						: "",
				)
				.join("");
		if (tag === "g") {
			const state = {
				fill: element.getAttribute("fill") || inherited.fill,
				stroke: element.getAttribute("stroke") || inherited.stroke,
				opacity: inherited.opacity * parseNumber(element, "opacity", 1),
			};
			const body = Array.from(element.childNodes)
				.map((child) =>
					child.nodeType === 1 ? renderNode(child as XmlElement, state) : "",
				)
				.join("");
			const transform = element.getAttribute("transform");
			if (!transform) return "<group>" + body + "</group>";
			const group = androidTransform(transform);
			return group.open + body + group.close;
		}
		if (
			![
				"path",
				"rect",
				"circle",
				"ellipse",
				"line",
				"polygon",
				"polyline",
			].includes(tag)
		)
			throw new Error(
				"Android VectorDrawable cannot convert <" +
					tag +
					">; remove gradients, masks, filters or embedded content first.",
			);
		if (options.stripBackground && element === backgroundRect) return "";
		const d = shapeToPath(element),
			mono = options.monochrome === true;
		const fillRaw = element.getAttribute("fill") || inherited.fill;
		const strokeRaw = element.getAttribute("stroke") || inherited.stroke;
		const fill = androidColor(
			mono ? (fillRaw === "none" ? "none" : "#ffffff") : fillRaw,
		);
		const stroke = androidColor(
			mono ? (strokeRaw === "none" ? "none" : "#ffffff") : strokeRaw,
		);
		const opacity = inherited.opacity * parseNumber(element, "opacity", 1),
			fillAlpha = Math.max(
				0,
				Math.min(1, opacity * parseNumber(element, "fill-opacity", 1)),
			),
			strokeAlpha = Math.max(
				0,
				Math.min(1, opacity * parseNumber(element, "stroke-opacity", 1)),
			);
		const attrs = [
			'android:pathData="' +
				d.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
				'"',
			'android:fillColor="' + fill + '"',
			'android:fillAlpha="' + fmt(fillAlpha) + '"',
			'android:strokeColor="' + stroke + '"',
			'android:strokeWidth="' + fmt(parseNumber(element, "stroke-width")) + '"',
			'android:strokeAlpha="' + fmt(strokeAlpha) + '"',
		];
		const cap = element.getAttribute("stroke-linecap"),
			join = element.getAttribute("stroke-linejoin");
		if (cap) attrs.push('android:strokeLineCap="' + cap + '"');
		if (join) attrs.push('android:strokeLineJoin="' + join + '"');
		if (element.getAttribute("fill-rule") === "evenodd")
			attrs.push('android:fillType="evenOdd"');
		const path = "<path " + attrs.join(" ") + "/>",
			transform = element.getAttribute("transform");
		if (transform) {
			const group = androidTransform(transform);
			return group.open + path + group.close;
		}
		return path;
	};
	const body = renderNode(root, {
		fill: "#000000",
		stroke: "none",
		opacity: 1,
	});
	const xml =
		'<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="' +
		ANDROID_NS +
		'" android:width="108dp" android:height="108dp" android:viewportWidth="' +
		fmt(vw) +
		'" android:viewportHeight="' +
		fmt(vh) +
		'">' +
		body +
		"</vector>\n";
	return { xml, backgroundColor: bg, viewportWidth: vw, viewportHeight: vh };
}

type ZipFile = { name: string; data: Buffer };
async function renderAssetPng(
	svgMarkup: string,
	size: number,
): Promise<Buffer> {
	if (!Number.isInteger(size) || size < 16 || size > 1024)
		throw new Error("Icon asset size must be from 16 to 1024 pixels.");
	return sharp(Buffer.from(svgMarkup, "utf8"), { density: 144 })
		.resize(size, size, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();
}
function crc32(buffer: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function zipFiles(files: ZipFile[]): Buffer {
	const local: Buffer[] = [],
		central: Buffer[] = [];
	let offset = 0;
	const now = new Date(),
		dosTime =
			(now.getHours() << 11) |
			(now.getMinutes() << 5) |
			Math.floor(now.getSeconds() / 2),
		dosDate =
			((Math.max(1980, now.getFullYear()) - 1980) << 9) |
			((now.getMonth() + 1) << 5) |
			now.getDate();
	for (const file of files) {
		const name = Buffer.from(file.name.replace(/\\/g, "/"), "utf8"),
			packed = deflateRawSync(file.data),
			crc = crc32(file.data),
			header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50, 0);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(0x0800, 6);
		header.writeUInt16LE(8, 8);
		header.writeUInt16LE(dosTime, 10);
		header.writeUInt16LE(dosDate, 12);
		header.writeUInt32LE(crc, 14);
		header.writeUInt32LE(packed.length, 18);
		header.writeUInt32LE(file.data.length, 22);
		header.writeUInt16LE(name.length, 26);
		local.push(header, name, packed);
		const directory = Buffer.alloc(46);
		directory.writeUInt32LE(0x02014b50, 0);
		directory.writeUInt16LE(20, 4);
		directory.writeUInt16LE(20, 6);
		directory.writeUInt16LE(0x0800, 8);
		directory.writeUInt16LE(8, 10);
		directory.writeUInt16LE(dosTime, 12);
		directory.writeUInt16LE(dosDate, 14);
		directory.writeUInt32LE(crc, 16);
		directory.writeUInt32LE(packed.length, 20);
		directory.writeUInt32LE(file.data.length, 24);
		directory.writeUInt16LE(name.length, 28);
		directory.writeUInt32LE(offset, 42);
		central.push(directory, name);
		offset += header.length + name.length + packed.length;
	}
	const centralBuffer = Buffer.concat(central),
		end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralBuffer.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...local, centralBuffer, end]);
}
export async function exportIconBundle(
	svgMarkup: string,
	options: { appName?: string; packageName?: string; pngSizes?: number[] } = {},
): Promise<{
	zipBase64: string;
	fileCount: number;
	bytes: number;
	backgroundColor: string;
	manifest: Record<string, unknown>;
}> {
	const optimized = optimizeSvg(svgMarkup).svgMarkup,
		normal = svgToAndroidVectorDrawable(optimized, { stripBackground: true }),
		mono = svgToAndroidVectorDrawable(optimized, {
			monochrome: true,
			stripBackground: true,
		});
	const appName = (options.appName || "App Icon").trim().slice(0, 80),
		packageName = options.packageName || "com.example.app";
	if (
		!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName) ||
		packageName.length > 160
	)
		throw new Error("packageName must be a valid Android application id.");
	const sizes = [
		...new Set(options.pngSizes || [48, 72, 96, 144, 192, 256, 512, 1024]),
	];
	if (
		!sizes.length ||
		sizes.length > 12 ||
		sizes.some((size) => !Number.isInteger(size) || size < 32 || size > 1024)
	)
		throw new Error("Choose 1 to 12 PNG sizes from 32 to 1024 pixels.");
	const files: ZipFile[] = [],
		addText = (name: string, data: string) =>
			files.push({ name, data: Buffer.from(data, "utf8") });
	const addPng = async (name: string, size: number) => {
		const rendered = await renderAssetPng(optimized, size);
		files.push({ name, data: rendered });
	};
	addText("source/icon.svg", optimized);
	addText(
		"android/app/src/main/res/drawable/ic_launcher_foreground.xml",
		normal.xml,
	);
	addText(
		"android/app/src/main/res/drawable/ic_launcher_monochrome.xml",
		mono.xml,
	);
	addText(
		"android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
		'<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="' +
			ANDROID_NS +
			'">\n<background android:drawable="@color/ic_launcher_background"/>\n<foreground android:drawable="@drawable/ic_launcher_foreground"/>\n<monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n</adaptive-icon>\n',
	);
	addText(
		"android/app/src/main/res/values/ic_launcher_background.xml",
		'<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">' +
			normal.backgroundColor +
			"</color></resources>\n",
	);
	const densities: Array<[string, number]> = [
		["mdpi", 48],
		["hdpi", 72],
		["xhdpi", 96],
		["xxhdpi", 144],
		["xxxhdpi", 192],
	];
	for (const [density, size] of densities) {
		await addPng(
			"android/app/src/main/res/mipmap-" + density + "/ic_launcher.png",
			size,
		);
		await addPng(
			"android/app/src/main/res/mipmap-" + density + "/ic_launcher_round.png",
			size,
		);
	}
	for (const size of sizes) await addPng("png/icon-" + size + ".png", size);
	const iosEntries = [
		{ idiom: "iphone", size: "20x20", scale: "2x", px: 40 },
		{ idiom: "iphone", size: "20x20", scale: "3x", px: 60 },
		{ idiom: "iphone", size: "29x29", scale: "2x", px: 58 },
		{ idiom: "iphone", size: "29x29", scale: "3x", px: 87 },
		{ idiom: "iphone", size: "40x40", scale: "2x", px: 80 },
		{ idiom: "iphone", size: "40x40", scale: "3x", px: 120 },
		{ idiom: "iphone", size: "60x60", scale: "2x", px: 120 },
		{ idiom: "iphone", size: "60x60", scale: "3x", px: 180 },
		{ idiom: "ipad", size: "20x20", scale: "1x", px: 20 },
		{ idiom: "ipad", size: "20x20", scale: "2x", px: 40 },
		{ idiom: "ipad", size: "29x29", scale: "1x", px: 29 },
		{ idiom: "ipad", size: "29x29", scale: "2x", px: 58 },
		{ idiom: "ipad", size: "40x40", scale: "1x", px: 40 },
		{ idiom: "ipad", size: "40x40", scale: "2x", px: 80 },
		{ idiom: "ipad", size: "76x76", scale: "1x", px: 76 },
		{ idiom: "ipad", size: "76x76", scale: "2x", px: 152 },
		{ idiom: "ipad", size: "83.5x83.5", scale: "2x", px: 167 },
		{ idiom: "ios-marketing", size: "1024x1024", scale: "1x", px: 1024 },
	];
	const iosImages = [] as Array<{
		idiom: string;
		size: string;
		scale: string;
		filename: string;
	}>;
	for (const entry of iosEntries) {
		const filename = "AppIcon-" + entry.px + ".png";
		if (
			!files.some(
				(file) =>
					file.name === "ios/Assets.xcassets/AppIcon.appiconset/" + filename,
			)
		)
			await addPng(
				"ios/Assets.xcassets/AppIcon.appiconset/" + filename,
				entry.px,
			);
		iosImages.push({
			idiom: entry.idiom,
			size: entry.size,
			scale: entry.scale,
			filename,
		});
	}
	addText(
		"ios/Assets.xcassets/AppIcon.appiconset/Contents.json",
		JSON.stringify(
			{ images: iosImages, info: { author: "xcode", version: 1 } },
			null,
			2,
		),
	);
	const manifest = {
		appName,
		packageName,
		source: "source/icon.svg",
		exports: [
			"Android adaptive icon and legacy density PNGs",
			"iOS AppIcon.appiconset",
			"PNG size variants",
			"Android foreground and monochrome VectorDrawable",
		],
		limitations: [
			"Android vector export supports paths and basic SVG geometry. Gradients, masks, filters, text and unsupported transforms are rejected rather than silently flattened.",
			"PNG icons preserve the source SVG appearance; review adaptive launcher masks on target devices.",
		],
		fileCount: files.length + 2,
	};
	addText("manifest.json", JSON.stringify(manifest, null, 2));
	addText(
		"README.txt",
		appName +
			" icon bundle\n\nAndroid: copy android/app/src/main/res into your Android app res directory and check your manifest launcher icon reference.\niOS: add ios/Assets.xcassets/AppIcon.appiconset to your Xcode asset catalog.\nSource SVG and additional PNG sizes are included.\n\nGenerated by Flutter Foundry Icon Maker.\n",
	);
	const zip = zipFiles(files);
	if (zip.length > 20 * 1024 * 1024)
		throw new Error(
			"The icon bundle exceeds the 20 MB export limit. Reduce the number of PNG sizes.",
		);
	return {
		zipBase64: zip.toString("base64"),
		fileCount: files.length,
		bytes: zip.length,
		backgroundColor: normal.backgroundColor,
		manifest,
	};
}

export async function vectorizeRasterImage(
	inputBase64: string,
	options: { size?: number; colors?: number } = {},
): Promise<{
	svgMarkup: string;
	pngBase64: string;
	note: string;
	palette: string[];
}> {
	if (
		typeof inputBase64 !== "string" ||
		inputBase64.length < 32 ||
		inputBase64.length > 7000000
	)
		throw new Error("Provide a base64 PNG, JPEG or WebP image under 5 MB.");
	const encoded = inputBase64
			.replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/i, "")
			.replace(/\s/g, ""),
		input = Buffer.from(encoded, "base64");
	if (!input.length || input.length > 5 * 1024 * 1024)
		throw new Error("Image data must be valid base64 and no larger than 5 MB.");
	const size = options.size ?? 48,
		maxColors = options.colors ?? 6;
	if (!Number.isInteger(size) || size < 16 || size > 64)
		throw new Error("Vectorization size must be an integer from 16 to 64.");
	if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 8)
		throw new Error("Choose between 2 and 8 vector colors.");
	const image = sharp(input, {
			failOn: "error",
			limitInputPixels: 10000000,
			animated: false,
		}),
		metadata = await image.metadata();
	if (!["png", "jpeg", "webp"].includes(metadata.format || ""))
		throw new Error("Only PNG, JPEG and WebP imports are supported.");
	if ((metadata.pages || 1) > 1)
		throw new Error("Animated images are not supported for vectorization.");
	const rendered = await image
		.rotate()
		.resize(size, size, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const data = rendered.data,
		info = rendered.info;
	const keyOf = (i: number) =>
		[
			Math.round(data[i] / 32) * 32,
			Math.round(data[i + 1] / 32) * 32,
			Math.round(data[i + 2] / 32) * 32,
		].join(",");
	const alphaOf = (i: number) =>
		Math.min(255, Math.round(data[i + 3] / 32) * 32);
	const counts = new Map<string, number>();
	for (let i = 0; i < data.length; i += 4)
		if (data[i + 3] > 24) counts.set(keyOf(i), (counts.get(keyOf(i)) || 0) + 1);
	const paletteKeys = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, maxColors)
		.map(([key]) => key);
	if (!paletteKeys.length)
		throw new Error("The imported image contains no visible pixels.");
	const palette = paletteKeys.map((key) => {
		const rgb = key.split(",").map(Number);
		return (
			"#" +
			rgb
				.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
				.join("")
		);
	});
	const mapped = new Array<number>(size * size).fill(-1),
		mappedAlpha = new Array<number>(size * size).fill(0);
	for (let y = 0; y < info.height; y++)
		for (let x = 0; x < info.width; x++) {
			const i = (y * info.width + x) * 4;
			if (data[i + 3] <= 24) continue;
			let best = 0,
				bestDistance = Infinity;
			for (let p = 0; p < paletteKeys.length; p++) {
				const c = paletteKeys[p].split(",").map(Number),
					distance =
						(data[i] - c[0]) ** 2 +
						(data[i + 1] - c[1]) ** 2 +
						(data[i + 2] - c[2]) ** 2;
				if (distance < bestDistance) {
					bestDistance = distance;
					best = p;
				}
			}
			const pixelIndex = y * size + x;
			mapped[pixelIndex] = best;
			mappedAlpha[pixelIndex] = alphaOf(i);
		}
	const rects: string[] = [];
	for (let y = 0; y < size; y++) {
		let x = 0;
		while (x < size) {
			const pixelIndex = y * size + x,
				colorIndex = mapped[pixelIndex],
				alpha = mappedAlpha[pixelIndex];
			if (colorIndex < 0) {
				x++;
				continue;
			}
			let end = x + 1;
			while (
				end < size &&
				mapped[y * size + end] === colorIndex &&
				mappedAlpha[y * size + end] === alpha
			)
				end++;
			const opacity = Number((alpha / 255).toFixed(3));
			rects.push(
				'<rect x="' +
					x +
					'" y="' +
					y +
					'" width="' +
					(end - x) +
					'" height="1" fill="' +
					palette[colorIndex] +
					'" fill-opacity="' +
					opacity +
					'"/>',
			);
			x = end;
		}
	}
	const svgMarkup =
		'<svg xmlns="' +
		SVG_NS +
		'" width="512" height="512" viewBox="0 0 ' +
		size +
		" " +
		size +
		'" shape-rendering="crispEdges">' +
		rects.join("") +
		"</svg>";
	const png = await renderIconPng(svgMarkup, 512);
	return {
		svgMarkup,
		pngBase64: png.pngBase64,
		palette,
		note:
			"Posterized raster-to-vector conversion at " +
			size +
			"x" +
			size +
			" with " +
			palette.length +
			" colors. Preserves quantized pixel transparency in SVG fill opacity. Creates editable vector rectangles and works best for flat artwork or pixel-style graphics, not detailed photographs.",
	};
}
