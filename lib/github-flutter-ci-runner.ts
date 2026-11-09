import { z } from "zod";
import { isSafeGitHubRef, isSafeGitHubRepository } from "@/lib/github-audit-runner";

const CONTROL_REPOSITORY = "TomasThrawat/flutter-foundry";
const WORKFLOW_FILE = "flutter-project-ci.yml";
const WORKFLOW_URL = "https://github.com/" + CONTROL_REPOSITORY + "/actions/workflows/" + WORKFLOW_FILE;
const API_ROOT = "https://api.github.com";
const MAX_DISPATCHES_PER_HOUR = 6;

export function isSafeFlutterChannel(value: string): boolean {
	return value === "stable" || value === "beta" || value === "main";
}

type ApiObject = Record<string, unknown>;
function isApiObject(value: unknown): value is ApiObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
type WorkflowRun = {
	id: number;
	event: string;
	status: string;
	conclusion: string | null;
	created_at: string;
	html_url: string;
	head_branch: string;
	name: string;
};
function isWorkflowRun(value: unknown): value is WorkflowRun {
	return (
		isApiObject(value) &&
		typeof value.id === "number" &&
		typeof value.event === "string" &&
		typeof value.status === "string" &&
		(value.conclusion === null || typeof value.conclusion === "string") &&
		typeof value.created_at === "string" &&
		typeof value.html_url === "string" &&
		typeof value.head_branch === "string" &&
		typeof value.name === "string"
	);
}

async function githubRequest(
	token: string | undefined,
	path: string,
	init?: RequestInit,
): Promise<{ status: number; data: ApiObject | null }> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		...((init?.headers ?? {}) as Record<string, string>),
	};
	if (token) headers.Authorization = "Bearer " + token;
	const response = await fetch(API_ROOT + path, {
		...init,
		headers,
		signal: AbortSignal.timeout(8000),
		cache: "no-store",
	});
	const body = await response.text();
	let data: ApiObject | null = null;
	if (body) {
		try {
			const parsed: unknown = JSON.parse(body);
			data = isApiObject(parsed) ? parsed : { message: "GitHub returned a non-object JSON response." };
		} catch {
			data = { message: "GitHub returned a non-JSON response." };
		}
	}
	return { status: response.status, data };
}

function apiError(status: number, message?: unknown): Error {
	if (status === 401) return new Error("GitHub rejected GITHUB_AUDIT_TOKEN. Check its token and repository permissions.");
	if (status === 403) return new Error("GitHub denied the request or its Actions rate limit was reached.");
	if (status === 404) return new Error("The target repository or Flutter CI workflow was not found, or the token cannot access it.");
	const detail = typeof message === "string" ? ": " + message.slice(0, 180) : ".";
	return new Error("GitHub API request failed (" + status + ")" + detail);
}

type Registrar = <TInput>(
	name: string,
	title: string,
	description: string,
	schema: z.ZodType<TInput>,
	run: (input: TInput) => Promise<unknown> | unknown,
) => void;

