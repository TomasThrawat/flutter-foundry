# Flutter Foundry security scanning

Flutter Foundry includes four free/open-source security scanners:

- **Trivy** checks the repository filesystem for HIGH/CRITICAL dependency vulnerabilities and misconfigurations.
- **Gitleaks** checks the checked-out Git history for committed credentials and redacts finding output.
- **Semgrep Community CLI** runs the public `p/security-audit` rules and blocks on ERROR-severity findings.
- **OSV-Scanner** checks dependency manifests and lockfiles against the public OSV vulnerability database.

## CI integration

The shared script is `.circleci/security-scan.sh`.

- `.github/workflows/security-gate.yml` runs scanner checks first, then runs lint, typecheck, tests, and production build only when scans pass. Flutter Foundry's current CircleCI project is using CircleCI's GitHub Actions runner integration, which is why this workflow is included alongside the native configuration.
- `.circleci/config.yml` provides the equivalent sequence for a project using native CircleCI configuration.

The scanner script installs pinned upstream releases into the temporary CI worker. It verifies Trivy using the checksum file published with its official release and verifies Gitleaks using its upstream SHA-256. Semgrep runs in a temporary Python virtual environment. The pipeline needs network access to download scanners, Semgrep's public rules, and vulnerability databases. No paid API keys are used.

Run it manually from a Linux x86_64 checkout with curl, tar, sha256sum, Python 3 with venv, and Node/npm:

```bash
bash .circleci/security-scan.sh
```

The scanner job attempts all four scanners before failing the gate, so logs show each scanner's result. Findings should be reviewed and fixed rather than hidden with blanket ignores. Each scanner and Semgrep ruleset remains subject to its respective upstream license and terms.

**Deployment note:** a passing security workflow gates the test/build job inside that workflow. It does not automatically block Vercel's separate production deployment unless deployment protection or a required status check is configured to enforce it.
