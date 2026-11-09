import assert from "node:assert/strict";
import test from "node:test";
import {
	bestEffortRateLimit,
	enforceRateLimit,
	RequestBodyTooLargeError,
	readJsonBodyLimited,
} from "../lib/request-guards";

test("reads a JSON object within the configured streaming byte limit", async () => {
	const request = new Request("https://example.test/api", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ operation: "generate", prompt: "send icon" }),
	});
	const body = await readJsonBodyLimited<Record<string, unknown>>(
		request,
		1024,
	);
	assert.equal(body.operation, "generate");
});

test("rejects oversized bodies even when Content-Length is absent", async () => {
	const request = new Request("https://example.test/api", {
		method: "POST",
		body: JSON.stringify({ payload: "x".repeat(500) }),
	});
	await assert.rejects(
		() => readJsonBodyLimited<Record<string, unknown>>(request, 64),
		RequestBodyTooLargeError,
	);
});

test("best-effort rate limiting returns 429 after the configured request count", () => {
	const makeRequest = () =>
		new Request("https://example.test/api", {
			headers: { "x-forwarded-for": "198.51.100.27, 10.0.0.1" },
		});
	assert.equal(
		bestEffortRateLimit(makeRequest(), "unit-test-guard", 2, 60_000),
		null,
	);
	assert.equal(
		bestEffortRateLimit(makeRequest(), "unit-test-guard", 2, 60_000),
		null,
	);
	const limited = bestEffortRateLimit(
		makeRequest(),
		"unit-test-guard",
		2,
		60_000,
	);
	assert.equal(limited?.status, 429);
	assert.ok(limited?.headers.get("retry-after"));
});

test("does not apply a shared anonymous bucket when no proxy address is available", () => {
	const request = new Request("https://example.test/api");
	assert.equal(
		bestEffortRateLimit(request, "unknown-address", 1, 60_000),
		null,
	);
});

test("uses the optional Upstash global limiter and returns 429 above the shared limit", async () => {
	const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
	const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
	const originalFetch = globalThis.fetch;
	process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
	process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ result: [3, 42] }), {
			status: 200,
		})) as typeof fetch;
	try {
		const limited = await enforceRateLimit(
			new Request("https://example.test/mcp", {
				headers: { "x-real-ip": "198.51.100.42" },
			}),
			"mcp",
			2,
			60_000,
		);
		assert.equal(limited?.status, 429);
		assert.equal(limited?.headers.get("retry-after"), "42");
	} finally {
		globalThis.fetch = originalFetch;
		if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
		else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
		if (oldToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
		else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
	}
});

test("fails closed when only one Upstash credential is configured", async () => {
	const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
	const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
	delete process.env.UPSTASH_REDIS_REST_URL;
	process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
	try {
		const limited = await enforceRateLimit(
			new Request("https://example.test/mcp", {
				headers: { "x-real-ip": "198.51.100.43" },
			}),
			"mcp",
			10,
			60_000,
		);
		assert.equal(limited?.status, 503);
	} finally {
		if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
		else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
		if (oldToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
		else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
	}
});

test("rejects non-Upstash or non-HTTPS Redis endpoints", async () => {
	const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
	const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
	process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:8080";
	process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
	try {
		const limited = await enforceRateLimit(
			new Request("https://example.test/mcp", {
				headers: { "x-real-ip": "198.51.100.44" },
			}),
			"mcp",
			10,
			60_000,
		);
		assert.equal(limited?.status, 503);
	} finally {
		if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
		else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
		if (oldToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
		else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
	}
});

test("fails closed when the global limiter cannot identify a client IP", async () => {
	const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
	const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
	process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
	process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
	try {
		const limited = await enforceRateLimit(
			new Request("https://example.test/mcp"),
			"mcp",
			10,
			60_000,
		);
		assert.equal(limited?.status, 503);
	} finally {
		if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
		else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
		if (oldToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
		else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
	}
});
