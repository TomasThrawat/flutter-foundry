# Architecture
- Next.js hosts the landing page, SVG workspace, health endpoint, and stateless MCP endpoint.
- MCP tools use deterministic analysis functions, live pub.dev package metadata, and OSV vulnerability data.
- SVG processing sanitizes user markup, launches Playwright Chromium, opens the trusted upstream SVG-Edit deployment, imports markup through SVG-Edit's own editor API, serializes the canvas and captures a PNG.
- Vercel uses @sparticuz/chromium; local development uses installed Playwright Chromium.
- The browser endpoint may take tens of seconds; verify runtime duration and memory limits for the deployment plan.
- MCP bearer auth and icon API bearer auth are optional environment variables and should be enabled for public deployment.
- Static accessibility/Android findings are heuristics; OSV checks exact versions supplied by the caller.
- No Flutter build or arbitrary Git mutation is executed by an MCP tool.

- MCP also registers a unified audit module with an engine catalog, local CLI status probes, source-text heuristics and allowlisted scanner adapters. Native scanner binaries are not bundled into Vercel.
- Audit subprocesses use fixed arguments without a shell and are restricted to AUDIT_ALLOWED_ROOTS. Output is bounded and sanitized before returning to MCP clients.
