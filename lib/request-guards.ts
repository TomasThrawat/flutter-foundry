import { createHash } from "node:crypto";

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

/**
 * Optional Upstash REST counter for cross-instance throttling.
 * Without Redis configuration, retain the bounded per-process fallback.
 * A configured Redis service failing is treated as unavailable, not unlimited.
 */
export async function enforceRateLimit(
	request: Request,
	routeKey: string,
	limit: number,
	windowMs: number,
): Promise<Response | null> {
	const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
	const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
	if (!redisUrl && !redisToken)
		return bestEffortRateLimit(request, routeKey, limit, windowMs);
	if (!redisUrl || !redisToken)
		return Response.json(
			{
				error:
					"Global rate limiting is misconfigured. Set both Upstash REST environment variables.",
			},
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		!Number.isSafeInteger(windowMs) ||
		windowMs < 1 ||
		!/^[a-z0-9._-]{1,64}$/i.test(routeKey)
	)
		throw new Error("Invalid rate-limit configuration.");

	const address =
		request.headers.get("x-real-ip")?.trim() ||
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	if (!address)
		return Response.json(
			{ error: "A client IP address is required for global request limiting." },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);

	let endpoint: URL;
	try {
		endpoint = new URL(redisUrl);
	} catch {
		return Response.json(
			{
				error: "UPSTASH_REDIS_REST_URL must be a valid HTTPS Upstash REST URL.",
			},
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
	if (
		endpoint.protocol !== "https:" ||
		!endpoint.hostname.endsWith(".upstash.io") ||
		endpoint.username ||
		endpoint.password
	)
		return Response.json(
			{ error: "UPSTASH_REDIS_REST_URL must use an HTTPS *.upstash.io host." },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);

	const clientHash = createHash("sha256").update(address).digest("hex");
	const key = "flutter-foundry:rate:" + routeKey + ":" + clientHash;
	const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
	const script =
		"local n=redis.call('INCR',KEYS[1]); " +
		"if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; " +
		"return {n,redis.call('TTL',KEYS[1])}";

	try {
		const response = await fetch(endpoint.toString(), {
			method: "POST",
			headers: {
				Authorization: "Bearer " + redisToken,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(["EVAL", script, "1", key, String(windowSeconds)]),
			signal: AbortSignal.timeout(3000),
			cache: "no-store",
		});
		if (!response.ok)
			throw new Error("Upstash returned HTTP " + response.status + ".");
		const payload: unknown = await response.json();
		if (
			!payload ||
			typeof payload !== "object" ||
			!("result" in payload) ||
			!Array.isArray(payload.result) ||
			typeof payload.result[0] !== "number" ||
			typeof payload.result[1] !== "number"
		)
			throw new Error("Upstash returned an invalid rate-limit response.");
		const [count, ttl] = payload.result as [number, number];
		if (count <= limit) return null;
		return Response.json(
			{ error: "Too many requests. Try again after the retry interval." },
			{
				status: 429,
				headers: {
					"Retry-After": String(Math.max(1, ttl)),
					"Cache-Control": "no-store",
				},
			},
		);
	} catch {
		return Response.json(
			{
				error:
					"The configured global rate-limit service is temporarily unavailable.",
			},
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
