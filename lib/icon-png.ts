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
