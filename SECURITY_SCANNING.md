# Security scanning in Flutter Foundry

The CircleCI workflow adds four free/open-source scanners:

- **Trivy** checks the repository filesystem for HIGH/CRITICAL dependency vulnerabilities, misconfigurations, and secrets.
- **Gitleaks** checks the checked-out Git history for committed credentials.
- **Semgrep Community CLI** runs the public `p/security-audit` rules and blocks on ERROR-severity findings.
- **OSV-Scanner** checks dependency manifests and lockfiles against the public OSV vulnerability database.

## Gate behavior

`.circleci/security-scan.sh` downloads pinned upstream releases into the ephemeral CI environment. It verifies Trivy against the checksum file published for its official release and verifies Gitleaks against its published SHA-256. Semgrep is installed in a temporary Python virtual environment. No paid API credentials are required.

The workflow runs security scanning first. The Node lint, typecheck, test, and production-build job runs only when the security job succeeds. Every scanner is attempted even if another scanner reports findings, so the logs can show all results.

Run on Linux x86_64 with curl, tar, sha256sum, Python 3 with venv, and Node/npm:

```bash
bash .circleci/security-scan.sh
```

Network access is needed for scanner downloads, vulnerability databases, and Semgrep's public rules. Results are printed to the CI log. Review findings rather than adding broad ignores. The upstream licenses and terms of each scanner and ruleset apply.

**Activation note:** this commit adds CircleCI configuration to the repository, but CircleCI must have the repository enabled as a project before pushes will run it. The connected CircleCI account did not currently recognize this repository, so an actual CircleCI run cannot be claimed yet.
