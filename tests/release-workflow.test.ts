import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const releaseWorkflow = readFileSync(
	new URL("../.github/workflows/release.yml", import.meta.url),
	"utf8",
);

test("release workflow does not share package-manager caches between tagged runs", () => {
	const setupNodeStep = releaseWorkflow.match(
		/- name: Set up Node\.js[\s\S]*?(?=\n[ ]{6}- name:|\n\n)/,
	)?.[0];

	assert.ok(setupNodeStep, "missing Node.js setup step");
	assert.match(setupNodeStep, /package-manager-cache:\s*false/);
	assert.doesNotMatch(setupNodeStep, /^\s*cache:\s*\S+/m);
});
