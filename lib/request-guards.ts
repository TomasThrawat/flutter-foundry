type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();
const MAX_RATE_BUCKETS = 2048;

export class RequestBodyTooLargeError extends Error {
	constructor(maxBytes: number) {
		super("Request body exceeds the " + maxBytes + " byte limit.");
		this.name = "RequestBodyTooLargeError";
	}
}

export async function readJsonBodyLimited<T extends Record<string, unknown>>(
	request: Request,
	maxBytes: number,
): Promise<T> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
		throw new Error("maxBytes must be a positive safe integer.");
	const declaredLength = request.headers.get("content-length");
	if (declaredLength !== null) {
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0)
			throw new Error("Invalid Content-Length header.");
		if (parsedLength > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
	}
	if (!request.body) throw new Error("Request body is required.");
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new RequestBodyTooLargeError(maxBytes);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const parsed: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Request body must be a JSON object.");
	return parsed as T;
}

/**
 * Best-effort per-process throttle for warm Node instances. It is not a global
 * limiter and must be paired with provider/gateway limits for public deployments.
 */
export function bestEffortRateLimit(
	request: Request,
	routeKey: string,
	limit: number,
	windowMs: number,
): Response | null {
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		!Number.isSafeInteger(windowMs) ||
		windowMs < 1
	)
		throw new Error("Rate-limit values must be positive integers.");
	const forwarded = request.headers.get("x-forwarded-for");
	const address =
		forwarded?.split(",")[0]?.trim() ||
		request.headers.get("x-real-ip")?.trim();
	if (!address) return null;
	const key = routeKey + ":" + address;
	const now = Date.now();
	let bucket = rateBuckets.get(key);
	if (!bucket || now >= bucket.resetAt) {
		bucket = { count: 0, resetAt: now + windowMs };
		rateBuckets.set(key, bucket);
	}
	if (bucket.count >= limit) {
		const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
		return Response.json(
			{ error: "Too many requests. Try again after the retry interval." },
			{
				status: 429,
				headers: {
					"Retry-After": String(retryAfter),
					"Cache-Control": "no-store",
				},
			},
		);
	}
	bucket.count += 1;
	if (rateBuckets.size > MAX_RATE_BUCKETS) {
		for (const [storedKey, storedBucket] of rateBuckets) {
			if (now >= storedBucket.resetAt || rateBuckets.size > MAX_RATE_BUCKETS) {
				rateBuckets.delete(storedKey);
			}
			if (rateBuckets.size <= MAX_RATE_BUCKETS) break;
		}
	}
	return null;
}
