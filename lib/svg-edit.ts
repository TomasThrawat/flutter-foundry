import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import chromiumBinary from "@sparticuz/chromium";
import { chromium as playwrightChromium, type Browser } from "playwright-core";

const DEFAULT_EDITOR_URL = "https://svgedit.netlify.app/index.html";
const MAX_SVG_BYTES = 250_000;
const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "title", "desc", "path", "rect", "circle", "ellipse",
  "line", "polyline", "polygon", "text", "tspan", "linearGradient", "radialGradient",
  "stop", "clipPath", "mask", "filter", "feGaussianBlur", "feOffset", "feBlend",
  "feColorMatrix", "feMerge", "feMergeNode"
]);
const ALLOWED_ATTRIBUTES = new Set([
  "xmlns", "id", "width", "height", "viewBox", "version", "x", "y", "cx", "cy", "r",
  "rx", "ry", "x1", "y1", "x2", "y2", "d", "points", "fill", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-miterlimit", "fill-rule",
  "clip-rule", "transform", "opacity", "fill-opacity", "stroke-opacity", "font-family",
  "font-size", "font-weight", "text-anchor", "dominant-baseline", "letter-spacing", "dx",
  "dy", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
  "spreadMethod", "clip-path", "mask", "filter", "filterUnits", "primitiveUnits",
  "stdDeviation", "in", "in2", "result", "type", "values", "operator", "flood-color",
  "flood-opacity", "surfaceScale", "lighting-color", "shape-rendering", "vector-effect"
]);

export type SvgEditResult = {
  svg: string;
  previewPngBase64: string;
  editorUrl: string;
  elapsedMs: number;
};

export function sanitizeSvgInput(svg: string): string {
  if (!svg.trim()) throw new Error("SVG markup is required.");
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) throw new Error("SVG input exceeds the 250 KB limit.");
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) throw new Error("DOCTYPE and entity declarations are not accepted.");

  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === "error" || level === "fatalError") errors.push(message);
    }
  });
  const doc = parser.parseFromString(svg, "image/svg+xml");
  if (errors.length) throw new Error("Invalid SVG XML: " + errors[0]);
  const root = doc.documentElement;
  if (!root || (root.localName || root.nodeName).toLowerCase() !== "svg") {
    throw new Error("The root element must be <svg>.");
  }

  type SvgElement = NonNullable<typeof root>;
  const visit = (element: SvgElement) => {
    const tag = element.localName || element.nodeName;
    if (!ALLOWED_ELEMENTS.has(tag)) throw new Error("Unsupported SVG element: <" + tag + ">.");
    const remove: string[] = [];
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i);
      if (!attr) continue;
      const name = attr.name;
      const lower = name.toLowerCase();
      const value = attr.value.trim();
      if (!ALLOWED_ATTRIBUTES.has(name) || lower.startsWith("on") || lower === "style") {
        remove.push(name);
        continue;
      }
      const lowerValue = value.toLowerCase();
      if (lowerValue.includes("javascript:") || lowerValue.includes("vbscript:") ||
          lowerValue.includes("data:text/html") || lowerValue.includes("@import")) {
        throw new Error('Unsafe value in SVG attribute "' + name + '".');
      }
      if (/url\s*\(/i.test(value) && !/url\(\s*["']?#[-\w:.]+["']?\s*\)/i.test(value)) {
        throw new Error('External or unsupported URL reference in SVG attribute "' + name + '".');
      }
    }
    for (const name of remove) element.removeAttribute(name);
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes.item(i);
      if (child && child.nodeType === 1) visit(child as SvgElement);
    }
  };

  visit(root);
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", "0 0 512 512");
  if (!root.getAttribute("width")) root.setAttribute("width", "512");
  if (!root.getAttribute("height")) root.setAttribute("height", "512");
  const clean = new XMLSerializer().serializeToString(root);
  if (/script|foreignObject|javascript:/i.test(clean)) throw new Error("Unsafe SVG content remained after sanitization.");
  return clean;
}

function allowedEditorUrl(): string {
  const url = process.env.SVG_EDIT_URL?.trim() || DEFAULT_EDITOR_URL;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("SVG_EDIT_URL must use HTTPS.");
  if (!new Set(["svgedit.netlify.app", "unpkg.com"]).has(parsed.hostname)) {
    throw new Error("SVG_EDIT_URL must point to the official SVG-Edit Netlify app or unpkg distribution.");
  }
  return url;
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    return playwrightChromium.launch({
      args: chromiumBinary.args,
      executablePath: await chromiumBinary.executablePath(),
      headless: true
    });
  }
  return playwrightChromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}

export async function runSvgEdit(svgInput: string): Promise<SvgEditResult> {
  const svg = sanitizeSvgInput(svgInput);
  const editorUrl = allowedEditorUrl();
  const started = Date.now();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(30_000);
    await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 40_000 });
    await page.waitForFunction(() => {
      const editor = (window as unknown as { svgEditor?: { isReady?: boolean; svgCanvas?: unknown } }).svgEditor;
      return Boolean(editor?.isReady && editor?.svgCanvas);
    }, undefined, { timeout: 40_000 });
    const outputSvg = await page.evaluate((source) => {
      const editor = (window as unknown as {
        svgEditor?: {
          loadSvgString?: (input: string, options?: { noAlert?: boolean }) => void;
          svgCanvas?: { getSvgString?: () => string; svgroot?: SVGSVGElement };
        }
      }).svgEditor;
      if (!editor?.loadSvgString || !editor.svgCanvas) throw new Error("SVG-Edit loaded but its canvas API was unavailable.");
      editor.loadSvgString(source, { noAlert: true });
      const canvas = editor.svgCanvas;
      if (typeof canvas.getSvgString === "function") return canvas.getSvgString();
      if (canvas.svgroot) return canvas.svgroot.outerHTML;
      throw new Error("SVG-Edit did not expose an SVG serialization method.");
    }, svg);
    const cleanOutput = sanitizeSvgInput(outputSvg);
    await page.waitForTimeout(250);
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    return { svg: cleanOutput, previewPngBase64: screenshot.toString("base64"), editorUrl, elapsedMs: Date.now() - started };
  } finally {
    await browser.close();
  }
}