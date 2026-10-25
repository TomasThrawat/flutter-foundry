# Unified Audit MCP

The existing Flutter Foundry MCP endpoint exposes a unified audit interface alongside Flutter engineering tools.

## MCP tools
- flutter_audit_engine_catalog: list scanner catalog entries and integration limits.
- flutter_audit_engine_status: probe installed local CLI tools without running a scan.
- flutter_audit_scan_supplied_files: heuristic checks against supplied source text without executing it.
- flutter_audit_run_engine: run one allowlisted local CLI.
- flutter_audit_scan_local_repository: run selected locally available scanners.
- flutter_audit_run_github_workflow: dispatch an audit workflow for a public repository, limited to 10 MCP-triggered runs per hour.

## Automatic and on-demand execution
- The Audit Engine Scans workflow runs automatically for pull requests targeting main.
- From MCP, call flutter_audit_run_github_workflow with targetRepository (owner/repository), targetRef (branch, tag, or commit), and engine (all, trivy, gitleaks, semgrep, osv-scanner, zizmor, ruff, shellcheck, or biome).
- The workflow produces a summary and per-engine logs/reports as an artifact. Open the returned run URL to follow progress and download the reports.
- Only public repositories are accepted. Target project build scripts and package install scripts are not run. A non-zero scanner exit may mean findings or a scanner/configuration issue; inspect the artifact.
- Scans run on GitHub Actions, so Vercel does not need scanner binaries.

## Required one-time configuration for MCP-triggered scans
Add GITHUB_AUDIT_TOKEN to the Production and Preview environment variables of the Vercel project, then redeploy. Use a fine-grained token scoped only to TomasThrawat/flutter-foundry with:
- Actions: Read and write
- Contents: Read-only

The token is used by MCP to dispatch the workflow and read run status. Never put it in source code, workflow inputs, or chat messages. Without it, MCP returns not_configured; pull-request scans still run automatically.

The trigger checks repository visibility, rejects archived/private repositories and malformed refs, and limits MCP-triggered runs to 10 per hour. The workflow independently validates inputs and checks out target source with persisted credentials disabled.

## Direct CLI adapters
Direct local CLI adapters cover Trivy, Gitleaks, Semgrep, OSV-Scanner, zizmor, Ruff, ShellCheck, Biome, detekt, ktlint, golangci-lint, Supply Chain Guard and Prism Scanner. These local CLI engines still require binaries installed in their runtime. The catalog also contains CI/MCP/LLM integrations that are not all invoked as child processes.

## Local CLI execution safety
- Child processes use fixed executable/argument allowlists with shell disabled.
- AUDIT_ALLOWED_ROOTS controls trusted local repository paths.
- AUDIT_ENGINE_TIMEOUT_MS configures single-engine timeout (capped at 20 seconds); multi-engine calls have a 43-second budget.
- Output is bounded and credential-like fields are redacted, but redaction is not guaranteed to catch every secret.


## Reading scanner exit codes

The audit artifact includes individual scanner logs and JSON reports where supported. A zero code means the command completed; nonzero codes can mean findings or a scanner/configuration failure. Review the relevant JSON report and diagnostic log before concluding that a scan is clean. Engines are recorded as skipped if the project does not contain files in their supported language/type.
