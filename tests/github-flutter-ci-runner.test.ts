import assert from "node:assert/strict";
import test from "node:test";
import { isSafeFlutterChannel } from "../lib/github-flutter-ci-runner";
import { isSafeGitHubRef, isSafeGitHubRepository } from "../lib/github-audit-runner";

test("accepts public repository identifiers and valid Flutter refs", () => {
	assert.equal(isSafeGitHubRepository("TomasThrawat/flutter-foundry"), true);
	assert.equal(isSafeGitHubRepository("flutter/samples"), true);
	assert.equal(isSafeGitHubRef("main"), true);
	assert.equal(isSafeGitHubRef("release/1.2.0"), true);
	assert.equal(isSafeGitHubRef("0123456789abcdef0123456789abcdef01234567"), true);
});

test("rejects malformed repository identifiers and unsafe refs", () => {
	for (const value of ["", "owner", "owner/repo/path", "../owner/repo", "owner/../repo", "owner/repo?x=1"]) {
		assert.equal(isSafeGitHubRepository(value), false, value);
	}
	for (const value of ["", "../main", "main..evil", "refs//heads/main", "-option", "main/", "refs/heads/main.lock"]) {
		assert.equal(isSafeGitHubRef(value), false, value);
	}
});

test("only accepts supported Flutter release channels", () => {
	assert.equal(isSafeFlutterChannel("stable"), true);
	assert.equal(isSafeFlutterChannel("beta"), true);
	assert.equal(isSafeFlutterChannel("main"), true);
	assert.equal(isSafeFlutterChannel("master"), false);
	assert.equal(isSafeFlutterChannel("latest"), false);
});
