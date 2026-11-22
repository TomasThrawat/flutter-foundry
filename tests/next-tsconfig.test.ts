import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tsconfig = JSON.parse(
	readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8"),
) as {
	compilerOptions?: { jsx?: string };
	include?: string[];
};

test("keeps Next.js TypeScript build settings in the tracked config", () => {
	assert.equal(tsconfig.compilerOptions?.jsx, "react-jsx");
	assert.ok(tsconfig.include?.includes(".next/dev/types/**/*.ts"));
	assert.ok(tsconfig.include?.includes(".next/types/**/*.ts"));
});
