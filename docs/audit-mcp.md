# Unified Audit MCP

The existing Flutter Foundry MCP endpoint exposes a unified audit interface alongside Flutter engineering tools.

## MCP tools

- flutter_audit_engine_catalog: list repositories, stated licenses, capabilities and integration limits.
- flutter_audit_engine_status: probe installed local CLI tools without running a scan.
- flutter_audit_scan_supplied_files: run heuristic checks against supplied source text without executing it.
- flutter_audit_run_engine: run one allowlisted CLI against a local repository.
- flutter_audit_scan_local_repository: run selected available scanners with a bounded runtime and sanitized output.

Direct CLI adapters cover Trivy, Gitleaks, Semgrep, OSV-Scanner, zizmor, Ruff, ShellCheck, Biome, detekt, ktlint, golangci-lint, Supply Chain Guard and Prism Scanner. Install each upstream tool separately; this app does not download executables automatically.

The catalog also includes Super-Linter, MegaLinter, CodeQL, PR-Agent, Codegraph, Argus, Trivy MCP, the AWS sample MCP security scanner, Lintro, LeakFerret, Nox, AI PatchLab and Comply OSS. They are categorized as CI integrations, standalone MCP servers, model-backed workflows or tools needing additional compatibility checks. They are not all launched as child processes.

## Execution safety

- Child processes use a fixed executable/argument allowlist with shell disabled. Clients cannot send arbitrary commands.
- The default scan root is the server current working directory. Set AUDIT_ALLOWED_ROOTS to comma-separated trusted absolute paths to allow other repositories.
- AUDIT_ENGINE_TIMEOUT_MS configures a single-engine timeout, capped at 20 seconds. Multi-engine calls have a 43-second total budget.
- Output is bounded and credential-like fields are redacted. This is defense-in-depth, not a guarantee that every secret format is detected.
- Vercel does not bundle native scanner binaries. Engine status reports missing binaries until a supported runtime provides them. Source-text heuristics work without scanners but do not replace them.
- Semgrep rule retrieval and Trivy/OSV/Supply Chain Guard data updates may need network access.
- PR-Agent and AI-based license analysis are not called automatically. Model providers may charge fees.
- Check transitive dependencies, rule packs, containers and model-provider terms before redistribution.
