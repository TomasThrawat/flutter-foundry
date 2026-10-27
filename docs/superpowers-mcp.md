# Superpowers MCP integration

Flutter Foundry now exposes the upstream [obra/superpowers](https://github.com/obra/superpowers) skills as MCP tools.

## Endpoints

- Main Flutter Foundry MCP: /mcp (includes these tools alongside the existing Flutter and security tools).
- Standalone Superpowers-only MCP: /api/superpowers-mcp.

Both endpoints are intentionally no-auth: requests to /mcp and /api/superpowers-mcp do not require an Authorization header or token. Anyone who can reach a public deployment can use the tools; do not send private or sensitive data to these endpoints.

## Tools

- superpowers_list_skills: list the official skill catalog and source URLs.
- superpowers_use_skill: fetch a complete SKILL.md for a selected skill.
- superpowers_get_skill_file: read supporting files inside an allowlisted skill directory.
- superpowers_search_skills: search skill names and descriptions; this is lexical metadata search, not vector/embedding search.
- superpowers_compose_workflow: suggest an ordered skill sequence for a goal.
- superpowers_validate_workflow: report missing recommended workflow guardrails.

## Upstream source and safety

- Upstream repository: https://github.com/obra/superpowers
- Upstream license: MIT (see https://github.com/obra/superpowers/blob/main/LICENSE).
- Source is pinned to commit 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b (Superpowers v7.0.1), so a deployment does not silently change behavior when upstream main moves.
- Skill content is fetched only from raw.githubusercontent.com/obra/superpowers at that pinned commit. Supporting-file access checks the requested path against the pinned Git tree; arbitrary URLs, traversal paths, repo writes, shell execution, and automatic code edits are not exposed.
- Fetches use a 10-second timeout. The service needs outbound network access to read skill content. The tool does not execute instructions from the skill; the connected MCP client decides how to use the returned text.
- The catalog contains concise descriptions authored for discovery; the full official instructions are returned by superpowers_use_skill or superpowers_get_skill_file.

## Verification

The unit suite covers the pinned catalog, upstream skill retrieval, path traversal rejection, tree allowlisting, search, workflow composition/validation, and tool registration. Existing project CI also runs TypeScript typechecking, lint, production build, security scanners, and the SVG-Edit browser test.
