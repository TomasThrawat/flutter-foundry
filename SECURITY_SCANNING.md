# Flutter Foundry security scanning

Flutter Foundry's active CI workflow installs and runs four free/open-source scanners:

- **Trivy 0.76.2** checks dependencies and repository configuration for HIGH/CRITICAL vulnerabilities and misconfigurations when supported files are present.
- **Gitleaks 8.30.1** scans checked-out Git history for committed credentials with redacted findings.
- **Semgrep Community CLI 1.182.1** runs the public `p/security-audit` rules and blocks on ERROR-severity findings.
- **OSV-Scanner 2.7.0** checks supported dependency lockfiles and SBOMs against the public OSV vulnerability database.

## Execution order

The active GitHub Actions workflow is `.github/workflows/ci.yml`. The `security-scan` job downloads pinned scanner releases, verifies Trivy and Gitleaks with official release checksum files, then runs all four scanners. The existing `checks` and `svg-edit-browser` jobs depend on `security-scan`, so tests, the production build, and browser tests do not start until scans pass.

This repository commits `package-lock.json` (lockfile version 3). It is generated with Node 24/npm 11 and the same `--legacy-peer-deps` resolver flag used during installation. The scanner reads this committed lockfile; it does not create or scan a temporary dependency resolution. `security-scan.sh` fails closed when the manifest or lockfile is missing, so OSV-Scanner cannot silently skip the JavaScript dependency graph.

The `checks` and `svg-edit-browser` GitHub Actions jobs use `npm ci --legacy-peer-deps` with a fresh per-job npm cache. The legacy peer flag is retained because plain npm peer resolution reports `@modelcontextprotocol/server@undefined` while resolving its peer dependency with `mcp-handler@2.3.0`. The same flag is used when generating the committed lockfile and when running `npm ci`, keeping the dependency tree reproducible. This compatibility workaround is not proof of application correctness: typechecking, dependency audit, tests, lint, production build, and Playwright still have to pass.

Scanner CLIs install in a writable per-job temporary directory. No paid API credentials are used. Network access is needed for release downloads, public Semgrep rules, and vulnerability data. Scanner binaries are not installed in the deployed Vercel runtime.

Run the scanner on Linux x86_64 with curl, tar, sha256sum, Python 3 with venv, Node/npm, Docker, and network access:

```bash
bash .github/scripts/security-scan.sh
```

Review findings and fix them rather than adding broad ignores. Each scanner and rule pack remains subject to its upstream license and terms.

**Deployment note:** the scanner gate blocks test/build jobs in the GitHub Actions workflow. It does not independently block a separate Vercel deployment unless deployment policy requires the relevant CI check.


## Public API request boundaries

- The icon pipeline caps JSON request bodies at 9 MiB to accommodate the bounded raster-import payload; the browser SVG-Edit endpoint caps them at 300 KiB.

- The two expensive icon endpoints apply a best-effort per-process rate limit keyed from proxy client-address headers when present. Serverless instances do not share this memory, and requests without an address header cannot be bucketed. This is an abuse backstop, not a global rate limiter or an authentication boundary; use gateway/provider limits for production.

- Optional ICON_API_TOKEN protection remains available for deployments that choose authenticated browser processing. The endpoints remain no-auth when the variable is unset.
