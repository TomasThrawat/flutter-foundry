# Flutter Foundry security scanning

Flutter Foundry's active CI workflow installs and runs four free/open-source scanners:

- **Trivy 0.74.0** checks repository dependencies and configuration for HIGH/CRITICAL vulnerabilities and misconfigurations.
- **Gitleaks 8.30.1** scans the checked-out Git history for committed credentials and redacts secret findings.
- **Semgrep Community CLI 1.180.0** runs the public `p/security-audit` rules and blocks on ERROR-severity findings.
- **OSV-Scanner 2.7.0** checks manifests and lockfiles against the public OSV vulnerability database.

## Execution order

The project’s active CircleCI pipeline definition uses `.github/workflows/ci.yml`. Its `security-scan` job downloads pinned scanner releases, verifies Trivy's published checksum and Gitleaks' release SHA-256, then runs all four scanners. The existing `checks` and `svg-edit-browser` jobs both depend on `security-scan`, so tests, production build, and browser tests are skipped if a scanner reports a blocking finding.

The checks run in an ephemeral CI worker. No paid API credentials are used; network access is needed to download releases, resolve Semgrep's public rules, and query vulnerability data. The workflow does not install native scanner binaries into the deployed Vercel serverless runtime.

For manual local/CI use on Linux x86_64 with curl, tar, sha256sum, Python 3 with venv, and Node/npm:

```bash
bash .circleci/security-scan.sh
```

Scanner reports appear in the job logs. Review findings and fix them rather than adding broad ignores. Upstream licenses and any rule-pack terms remain applicable.

**Deployment note:** this gates the test/build jobs in CircleCI. It does not automatically prevent Vercel from deploying from Git unless the Vercel/Git deployment policy is separately configured to require the relevant check.
