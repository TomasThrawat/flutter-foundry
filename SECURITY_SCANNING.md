# Flutter Foundry security scanning

Flutter Foundry's active CI workflow installs and runs four free/open-source scanners:

- **Trivy 0.76.1** checks dependencies and repository configuration for HIGH/CRITICAL vulnerabilities and misconfigurations when supported files are present.
- **Gitleaks 8.30.1** scans checked-out Git history for committed credentials with redacted findings.
- **Semgrep Community CLI 1.182.1** runs the public `p/security-audit` rules and blocks on ERROR-severity findings.
- **OSV-Scanner 2.7.0** checks supported dependency lockfiles and SBOMs against the public OSV vulnerability database.

## Execution order

The active CircleCI pipeline definition consumes `.github/workflows/ci.yml`. The `security-scan` job downloads pinned scanner releases, verifies Trivy and Gitleaks with official release checksum files, then runs all four scanners. The existing `checks` and `svg-edit-browser` jobs depend on `security-scan`, so tests, the production build, and browser tests do not start until scans pass.

This repository has no committed npm lockfile. The scanner job generates a lockfile in CircleCI's disposable checkout with `--package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps`, using its own writable npm cache, then scans the resolved dependency tree. The generated file is not committed and `package.json` is not changed by this step.

The application and browser jobs use `npm install --legacy-peer-deps` with a fresh per-job npm cache because plain `npm install` currently reports `@modelcontextprotocol/server@undefined` while resolving its peer dependency with `mcp-handler@2.3.0`. The published ranges `^2.4.0` and `^2.0.0` are otherwise compatible, and the scanner's isolated lockfile generation succeeds with the same flag. This is a compatibility workaround, not proof of application correctness: typechecking, dependency audit, tests, lint, production build, and Playwright still have to pass.

Scanner CLIs install in a writable per-job temporary directory. No paid API credentials are used. Network access is needed for release downloads, public Semgrep rules, and vulnerability data. Scanner binaries are not installed in the deployed Vercel runtime.

Run the scanner on Linux x86_64 with curl, tar, sha256sum, Python 3 with venv, Node/npm, and network access:

```bash
bash .circleci/security-scan.sh
```

Review findings and fix them rather than adding broad ignores. Each scanner and rule pack remains subject to its upstream license and terms.

**Deployment note:** the scanner gate blocks test/build jobs in the CircleCI workflow. It does not independently block a separate Vercel deployment unless deployment policy requires the relevant CI check.