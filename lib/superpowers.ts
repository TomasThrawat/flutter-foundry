import { z } from "zod";

export const SUPERPOWERS_REPOSITORY = "obra/superpowers";
export const SUPERPOWERS_COMMIT = "2ce8aa15d05bd57213e6f746f953aafb7ded7a8b";
export const SUPERPOWERS_TREE_SHA = "5e3a3c9af45c3474506fb62a3ce664bd03a2cdc4";
export const SUPERPOWERS_SOURCE_URL =
  "https://github.com/obra/superpowers/tree/" + SUPERPOWERS_COMMIT;

export const SUPERPOWERS_SKILLS = [
  { slug: "brainstorming", name: "Brainstorming", description: "Explore intent and constraints before designing a new feature or product." },
  { slug: "diagnosing-superpowers", name: "Diagnosing Superpowers", description: "Investigate why a skill or agent workflow behaved unexpectedly, using evidence." },
  { slug: "dispatching-parallel-agents", name: "Dispatching Parallel Agents", description: "Split independent tasks across agents with clear boundaries and review." },
  { slug: "executing-plans", name: "Executing Plans", description: "Execute an approved implementation plan in controlled batches and verify results." },
  { slug: "finishing-a-development-branch", name: "Finishing a Development Branch", description: "Verify completed work and choose a safe merge, pull-request, or cleanup path." },
  { slug: "receiving-code-review", name: "Receiving Code Review", description: "Evaluate code review feedback critically and verify claims before changing code." },
  { slug: "requesting-code-review", name: "Requesting Code Review", description: "Request a structured review and resolve findings by severity." },
  { slug: "subagent-driven-development", name: "Subagent-Driven Development", description: "Delegate implementation tasks to focused agents with staged code review." },
  { slug: "systematic-debugging", name: "Systematic Debugging", description: "Find root causes through evidence before attempting a fix." },
  { slug: "test-driven-development", name: "Test-Driven Development", description: "Use the red-green-refactor cycle: failing test, minimal fix, passing test." },
  { slug: "using-git-worktrees", name: "Using Git Worktrees", description: "Isolate changes in separate Git worktrees and verify the starting state." },
  { slug: "using-superpowers", name: "Using Superpowers", description: "Discover relevant skills and follow the Superpowers skill invocation workflow." },
  { slug: "verification-before-completion", name: "Verification Before Completion", description: "Run the relevant checks and inspect output before claiming a task is done." },
  { slug: "writing-plans", name: "Writing Plans", description: "Write small, actionable implementation plans with explicit verification steps." },
  { slug: "writing-skills", name: "Writing Skills", description: "Create and evaluate agent skills with clear triggers, instructions, and tests." },
] as const;

export type SuperpowersSkillSlug = (typeof SUPERPOWERS_SKILLS)[number]["slug"];
const SKILL_SLUGS = SUPERPOWERS_SKILLS.map((skill) => skill.slug) as [
  SuperpowersSkillSlug,
  ...SuperpowersSkillSlug[],
];

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type TreeEntry = { path?: unknown; type?: unknown };

export type SuperpowersToolRegistrar = (
  name: string,
  title: string,
  description: string,
  inputSchema: z.ZodType,
  run: (input: unknown) => Promise<unknown> | unknown,
) => void;

let cachedTree: { expiresAt: number; paths: Set<string> } | undefined;
let pendingTree: Promise<Set<string>> | undefined;

function assertSkillSlug(value: string): asserts value is SuperpowersSkillSlug {
  if (!SUPERPOWERS_SKILLS.some((skill) => skill.slug === value)) {
    throw new Error("Unknown Superpowers skill. Call superpowers_list_skills for valid names.");
  }
}

function sourceFileUrl(path: string): string {
  return "https://raw.githubusercontent.com/" + SUPERPOWERS_REPOSITORY + "/" +
    SUPERPOWERS_COMMIT + "/" + path.split("/").map(encodeURIComponent).join("/");
}

function githubTreeUrl(): string {
  return "https://api.github.com/repos/" + SUPERPOWERS_REPOSITORY +
    "/git/trees/" + SUPERPOWERS_TREE_SHA + "?recursive=1";
}

async function fetchText(url: string, fetcher: Fetcher): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        accept: "text/plain",
        "user-agent": "flutter-foundry-superpowers-mcp",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Could not reach the pinned Superpowers source. Check outbound network access.");
  }
  if (!response.ok) {
    throw new Error("The official Superpowers source returned HTTP " + response.status + ".");
  }
  return response.text();
}

