import {
	enforceRateLimit,
	RequestBodyTooLargeError,
	readJsonBodyLimited,
} from "@/lib/request-guards";
import { runSvgEdit } from "@/lib/svg-edit";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
	const limited = await enforceRateLimit(request, "svg-edit", 8, 60_000);
	if (limited) return limited;
	const token = process.env.ICON_API_TOKEN;
	if (token && request.headers.get("authorization") !== `Bearer ${token}`)
		return Response.json(
			{ error: "Unauthorized. Configure the ICON_API_TOKEN bearer token." },
			{ status: 401 },
		);
	try {
		const body = await readJsonBodyLimited<{ svg?: unknown }>(
			request,
			300 * 1024,
		);
		if (typeof body.svg !== "string")
			return Response.json(
				{ error: "Provide an SVG string in the svg field." },
				{ status: 400 },
			);
		return Response.json(await runSvgEdit(body.svg));
	} catch (error) {
		return Response.json(
			{
				error:
					error instanceof Error
						? error.message
						: "SVG-Edit processing failed.",
			},
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 422 },
		);
	}
}
