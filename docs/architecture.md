# Architecture

- Next.js hosts the landing page, SVG workspace, health endpoint, and stateless MCP endpoint.
- MCP tools use deterministic analysis functions, live pub.dev package metadata, and OSV vulnerability data.
- SVG processing sanitizes user markup, launches Playwright Chromium, opens the trusted upstream SVG-Edit deployment, imports markup through SVG-Edit's own editor API, serializes the canvas and captures a PNG.
- Vercel uses @sparticuz/chromium; local development uses installed Playwright Chromium.
- The browser endpoint may take tens of seconds; verify runtime duration and memory limits for the deployment plan.
- MCP remains intentionally unauthenticated. Request throttling uses an optional Upstash REST counter for cross-instance limits, with a bounded in-memory fallback when Redis is not configured.
- Static accessibility/Android findings are heuristics; OSV checks exact versions supplied by the caller.
- Flutter CI is dispatched to an isolated GitHub Actions runner for active public repositories only. The target checkout does not persist Git credentials or receive target-specific secrets. The workflow runs Flutter analysis, tests when present, coverage, and a release APK build.
- No arbitrary Git mutation is executed by an MCP tool.

- MCP also registers a unified audit module with an engine catalog, local CLI status probes, source-text heuristics and allowlisted scanner adapters. Native scanner binaries are not bundled into Vercel.
- Audit subprocesses use fixed arguments without a shell and are restricted to AUDIT_ALLOWED_ROOTS. Output is bounded and sanitized before returning to MCP clients.

## Flutter CLI boundary

- The flutter-analyze engine invokes the fixed command flutter analyze --no-pub; it does not run pub get, tests, build scripts or arbitrary user-supplied commands.

- It is available only when a Flutter SDK is installed on the host and the target directory resolves inside AUDIT_ALLOWED_ROOTS. The repository must contain pubspec.yaml.

- Vercel deployments do not bundle the Flutter SDK, so the engine is expected to report not_installed there. Supplied build logs and source snippets continue to use heuristic static triage.