async function fetchTreePaths(fetcher: Fetcher): Promise<Set<string>> {
  let response: Response;
  try {
    response = await fetcher(githubTreeUrl(), {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "flutter-foundry-superpowers-mcp",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Could not reach the official Superpowers file index.");
  }
  if (!response.ok) {
    throw new Error("The official Superpowers file index returned HTTP " + response.status + ".");
  }

  const data = (await response.json()) as { tree?: TreeEntry[] };
  if (!Array.isArray(data.tree)) {
    throw new Error("The official Superpowers file index had an unexpected format.");
  }
  return new Set(
    data.tree
      .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
      .map((entry) => String(entry.path)),
  );
}

async function getTreePaths(fetcher: Fetcher): Promise<Set<string>> {
  const canCache = fetcher === globalThis.fetch;
  if (canCache && cachedTree && cachedTree.expiresAt > Date.now()) {
    return cachedTree.paths;
  }
  if (canCache && pendingTree) {
    return pendingTree;
  }

  const request = fetchTreePaths(fetcher);
  if (canCache) pendingTree = request;
  try {
    const paths = await request;
    if (canCache) cachedTree = { expiresAt: Date.now() + 5 * 60_000, paths };
    return paths;
  } finally {
    if (canCache && pendingTree === request) pendingTree = undefined;
  }
}

function normalizeSkillFilePath(value: string): string {
  if (
    value.length === 0 ||
    value.length > 240 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new Error("Provide a relative file path inside the selected skill directory.");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error("The skill file path contains an unsupported path segment.");
  }
  return parts.join("/");
}

export function listSuperpowersSkills() {
  return {
    repository: SUPERPOWERS_REPOSITORY,
    commit: SUPERPOWERS_COMMIT,
    source: SUPERPOWERS_SOURCE_URL,
    license: "MIT",
    count: SUPERPOWERS_SKILLS.length,
    skills: SUPERPOWERS_SKILLS.map((skill) => ({
      ...skill,
      sourceUrl: SUPERPOWERS_SOURCE_URL + "/skills/" + skill.slug + "/SKILL.md",
    })),
  };
}

export async function getSuperpowersSkill(
  slug: string,
  fetcher: Fetcher = fetch,
) {
  assertSkillSlug(slug);
  const skill = SUPERPOWERS_SKILLS.find((item) => item.slug === slug);
  if (!skill) throw new Error("Unknown Superpowers skill.");
  const path = "skills/" + skill.slug + "/SKILL.md";
  const content = await fetchText(sourceFileUrl(path), fetcher);
  return {
    repository: SUPERPOWERS_REPOSITORY,
    commit: SUPERPOWERS_COMMIT,
    skill,
    sourceUrl: SUPERPOWERS_SOURCE_URL + "/skills/" + skill.slug + "/SKILL.md",
    content,
  };
}

export async function getSuperpowersSkillFile(
  slug: string,
  filePath: string,
  fetcher: Fetcher = fetch,
) {
  assertSkillSlug(slug);
  const relativePath = normalizeSkillFilePath(filePath);
  if (relativePath === "SKILL.md") return getSuperpowersSkill(slug, fetcher);

  const path = "skills/" + slug + "/" + relativePath;
  const paths = await getTreePaths(fetcher);
  if (!paths.has(path)) {
    throw new Error("That file is not present in the selected Superpowers skill at the pinned revision.");
  }
  const content = await fetchText(sourceFileUrl(path), fetcher);
  return {
    repository: SUPERPOWERS_REPOSITORY,
    commit: SUPERPOWERS_COMMIT,
    skill: slug,
    path: relativePath,
    sourceUrl: SUPERPOWERS_SOURCE_URL + "/skills/" + slug + "/" + relativePath,
    content,
  };
}

export function searchSuperpowersSkills(query: string, limit = 5) {
  const terms = query.toLowerCase().trim().split(/[^a-z0-9-]+/).filter(Boolean);
  const results = SUPERPOWERS_SKILLS.map((skill) => {
    const searchable = (skill.slug + " " + skill.name + " " + skill.description).toLowerCase();
    const matchedTerms = terms.filter((term) => searchable.includes(term));
    const score = matchedTerms.reduce((total, term) => {
      if (skill.slug === term || skill.slug.includes(term)) return total + 4;
      if (skill.name.toLowerCase().includes(term)) return total + 3;
      return total + 1;
    }, 0);
    return { ...skill, score, matchedTerms };
  }).filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, Math.max(1, Math.min(10, Math.trunc(limit))));
  return {
    query,
    searchScope: "Skill names and summaries; use superpowers_use_skill to read full instructions.",
    results,
  };
}

export function composeSuperpowersWorkflow(goal: string) {
  const text = goal.toLowerCase();
  const selected: SuperpowersSkillSlug[] = [];
  const add = (slug: SuperpowersSkillSlug) => {
    if (!selected.includes(slug)) selected.push(slug);
  };
  const debugging = /\b(debug|debugging|bug|crash|error|regression|failing)\b/.test(text);
  const design = /\b(brainstorm|design|new feature|new app|idea|product)\b/.test(text);
  const coding = /\b(implement|build|create|add|change|fix|refactor|code|feature|app|write|test)\b/.test(text);
  const parallel = /\b(parallel|subagent|independent tasks|concurrently)\b/.test(text);
  const review = /\b(review|feedback|pull request|pr)\b/.test(text);
  const finishing = /\b(finish|release|merge|ship|publish)\b/.test(text);

  if (debugging) add("systematic-debugging");
  if (design) add("brainstorming");
  if (coding && design) add("using-git-worktrees");
  if (coding) {
    add("writing-plans");
    add(parallel ? "dispatching-parallel-agents" : "executing-plans");
    add("test-driven-development");
  }
  if (review) {
    add("requesting-code-review");
    add("receiving-code-review");
  }
  if (coding || debugging || review) add("verification-before-completion");
  if (finishing) add("finishing-a-development-branch");
  if (selected.length === 0) add("using-superpowers");

  return {
    goal,
    workflow: selected.map((slug, index) => ({
      step: index + 1,
      skill: slug,
      name: SUPERPOWERS_SKILLS.find((skill) => skill.slug === slug)?.name ?? slug,
      sourceUrl: SUPERPOWERS_SOURCE_URL + "/skills/" + slug + "/SKILL.md",
    })),
    note: "A suggested ordering, not an automatic code executor. Read each skill and adapt it to the repository and task.",
  };
}

export function validateSuperpowersWorkflow(goal: string | undefined, skills: string[]) {
  const text = (goal ?? "").toLowerCase();
  const selected = new Set(skills);
  const required: SuperpowersSkillSlug[] = [];
  const add = (slug: SuperpowersSkillSlug) => {
    if (!required.includes(slug)) required.push(slug);
  };
  const design = /\b(brainstorm|design|new feature|new app|idea|product)\b/.test(text);
  const debugging = /\b(debug|debugging|bug|crash|error|regression|failing)\b/.test(text);
  const coding = /\b(implement|build|create|add|change|fix|refactor|code|feature|app|write|test)\b/.test(text);

  if (design) {
    add("brainstorming");
    add("writing-plans");
  }
  if (debugging) add("systematic-debugging");
  if (coding) {
    add("test-driven-development");
    add("verification-before-completion");
  } else if (debugging) {
    add("verification-before-completion");
  }

  const missing = required.filter((slug) => !selected.has(slug));
  return {
    goal: goal ?? "",
    selectedSkills: skills,
    requiredSkills: required,
    missingSkills: missing,
    valid: missing.length === 0,
    note: "Workflow checks are advisory guardrails; task-specific judgement and actual test output remain necessary.",
  };
}

export function registerSuperpowersTools(
  register: SuperpowersToolRegistrar,
  fetcher: Fetcher = fetch,
): void {
  register(
    "superpowers_list_skills",
    "List Superpowers skills",
    "List the official skills available from the pinned obra/superpowers revision.",
    z.object({}).strict(),
    () => listSuperpowersSkills(),
  );

  const useSkillSchema = z.object({ skill: z.enum(SKILL_SLUGS) }).strict();
  register(
    "superpowers_use_skill",
    "Load a Superpowers skill",
    "Read a skill's complete SKILL.md instructions from the official pinned Superpowers repository.",
    useSkillSchema,
    async (input) => {
      const parsed = useSkillSchema.parse(input);
      return getSuperpowersSkill(parsed.skill, fetcher);
    },
  );

  const fileSchema = z.object({
    skill: z.enum(SKILL_SLUGS),
    path: z.string().min(1).max(240),
  }).strict();
  register(
    "superpowers_get_skill_file",
    "Read a supporting Superpowers skill file",
    "Read a reference, prompt, example, or script that exists under a selected skill at the pinned revision. Paths are checked against the upstream Git tree.",
    fileSchema,
    async (input) => {
      const parsed = fileSchema.parse(input);
      return getSuperpowersSkillFile(parsed.skill, parsed.path, fetcher);
    },
  );

  const searchSchema = z.object({
    query: z.string().min(1).max(240),
    limit: z.number().int().min(1).max(10).default(5),
  }).strict();
  register(
    "superpowers_search_skills",
    "Search Superpowers skills",
    "Search skill names and summaries; then load matching instructions with superpowers_use_skill.",
    searchSchema,
    (input) => {
      const parsed = searchSchema.parse(input);
      return searchSuperpowersSkills(parsed.query, parsed.limit);
    },
  );

  const composeSchema = z.object({ goal: z.string().min(1).max(1000) }).strict();
  register(
    "superpowers_compose_workflow",
    "Compose a Superpowers workflow",
    "Suggest an ordered set of official skills for a task based on design, debugging, implementation, review, and release intent.",
    composeSchema,
    (input) => composeSuperpowersWorkflow(composeSchema.parse(input).goal),
  );

  const validateSchema = z.object({
    goal: z.string().max(1000).optional(),
    skills: z.array(z.enum(SKILL_SLUGS)).min(1).max(12),
  }).strict();
  register(
    "superpowers_validate_workflow",
    "Validate a Superpowers workflow",
    "Check whether a proposed skill sequence includes the guardrails recommended for the stated coding goal.",
    validateSchema,
    (input) => {
      const parsed = validateSchema.parse(input);
      return validateSuperpowersWorkflow(parsed.goal, parsed.skills);
    },
  );
}
