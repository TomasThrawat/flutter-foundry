import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright-core";
import { resolveSvgEditorUrl, runSvgEdit, sanitizeSvgInput } from "../lib/svg-edit";

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = (content = "", attributes = "") => `<svg xmlns="${SVG_NS}" ${attributes}>${content}</svg>`;

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function createBrowserStub(outputSvg: string, options: { failOnGoto?: boolean; useSvgRootFallback?: boolean } = {}) {
  let closed = false;
  let loadedInput = "";
  const editor = {
    isReady: true,
    loadSvgString: (input: string) => { loadedInput = input; },
    svgCanvas: options.useSvgRootFallback
      ? { svgroot: { outerHTML: outputSvg } }
      : { getSvgString: () => outputSvg }
  };
  const page = {
    setDefaultTimeout: () => undefined,
    goto: async () => {
      if (options.failOnGoto) throw new Error("navigation failed");
    },
    waitForFunction: async () => undefined,
    evaluate: async (callback: (input: string) => string, input: string) => {
      const previousWindow = Reflect.get(globalThis, "window");
      Reflect.set(globalThis, "window", { svgEditor: editor });
      try {
        return callback(input);
      } finally {
        if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
        else Reflect.set(globalThis, "window", previousWindow);
      }
    },
    setContent: async () => undefined,
    locator: () => ({
      first: () => ({
        waitFor: async () => undefined,
        screenshot: async () => pngSignature
      })
    })
  };
  const browser = {
    newPage: async () => page,
    close: async () => { closed = true; }
  };
  return {
    browser: browser as unknown as Browser,
    wasClosed: () => closed,
    loadedInput: () => loadedInput
  };
}

test("sanitizer retains vector geometry and fills missing root defaults", () => {
  const clean = sanitizeSvgInput('<svg><circle cx="20" cy="20" r="10" fill="#fff"/></svg>');
  assert.match(clean, /<circle/);
  assert.match(clean, new RegExp(`xmlns="${SVG_NS}"`));
  assert.match(clean, /viewBox="0 0 512 512"/);
  assert.match(clean, /width="512"/);
  assert.match(clean, /height="512"/);
});

test("sanitizer rejects empty and oversized input", () => {
  assert.throws(() => sanitizeSvgInput("  \n  "), /required/);
  assert.throws(() => sanitizeSvgInput("  \n  "), /required/);
  const oversized = `<svg>${"é".repeat(125_001)}</svg>`;
  assert.ok(Buffer.byteLength(oversized, "utf8") > 250_000);
  assert.throws(() => sanitizeSvgInput(oversized), /250 KB limit/);
});

test("sanitizer rejects malformed XML and a non-SVG root", () => {
  assert.throws(() => sanitizeSvgInput("<svg><path></svg>"), /Invalid SVG XML/);
  assert.throws(() => sanitizeSvgInput("<html><body/></html>"), /root element must be <svg>/);
});

test("sanitizer rejects declarations and unsupported nested elements", () => {
  assert.throws(() => sanitizeSvgInput('<!DOCTYPE svg [<!ENTITY x "hi">]><svg/>'), /DOCTYPE/);
  assert.throws(() => sanitizeSvgInput(svg("<script>alert(1)</script>")), /Unsupported SVG element/);
  assert.throws(() => sanitizeSvgInput(svg('<foreignObject><div/></foreignObject>')), /Unsupported SVG element/);
  assert.throws(() => sanitizeSvgInput(svg('<image href="https://example.com/icon.png"/>')), /Unsupported SVG element/);
});

test("sanitizer strips event handlers, styles, and unknown attributes recursively", () => {
  const clean = sanitizeSvgInput(
    `<svg xmlns="${SVG_NS}" onload="run()" style="color:red" data-root="x"><g data-group="x"><circle onclick="run()" custom="x" r="10"/></g></svg>`
  );
  assert.doesNotMatch(clean, /onload|onclick|style=|data-root|data-group|custom=/);
  assert.match(clean, /<circle/);
});

