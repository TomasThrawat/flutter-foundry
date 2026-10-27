import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPERPOWERS_COMMIT,
  SUPERPOWERS_REPOSITORY,
  SUPERPOWERS_SKILLS,
  composeSuperpowersWorkflow,
  getSuperpowersSkill,
  getSuperpowersSkillFile,
  listSuperpowersSkills,
  registerSuperpowersTools,
  searchSuperpowersSkills,
  validateSuperpowersWorkflow,
} from "../lib/superpowers";

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function fakeFetcher(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init) => handler(url, init);
}

test("catalog exposes all skills from the pinned official Superpowers revision", () => {
  const catalog = listSuperpowersSkills();
  assert.equal(catalog.repository, "obra/superpowers");
  assert.equal(catalog.commit, "2ce8aa15d05bd57213e6f746f953aafb7ded7a8b");
  assert.equal(catalog.license, "MIT");
  assert.equal(catalog.count, 15);
  assert.ok(catalog.skills.some((skill) => skill.slug === "test-driven-development"));
  assert.ok(catalog.skills.some((skill) => skill.slug === "systematic-debugging"));
});

test("loading a skill fetches its SKILL.md from the pinned upstream commit", async () => {
  let requestedUrl = "";
  const fetcher = fakeFetcher((url) => {
    requestedUrl = url;
    return response("---\nname: test-driven-development\n---\nUse red-green-refactor.");
  });
  const result = await getSuperpowersSkill("test-driven-development", fetcher);
  assert.ok(requestedUrl.includes(SUPERPOWERS_REPOSITORY.replace("/", "\\/")));
  assert.ok(requestedUrl.includes(SUPERPOWERS_COMMIT));
  assert.equal(result.skill.slug, "test-driven-development");
  assert.match(result.content, /red-green-refactor/);
});

test("unknown skill names are rejected before any network request", async () => {
  let requested = false;
  const fetcher = fakeFetcher(() => {
    requested = true;
    return response("unexpected");
  });
  await assert.rejects(() => getSuperpowersSkill("../README.md", fetcher), /Unknown Superpowers skill/);
  assert.equal(requested, false);
});

test("supporting files must exist in the pinned upstream tree", async () => {
  const calls: string[] = [];
  const fetcher = fakeFetcher((url) => {
    calls.push(url);
    if (url.startsWith("https://api.github.com/")) {
      return new Response(JSON.stringify({
        tree: [{ type: "blob", path: "skills/systematic-debugging/root-cause-tracing.md" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return response("Trace the data flow to the point of failure.");
  });
  const result = await getSuperpowersSkillFile("systematic-debugging", "root-cause-tracing.md", fetcher);
  assert.equal(calls.length, 2);
  assert.equal(result.path, "root-cause-tracing.md");
  assert.match(result.content, /data flow/);
});

test("supporting file path traversal is rejected before network access", async () => {
  let calls = 0;
  const fetcher = fakeFetcher(() => {
    calls += 1;
    return response("unexpected");
  });
  await assert.rejects(
    () => getSuperpowersSkillFile("systematic-debugging", "../../README.md", fetcher),
    /relative file path|unsupported path segment/,
  );
  assert.equal(calls, 0);
});

test("nonexistent supporting files are rejected before raw content is fetched", async () => {
  let calls = 0;
  const fetcher = fakeFetcher((url) => {
    calls += 1;
    if (url.startsWith("https://api.github.com/")) {
      return new Response(JSON.stringify({ tree: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return response("should not be fetched");
  });
  await assert.rejects(
    () => getSuperpowersSkillFile("systematic-debugging", "not-present.md", fetcher),
    /not present/,
  );
  assert.equal(calls, 1);
});

test("search ranks relevant skills without pretending to perform semantic embedding search", () => {
  const result = searchSuperpowersSkills("test driven", 5);
  assert.equal(result.searchScope, "Skill names and summaries; use superpowers_use_skill to read full instructions.");
  assert.ok(result.results.some((skill) => skill.slug === "test-driven-development"));
});

test("workflow composition orders debugging before a fix and includes verification", () => {
  const result = composeSuperpowersWorkflow("Debug failing tests and implement a regression fix");
  const steps = result.workflow.map((step) => step.skill);
  assert.equal(steps[0], "systematic-debugging");
  assert.ok(steps.includes("test-driven-development"));
  assert.equal(steps.at(-1), "verification-before-completion");
});

test("workflow validation identifies missing design, TDD, and verification guardrails", () => {
  const result = validateSuperpowersWorkflow("Design and implement a new feature", [
    "brainstorming",
    "writing-plans",
  ]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingSkills, ["test-driven-development", "verification-before-completion"]);
});

test("tool registrar adds all six tools and their local handlers are usable", async () => {
  const tools = new Map<string, { title: string; run: (input: unknown) => Promise<unknown> | unknown }>();
  registerSuperpowersTools((name, title, _description, _schema, run) => {
    tools.set(name, { title, run });
  }, fakeFetcher(() => {
    throw new Error("This test should not fetch upstream content.");
  }));

  assert.deepEqual([...tools.keys()], [
    "superpowers_list_skills",
    "superpowers_use_skill",
    "superpowers_get_skill_file",
    "superpowers_search_skills",
    "superpowers_compose_workflow",
    "superpowers_validate_workflow",
  ]);
  const catalog = await tools.get("superpowers_list_skills")?.run({});
  assert.equal((catalog as ReturnType<typeof listSuperpowersSkills>).count, SUPERPOWERS_SKILLS.length);

  const search = await tools.get("superpowers_search_skills")?.run({ query: "debugging" });
  assert.ok((search as ReturnType<typeof searchSuperpowersSkills>).results.length > 0);

  const composition = await tools.get("superpowers_compose_workflow")?.run({ goal: "debug an error" });
  assert.equal((composition as ReturnType<typeof composeSuperpowersWorkflow>).workflow[0].skill, "systematic-debugging");

  const invalid = await tools.get("superpowers_validate_workflow")?.run({
    goal: "fix failing tests",
    skills: ["systematic-debugging"],
  });
  assert.equal((invalid as ReturnType<typeof validateSuperpowersWorkflow>).valid, false);
});
