import sharp from "sharp";

export type IconPngResult = {
  pngBase64: string;
  width: number;
  height: number;
  elapsedMs: number;
};

/** Rasterize a generated SVG icon without starting a browser process. */
export async function renderIconPng(svgMarkup: string, size: number): Promise<IconPngResult> {
  if (!Number.isInteger(size) || size < 128 || size > 1024) {
    throw new Error("Icon PNG size must be an integer from 128 to 1024 pixels.");
  }
  if (!svgMarkup.trim() || !/^\s*<svg\b/i.test(svgMarkup)) {
    throw new Error("A valid SVG icon is required for PNG rendering.");
  }

  const started = Date.now();
  const { data, info } = await sharp(Buffer.from(svgMarkup, "utf8"), { density: 144 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== size || info.height !== size) {
    throw new Error(`PNG renderer returned ${info.width}x${info.height}; expected ${size}x${size}.`);
  }
  return { pngBase64: data.toString("base64"), width: info.width, height: info.height, elapsedMs: Date.now() - started };
}


const MAX_CUSTOM_SVG_LENGTH = 250_000;

/**
 * Reject active SVG features and external resources before rasterizing a
 * caller/model-authored icon. Local fragment references (url(#gradient)) are
 * allowed; this renderer is intended for self-contained vector artwork.
 */
export function validateCustomIconSvg(svgMarkup: string): string {
  if (typeof svgMarkup !== "string") {
    throw new Error("SVG markup must be a string.");
  }
  const svg = svgMarkup.trim();
  if (!svg || svg.length > MAX_CUSTOM_SVG_LENGTH) {
    throw new Error("SVG markup must be non-empty and at most 250000 characters.");
  }
  if (!/^<svg\b/i.test(svg) || !/<\/svg\s*>\s*$/i.test(svg)) {
    throw new Error("A complete SVG root element is required.");
  }

  const prohibited: Array<[RegExp, string]> = [
    [/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i, "DTD, entity declarations and external stylesheets are not allowed."],
    [/<\s*(?:script|foreignObject|iframe|object|embed|image|audio|video|animate|animateTransform|animateMotion|set|feImage)\b/i, "Active content, embedded images and SVG animation are not allowed."],
    [/\son[a-z0-9:_-]+\s*=/i, "SVG event-handler attributes are not allowed."],
    [/\b(?:href|xlink:href)\s*=\s*["']\s*(?!#)[^"']*["']/i, "Only local fragment references are allowed in SVG href attributes."],
    [/url\(\s*["']?(?!#)[^)]+\)/i, "External URL references are not allowed in SVG styles or paint servers."],
    [/(?:javascript\s*:|vbscript\s*:|@import\b)/i, "Script URLs and imported CSS are not allowed."]
  ];
  for (const [pattern, message] of prohibited) {
    if (pattern.test(svg)) throw new Error(message);
  }

  const svgRoots = svg.match(/<svg\b/gi) || [];
  if (svgRoots.length !== 1) {
    throw new Error("SVG markup must contain exactly one root SVG element.");
  }
  return svg;
}