test("sanitizer rejects active content and unsafe URL references", () => {
  for (const value of ["javascript:alert(1)", "vbscript:msgbox(1)", "data:text/html,<script>", "@import url(https://example.com/x.css)"]) {
    assert.throws(() => sanitizeSvgInput(svg("", `fill="${value}"`)), /Unsafe value/);
  }
  assert.throws(() => sanitizeSvgInput(svg("", 'fill="url(https://example.com/gradient.svg#paint)"')), /External or unsupported URL/);
  assert.throws(() => sanitizeSvgInput(svg("", 'fill="url(//example.com/paint)"')), /External or unsupported URL/);
});

test("sanitizer preserves safe local paint-server references", () => {
  const clean = sanitizeSvgInput(
    svg('<defs><linearGradient id="brand"><stop offset="0" stop-color="#fff"/></linearGradient></defs><circle r="20" fill="url(#brand)"/>')
  );
  assert.match(clean, /linearGradient/);
  assert.match(clean, /fill="url\(#brand\)"/);
});

test("editor URL resolver defaults to official SVG-Edit and accepts the approved hosts", () => {
  assert.equal(resolveSvgEditorUrl(), "https://svgedit.netlify.app/index.html");
  assert.equal(resolveSvgEditorUrl("  "), "https://svgedit.netlify.app/index.html");
  assert.equal(resolveSvgEditorUrl("https://svgedit.netlify.app/custom.html"), "https://svgedit.netlify.app/custom.html");
  assert.equal(resolveSvgEditorUrl("https://unpkg.com/svgedit@latest/dist/editor.html"), "https://unpkg.com/svgedit@latest/dist/editor.html");
});

test("editor URL resolver rejects invalid, insecure, untrusted, or credentialed URLs", () => {
  assert.throws(() => resolveSvgEditorUrl("not a URL"), /valid URL/);
  assert.throws(() => resolveSvgEditorUrl("http://svgedit.netlify.app/index.html"), /HTTPS/);
  assert.throws(() => resolveSvgEditorUrl("https://example.com/editor.html"), /official SVG-Edit/);
  assert.throws(() => resolveSvgEditorUrl("https://user:pass@svgedit.netlify.app/index.html"), /credentials/);
  assert.throws(() => resolveSvgEditorUrl("https://svgedit.netlify.app:8443/index.html"), /custom port/);
});

test("runSvgEdit loads, sanitizes, serializes, previews, and closes its browser", async () => {
  const outputSvg = svg('<circle cx="20" cy="20" r="10" fill="#fff"/>');
  const stub = createBrowserStub(outputSvg);
  const result = await runSvgEdit(outputSvg, async () => stub.browser);
  assert.match(result.svg, /<circle/);
  assert.match(stub.loadedInput(), /<svg/);
  assert.deepEqual(Buffer.from(result.previewPngBase64, "base64"), pngSignature);
  assert.equal(result.editorUrl, "https://svgedit.netlify.app/index.html");
  assert.ok(result.elapsedMs >= 0);
  assert.equal(stub.wasClosed(), true);
});

test("runSvgEdit supports the SVG-root serialization fallback", async () => {
  const outputSvg = svg('<rect width="20" height="20"/>');
  const stub = createBrowserStub(outputSvg, { useSvgRootFallback: true });
  const result = await runSvgEdit(outputSvg, async () => stub.browser);
  assert.match(result.svg, /<rect/);
  assert.equal(stub.wasClosed(), true);
});

test("runSvgEdit closes the browser when navigation or output sanitization fails", async () => {
  const navigationStub = createBrowserStub(svg(), { failOnGoto: true });
  await assert.rejects(() => runSvgEdit(svg(), async () => navigationStub.browser), /navigation failed/);
  assert.equal(navigationStub.wasClosed(), true);

  const unsafeOutputStub = createBrowserStub(svg("<script>alert(1)</script>"));
  await assert.rejects(() => runSvgEdit(svg(), async () => unsafeOutputStub.browser), /Unsupported SVG element/);
  assert.equal(unsafeOutputStub.wasClosed(), true);
});
