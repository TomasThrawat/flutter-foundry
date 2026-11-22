import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
const auditWorkflow = readFileSync(
	".github/workflows/audit-engines.yml",
	"utf8",
);

test("package manifests and CI use the same supported Node.js major", () => {
	assert.equal(packageJson.engines?.node, "24.x");
	assert.equal(
		packageLock.packages?.[""]?.engines?.node,
		packageJson.engines.node,
	);
	assert.match(ciWorkflow, /node-version: 24\b/);
	assert.match(releaseWorkflow, /node-version: 24\b/);
});

test("audit workflow authenticates repository metadata lookup with the ephemeral GitHub token", () => {
	assert.match(auditWorkflow, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
	assert.match(auditWorkflow, /Authorization: Bearer \$\{GITHUB_TOKEN\}/);
	assert.match(auditWorkflow, /Only public repositories can be scanned/);
});
