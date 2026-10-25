import assert from "node:assert/strict";
import { test } from "node:test";
import { GITHUB_AUDIT_ENGINES, isSafeGitHubRef, isSafeGitHubRepository } from "../lib/github-audit-runner";

test("accepts owner/repository targets", () => {
  assert.equal(isSafeGitHubRepository("TomasThrawat/flutter-foundry"), true);
  assert.equal(isSafeGitHubRepository("google/osv-scanner"), true);
});
test("rejects malformed or path-like repository targets", () => {
  for (const value of ["", "owner", "owner/repo/path", "../owner/repo", "owner/..", "owner/repo?x=1", "owner repo/name"]) {
    assert.equal(isSafeGitHubRepository(value), false, value);
  }
});
test("accepts ordinary refs", () => {
  assert.equal(isSafeGitHubRef("main"), true);
  assert.equal(isSafeGitHubRef("release/1.2.0"), true);
  assert.equal(isSafeGitHubRef("abc1234"), true);
});
test("rejects unsafe refs", () => {
  for (const value of ["", "../main", "main..evil", "refs//heads/main", "-option", "main/", "bad ref", "refs/heads/main.lock"]) {
    assert.equal(isSafeGitHubRef(value), false, value);
  }
});
test("has bounded scanner choices", () => {
  assert.deepEqual(GITHUB_AUDIT_ENGINES, ["all", "trivy", "gitleaks", "semgrep", "osv-scanner", "zizmor", "ruff", "shellcheck", "biome"]);
});
