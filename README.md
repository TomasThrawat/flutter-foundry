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
- GitHub Actions workflow generation.
- Flutter/Dart/Gradle build-log triage and repair planning.
- ARB localization key/placeholder checks and LCOV coverage summaries.
- Heuristic Android manifest/Gradle and Flutter accessibility checks.
- OSV scans for exact dependency versions.
- SDK/dependency-context review and release-report triage.

- Unified code-security audit MCP: engine catalog/status, heuristic checks for supplied files, and optional allowlisted local CLI scans with sanitized output. See docs/audit-mcp.md for limitations.

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
npx playwright install --with-deps chromium
npm run test:svg-edit
npm run build
```

The SVG-Edit integration test contacts the official hosted editor and requires outbound network access.

## Deploy on Vercel

1. Import this GitHub repository as a Next.js project.
2. Use Node.js 22 or newer; enable Fluid Compute if available.
3. Set MCP_API_TOKEN to a long random value to require bearer authentication on /mcp.
4. Set ICON_API_TOKEN to protect the browser-heavy /api/icons/edit endpoint.
5. Keep SVG_EDIT_URL at its official default unless you intentionally configure a trusted compatible build.

The Playwright call can take tens of seconds because it starts Chromium and loads a remote editor. Verify serverless duration and memory limits on the selected plan.

## Security notes

SVG input is limited to 250 KB, parsed as XML, and sanitized with a restricted element/attribute allowlist. Script elements, event handlers, external links, entity declarations, and embedded HTML are rejected or stripped. This is defense-in-depth, not a guarantee that all malicious SVGs are harmless. The browser tool only accepts the official SVG-Edit hosts; do not broaden this allowlist for arbitrary URLs.

Static findings are advisory. The tools do not claim a Flutter build or device test succeeded unless that work was actually run.
