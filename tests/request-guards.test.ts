import assert from "node:assert/strict";
import test from "node:test";
import {
	bestEffortRateLimit,
	readJsonBodyLimited,
	RequestBodyTooLargeError,
} from "../lib/request-guards";

test("reads a JSON object within the configured streaming byte limit", async () => {
	const request = new Request("https://example.test/api", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ operation: "generate", prompt: "send icon" }),
	});
	const body = await readJsonBodyLimited<Record<string, unknown>>(request, 1024);
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
	const makeRequest = () => new Request("https://example.test/api", {
		headers: { "x-forwarded-for": "198.51.100.27, 10.0.0.1" },
	});
	assert.equal(bestEffortRateLimit(makeRequest(), "unit-test-guard", 2, 60_000), null);
	assert.equal(bestEffortRateLimit(makeRequest(), "unit-test-guard", 2, 60_000), null);
	const limited = bestEffortRateLimit(makeRequest(), "unit-test-guard", 2, 60_000);
	assert.equal(limited?.status, 429);
	assert.ok(limited?.headers.get("retry-after"));
});

test("does not apply a shared anonymous bucket when no proxy address is available", () => {
	const request = new Request("https://example.test/api");
	assert.equal(bestEffortRateLimit(request, "unknown-address", 1, 60_000), null);
});
