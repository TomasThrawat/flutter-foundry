import { z } from "zod";

const CONTROL_REPOSITORY = "TomasThrawat/flutter-foundry";
const WORKFLOW_FILE = "audit-engines.yml";
const WORKFLOW_URL = "https://github.com/" + CONTROL_REPOSITORY + "/actions/workflows/" + WORKFLOW_FILE;
const API_ROOT = "https://api.github.com";
const MAX_DISPATCHES_PER_HOUR = 10;

export const GITHUB_AUDIT_ENGINES = ["all", "trivy", "gitleaks", "semgrep", "osv-scanner", "zizmor", "ruff", "shellcheck", "biome"] as const;

export function isSafeGitHubRepository(value: string): boolean {
  if (value.length > 205 || value.includes("..")) return false;
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/.test(part));
}
export function isSafeGitHubRef(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.includes("..") && !value.includes("//") && !value.endsWith("/") &&
    !value.endsWith(".") && !value.endsWith(".lock") && !value.includes("@{");
}
type GitHubRun = { id: number; event: string; status: string; conclusion: string | null; created_at: string; html_url: string; head_branch: string; name: string };

async function githubRequest(token: string | undefined, path: string, init?: RequestInit): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...((init?.headers ?? {}) as Record<string, string>),
  };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(API_ROOT + path, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers,
  });
  const body = await response.text();
  let data: any = null;
  if (body) {
    try { data = JSON.parse(body); }
    catch { data = { message: "GitHub returned a non-JSON response." }; }
  }
  return { status: response.status, data };
}
function apiError(status: number, message?: string): Error {
  if (status === 401) return new Error("GitHub rejected GITHUB_AUDIT_TOKEN. Check the token and repository permissions.");
  if (status === 403) return new Error("GitHub denied the request or rate limit was reached. Confirm Actions read/write permissions.");
  if (status === 404) return new Error("The target repository or audit workflow was not found, or the token cannot access it.");
  return new Error("GitHub API request failed (" + status + ")" + (message ? ": " + message.slice(0, 180) : "."));
}
type Registrar = (name: string, title: string, description: string, schema: z.ZodType, run: (input: any) => Promise<unknown> | unknown) => void;

export function registerGithubAuditTools(register: Registrar) {
  register("flutter_audit_run_github_workflow", "Run GitHub audit workflow",
    "Dispatch the bounded GitHub Actions audit workflow for a public repository. Requires GITHUB_AUDIT_TOKEN on the server. Maximum 10 MCP-triggered scans per hour.",
    z.object({
      targetRepository: z.string().min(3).max(205).refine(isSafeGitHubRepository, "Use owner/repository for a public GitHub repository."),
      targetRef: z.string().min(1).max(128).refine(isSafeGitHubRef, "Use a valid branch, tag, or commit reference."),
      engine: z.enum(GITHUB_AUDIT_ENGINES).default("all"),
    }).strict(),
    async ({ targetRepository, targetRef, engine }: { targetRepository: string; targetRef: string; engine: (typeof GITHUB_AUDIT_ENGINES)[number] }) => {
      const token = process.env.GITHUB_AUDIT_TOKEN?.trim();
      if (!token) return {
        status: "not_configured",
        requiredEnvironmentVariable: "GITHUB_AUDIT_TOKEN",
        message: "Add a fine-grained GitHub token to Vercel Environment Variables with Actions read/write and Contents read access to TomasThrawat/flutter-foundry, then redeploy.",
        workflowUrl: WORKFLOW_URL,
      };
      const parts = targetRepository.split("/");
      const metadata = await githubRequest(undefined, "/repos/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]));
      if (metadata.status !== 200) throw apiError(metadata.status, metadata.data?.message);
      if (metadata.data?.visibility !== "public") return { status: "rejected", targetRepository, message: "Only public repositories can be scanned by this workflow.", workflowUrl: WORKFLOW_URL };
      if (metadata.data?.archived) return { status: "rejected", targetRepository, message: "The target repository is archived. Select an active public repository.", workflowUrl: WORKFLOW_URL };

      const runsPath = "/repos/TomasThrawat/flutter-foundry/actions/workflows/" + WORKFLOW_FILE + "/runs?event=workflow_dispatch&per_page=100";
      const before = await githubRequest(token, runsPath);
      if (before.status !== 200) throw apiError(before.status, before.data?.message);
      const now = Date.now();
      const existingRuns = Array.isArray(before.data?.workflow_runs) ? before.data.workflow_runs as GitHubRun[] : [];
      const lastHourCount = existingRuns.filter((run) =>
        run.event === "workflow_dispatch" && Number.isFinite(Date.parse(run.created_at)) &&
        Date.parse(run.created_at) >= now - 60 * 60 * 1000
      ).length;
      if (lastHourCount >= MAX_DISPATCHES_PER_HOUR) return {
        status: "rate_limited",
        limit: MAX_DISPATCHES_PER_HOUR,
        window: "1 hour",
        workflowUrl: WORKFLOW_URL,
        message: "The MCP-triggered audit limit was reached.",
      };
      const knownRunIds = new Set(existingRuns.map((run) => run.id));
      const startedAt = Date.now();
      const dispatch = await githubRequest(token, "/repos/TomasThrawat/flutter-foundry/actions/workflows/" + WORKFLOW_FILE + "/dispatches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { target_repository: targetRepository, target_ref: targetRef, engine } }),
      });
      if (dispatch.status !== 204) throw apiError(dispatch.status, dispatch.data?.message);
      await new Promise((resolve) => setTimeout(resolve, 900));
      const after = await githubRequest(token, runsPath);
      if (after.status === 200 && Array.isArray(after.data?.workflow_runs)) {
        const created = (after.data.workflow_runs as GitHubRun[])
          .filter((run) => !knownRunIds.has(run.id) && run.event === "workflow_dispatch" && Date.parse(run.created_at) >= startedAt - 10000)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
        if (created) return {
          status: created.status,
          runId: created.id,
          conclusion: created.conclusion,
          targetRepository,
          targetRef,
          engine,
          runUrl: created.html_url,
          workflowUrl: WORKFLOW_URL,
          rateLimit: (lastHourCount + 1) + "/" + MAX_DISPATCHES_PER_HOUR + " MCP-triggered runs in the last hour",
          note: "Open the run URL to follow progress and download its report artifact after completion.",
        };
      }
      return {
        status: "dispatched",
        targetRepository,
        targetRef,
        engine,
        workflowUrl: WORKFLOW_URL,
        rateLimit: (lastHourCount + 1) + "/" + MAX_DISPATCHES_PER_HOUR + " MCP-triggered runs in the last hour",
        note: "GitHub accepted the dispatch. The run may take a few seconds to appear on the workflow page.",
      };
    },
  );
}