export function registerGithubFlutterCiTools(register: Registrar) {
	register(
		"flutter_run_github_project_ci",
		"Run Flutter project CI on GitHub Actions",
		"Dispatch an on-demand Flutter analysis, test, coverage, and release APK build for an active public GitHub repository. Target code runs without persisted Git checkout credentials or target-specific secrets. Requires GITHUB_AUDIT_TOKEN on the server; maximum 6 MCP-triggered runs per hour.",
		z.object({
			targetRepository: z.string().min(3).max(205).refine(isSafeGitHubRepository, "Use owner/repository for a public GitHub repository."),
			targetRef: z.string().min(1).max(128).refine(isSafeGitHubRef, "Use a valid branch, tag, or commit reference."),
			flutterChannel: z.enum(["stable", "beta", "main"]).default("stable"),
		}).strict(),
		async ({ targetRepository, targetRef, flutterChannel }: {
			targetRepository: string;
			targetRef: string;
			flutterChannel: "stable" | "beta" | "main";
		}) => {
			const token = process.env.GITHUB_AUDIT_TOKEN?.trim();
			if (!token) {
				return {
					status: "not_configured",
					requiredEnvironmentVariable: "GITHUB_AUDIT_TOKEN",
					message: "Add a fine-grained token to the Vercel Production environment with Actions read/write and Contents read access to TomasThrawat/flutter-foundry, then redeploy. The MCP endpoint itself remains unauthenticated.",
					workflowUrl: WORKFLOW_URL,
				};
			}
			const parts = targetRepository.split("/");
			const metadata = await githubRequest(undefined, "/repos/" + parts.map(encodeURIComponent).join("/"));
			if (metadata.status !== 200) throw apiError(metadata.status, metadata.data?.message);
			if (metadata.data?.visibility !== "public")
				return { status: "rejected", targetRepository, message: "Only public repositories can be built by this workflow.", workflowUrl: WORKFLOW_URL };
			if (metadata.data?.archived === true)
				return { status: "rejected", targetRepository, message: "The target repository is archived.", workflowUrl: WORKFLOW_URL };

			const runsPath = "/repos/" + CONTROL_REPOSITORY + "/actions/workflows/" + WORKFLOW_FILE + "/runs?event=workflow_dispatch&per_page=100";
			const before = await githubRequest(token, runsPath);
			if (before.status !== 200) throw apiError(before.status, before.data?.message);
			const existingRuns = Array.isArray(before.data?.workflow_runs) ? before.data.workflow_runs.filter(isWorkflowRun) : [];
			const now = Date.now();
			const recentCount = existingRuns.filter((run) =>
				run.event === "workflow_dispatch" &&
				Number.isFinite(Date.parse(run.created_at)) &&
				Date.parse(run.created_at) >= now - 60 * 60 * 1000,
			).length;
			if (recentCount >= MAX_DISPATCHES_PER_HOUR)
				return { status: "rate_limited", limit: MAX_DISPATCHES_PER_HOUR, window: "1 hour", workflowUrl: WORKFLOW_URL, message: "The Flutter CI dispatch limit was reached." };

			const knownRunIds = new Set(existingRuns.map((run) => run.id));
			const startedAt = Date.now();
			const dispatch = await githubRequest(
				token,
				"/repos/" + CONTROL_REPOSITORY + "/actions/workflows/" + WORKFLOW_FILE + "/dispatches",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						ref: "main",
						inputs: { target_repository: targetRepository, target_ref: targetRef, flutter_channel: flutterChannel },
					}),
				},
			);
			if (dispatch.status !== 204) throw apiError(dispatch.status, dispatch.data?.message);
			await new Promise((resolve) => setTimeout(resolve, 900));
			const after = await githubRequest(token, runsPath);
			if (after.status === 200 && Array.isArray(after.data?.workflow_runs)) {
				const created = after.data.workflow_runs
					.filter(isWorkflowRun)
					.filter((run) => !knownRunIds.has(run.id) && run.event === "workflow_dispatch" && Date.parse(run.created_at) >= startedAt - 10_000)
					.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
				if (created)
					return {
						status: created.status,
						runId: created.id,
						conclusion: created.conclusion,
						targetRepository,
						targetRef,
						flutterChannel,
						runUrl: created.html_url,
						workflowUrl: WORKFLOW_URL,
						rateLimit: (recentCount + 1) + "/" + MAX_DISPATCHES_PER_HOUR + " MCP-triggered runs in the last hour",
						note: "Open the run URL to follow Flutter analysis, tests, APK build, and the uploaded artifact.",
					};
			}
			return {
				status: "dispatched",
				targetRepository,
				targetRef,
				flutterChannel,
				workflowUrl: WORKFLOW_URL,
				rateLimit: (recentCount + 1) + "/" + MAX_DISPATCHES_PER_HOUR + " MCP-triggered runs in the last hour",
				note: "GitHub accepted the dispatch. Open the workflow URL; the run may take a few seconds to appear.",
			};
		},
	);
}
