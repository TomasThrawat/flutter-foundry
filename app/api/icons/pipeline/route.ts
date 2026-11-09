import { generateIconFromPrompt, type IconStyle } from "@/lib/icon-generator";
import {
	analyzeIconQuality,
	editSvgElements,
	exportIconBundle,
	generateIconVariants,
	optimizeSvg,
	prepareEditableSvg,
	type SvgElementOperation,
	vectorizeRasterImage,
} from "@/lib/icon-pipeline";
import { renderIconPng } from "@/lib/icon-png";
import {
	enforceRateLimit,
	RequestBodyTooLargeError,
	readJsonBodyLimited,
} from "@/lib/request-guards";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(message: string, status = 400) {
	return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
	const limited = await enforceRateLimit(request, "icon-pipeline", 30, 60_000);
	if (limited) return limited;
	try {
		const body = await readJsonBodyLimited<Record<string, unknown>>(
			request,
			9 * 1024 * 1024,
		);
		const operation = body.operation;
		if (typeof operation !== "string") return fail("Provide an operation.");
		if (operation === "generate") {
			if (typeof body.prompt !== "string")
				return fail("Provide an icon prompt.");
			const allowedStyles = [
				"auto",
				"minimal",
				"geometric",
				"rounded",
				"outline",
				"pixel",
				"abstract",
			];
			if (
				body.style !== undefined &&
				(typeof body.style !== "string" || !allowedStyles.includes(body.style))
			)
				return fail("Unsupported icon style.");
			const generated = generateIconFromPrompt({
				prompt: body.prompt,
				style:
					typeof body.style === "string"
						? (body.style as IconStyle)
						: undefined,
				size: typeof body.size === "number" ? body.size : undefined,
				backgroundColor:
					typeof body.backgroundColor === "string"
						? body.backgroundColor
						: undefined,
				foregroundColor:
					typeof body.foregroundColor === "string"
						? body.foregroundColor
						: undefined,
				accentColor:
					typeof body.accentColor === "string" ? body.accentColor : undefined,
			});
			const [png, quality] = await Promise.all([
				renderIconPng(generated.svgMarkup, generated.size),
				analyzeIconQuality(generated.svgMarkup),
			]);
			const editable = prepareEditableSvg(generated.svgMarkup);
			return Response.json({
				...generated,
				svgMarkup: editable.svgMarkup,
				pngBase64: png.pngBase64,
				quality,
				elements: editable.elements,
			});
		}
		if (operation === "variants") {
			if (typeof body.prompt !== "string")
				return fail("Provide an icon prompt.");
			const availableStyles = [
				"minimal",
				"geometric",
				"rounded",
				"outline",
				"pixel",
				"abstract",
			];
			if (
				body.styles !== undefined &&
				(!Array.isArray(body.styles) ||
					body.styles.some(
						(value) =>
							typeof value !== "string" || !availableStyles.includes(value),
					))
			)
				return fail("Unsupported variant style.");
			const variants = generateIconVariants({
				prompt: body.prompt,
				size: typeof body.size === "number" ? body.size : 512,
				backgroundColor:
					typeof body.backgroundColor === "string"
						? body.backgroundColor
						: undefined,
				foregroundColor:
					typeof body.foregroundColor === "string"
						? body.foregroundColor
						: undefined,
				accentColor:
					typeof body.accentColor === "string" ? body.accentColor : undefined,
				styles: Array.isArray(body.styles)
					? (body.styles as never[])
					: undefined,
			});
			const results = await Promise.all(
				variants.map(async (variant) => {
					const editable = prepareEditableSvg(variant.svgMarkup);
					const png = await renderIconPng(
						editable.svgMarkup,
						typeof body.size === "number" ? body.size : 512,
					);
					const quality = await analyzeIconQuality(editable.svgMarkup);
					return {
						...variant,
						svgMarkup: editable.svgMarkup,
						pngBase64: png.pngBase64,
						quality,
					};
				}),
			);
			return Response.json({ variants: results });
		}
		if (operation === "edit") {
			if (typeof body.svgMarkup !== "string" || !Array.isArray(body.operations))
				return fail("Provide svgMarkup and an operations array.");
			const edited = editSvgElements(
				body.svgMarkup,
				body.operations as SvgElementOperation[],
			);
			const [png, quality] = await Promise.all([
				renderIconPng(edited.svgMarkup, 512),
				analyzeIconQuality(edited.svgMarkup),
			]);
			return Response.json({ ...edited, pngBase64: png.pngBase64, quality });
		}
		if (operation === "analyze") {
			if (typeof body.svgMarkup !== "string") return fail("Provide svgMarkup.");
			const optimized = optimizeSvg(body.svgMarkup);
			const [quality, preview] = await Promise.all([
				analyzeIconQuality(optimized.svgMarkup),
				renderIconPng(optimized.svgMarkup, 512),
			]);
			const editable = prepareEditableSvg(optimized.svgMarkup);
			return Response.json({
				...optimized,
				quality,
				elements: editable.elements,
				pngBase64: preview.pngBase64,
			});
		}
		if (operation === "export") {
			if (typeof body.svgMarkup !== "string") return fail("Provide svgMarkup.");
			const bundle = await exportIconBundle(body.svgMarkup, {
				appName: typeof body.appName === "string" ? body.appName : undefined,
				packageName:
					typeof body.packageName === "string" ? body.packageName : undefined,
				pngSizes: Array.isArray(body.pngSizes)
					? (body.pngSizes as number[])
					: undefined,
				iosBackgroundColor:
					typeof body.iosBackgroundColor === "string"
						? body.iosBackgroundColor
						: undefined,
			});
			const archive = new Uint8Array(Buffer.from(bundle.zipBase64, "base64"));
			return new Response(archive, {
				headers: {
					"content-type": "application/zip",
					"content-disposition": 'attachment; filename="flutter-foundry-icon-pack.zip"',
					"x-icon-file-count": String(bundle.fileCount),
					"x-icon-bytes": String(bundle.bytes),
					"cache-control": "no-store",
				},
			});
		}
		if (operation === "vectorize") {
			if (typeof body.imageBase64 !== "string")
				return fail("Provide imageBase64.");
			const result = await vectorizeRasterImage(body.imageBase64, {
				size: typeof body.size === "number" ? body.size : undefined,
				colors: typeof body.colors === "number" ? body.colors : undefined,
			});
			const editable = prepareEditableSvg(result.svgMarkup);
			return Response.json({
				...result,
				svgMarkup: editable.svgMarkup,
				elements: editable.elements,
				quality: await analyzeIconQuality(editable.svgMarkup),
			});
		}
		return fail("Unknown icon pipeline operation.");
	} catch (error) {
		return fail(
			error instanceof Error
				? error.message
				: "Icon pipeline operation failed.",
			error instanceof RequestBodyTooLargeError ? 413 : 422,
		);
	}
}
