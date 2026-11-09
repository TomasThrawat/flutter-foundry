# Flutter Foundry

A fresh open-source Flutter engineering MCP server built around live official data, static project analysis, and the actual SVG-Edit browser editor automated with Playwright.

- Source: https://github.com/TomasThrawat/flutter-foundry
- MCP endpoint: /mcp
- Health endpoint: /api/health
- SVG workspace: /icon-maker
- Repository license: MIT. SVG-Edit is upstream software with its own MIT license; verify all dependency licenses before redistribution.

## Included tool categories

- Live pub.dev search and package metadata.
- Official Flutter/Dart references and stack recommendations.
- GitHub Actions workflow generation, including on-demand Flutter project analysis, tests, coverage, and release APK builds; version-tagged source releases with SHA-256 checksums.
- Flutter/Dart/Gradle build-log triage with first-cause hints and repair planning.
- Real Flutter analysis and release APK builds through an on-demand GitHub Actions workflow for active public repositories; the local CLI analyzer remains available when Flutter is installed on the MCP host.
- ARB localization key/placeholder checks and LCOV coverage summaries.
- Heuristic Android manifest/Gradle and Flutter accessibility checks, including exported-component permission review and ARB locale direction/mismatch reporting.
- OSV scans for exact dependency versions.
- SDK/dependency-context review and release-report triage.

- Unified code-security audit MCP: engine catalog/status, heuristic checks for supplied files, and optional allowlisted local CLI scans with sanitized output. See docs/audit-mcp.md for limitations.

- Unified Icon Maker Pipeline: procedural SVG generation, comparable variants, element-targeted edits, heuristic quality checks, SVG optimization, raster-to-vector import, SVG-Edit integration, and Android/iOS ZIP exports. See docs/icon-maker.md.
- SVG-Edit + Playwright: browser opens upstream SVG-Edit, imports provided SVG into the editor canvas, serializes the result, and captures a PNG screenshot.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npx playwright install chromium
npm run dev
```

Open http://localhost:3000, visit /icon-maker, or connect an MCP client to http://localhost:3000/mcp.

## Validate

```sh
npm run typecheck
npm test
npm run test:icons
npm run test:icons:coverage
npm run test:coverage
npx playwright install --with-deps chromium
npm run test:svg-edit
npm run build
```

The SVG-Edit integration test contacts the official hosted editor and requires outbound network access.

## Deploy on Vercel

1. Import this GitHub repository as a Next.js project.
2. Use Node.js 22 or newer; enable Fluid Compute if available.
   **MCP access is intentionally no-auth:** /mcp and /api/superpowers-mcp do not require a token. Anyone who can reach the deployment can call them; do not treat these endpoints as private.

3. Set ICON_API_TOKEN to protect the browser-heavy /api/icons/edit endpoint.
4. Keep SVG_EDIT_URL at its official default unless you intentionally configure a trusted compatible build.

The Playwright call can take tens of seconds because it starts Chromium and loads a remote editor. Verify serverless duration and memory limits on the selected plan. Public icon and MCP endpoints enforce request throttling. Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable cross-instance global limits; otherwise a bounded per-instance fallback is used. Configure provider-level protections as an additional production layer.

## Security notes

SVG input is limited to 250 KB, parsed as XML, and sanitized with a restricted element/attribute allowlist. Script elements, event handlers, external links, entity declarations, and embedded HTML are rejected or stripped. This is defense-in-depth, not a guarantee that all malicious SVGs are harmless. The browser tool only accepts the official SVG-Edit hosts; do not broaden this allowlist for arbitrary URLs.

Static findings are advisory. The tools do not claim a Flutter build or device test succeeded unless that work was actually run.

## Superpowers MCP integration

- The existing /mcp endpoint now includes the official Superpowers skill tools.
- A standalone Superpowers-only MCP endpoint is available at /api/superpowers-mcp.
- Tools: list skills, load a skill, read a supporting file, search skill summaries, compose a workflow, and validate workflow guardrails.
- Source is pinned to an immutable upstream Superpowers v7.0.1 commit. Skill files are fetched read-only, with path checks and request timeouts. See docs/superpowers-mcp.md.

### Flutter analysis

When a local machine or MCP host has the Flutter SDK installed, flutter-analyze runs the fixed, read-only command flutter analyze --no-pub. The target must be within AUDIT_ALLOWED_ROOTS and contain pubspec.yaml. The hosted Vercel deployment does not include the Flutter SDK; there the local engine reports not_installed. Use the flutter_run_github_project_ci MCP tool (requires GITHUB_AUDIT_TOKEN) or manually dispatch .github/workflows/flutter-project-ci.yml to run analysis, tests, coverage, and an APK build for an active public repository. See docs/flutter-project-ci.md.

## Releases

Push a version tag such as v1.0.1 to trigger .github/workflows/release.yml. The workflow runs dependency audit, typecheck, tests, full library coverage, lint, and the production build, then publishes a source archive with a SHA-256 checksum. Flutter Foundry is a Next.js MCP service, so this release workflow does not create an APK.
