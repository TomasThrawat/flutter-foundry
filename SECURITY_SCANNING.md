# Flutter Foundry security scanning

Flutter Foundry's active CI workflow installs and runs four free/open-source scanners:

- **Trivy 0.74.0** checks the repository filesystem for HIGH/CRITICAL dependency vulnerabilities and misconfigurations.
- **Gitleaks 8.30.1** scans the checked-out Git history for committed credentials and redacts secret findings.
- **Semgrep Community CLI 1.180.0** runs the public `p/security-audit` rules and blocks on ERROR-severity findings.
- **OSV-Scanner 2.7.0** checks supported dependency manifests, lockfiles, and SBOMs against the public OSV vulnerability database.

## Execution order

The active CircleCI pipeline definition uses `.github/workflows/ci.yml`. The `security-scan` job downloads pinned scanner releases and verifies Trivy and Gitleaks using checksum files published alongside the official releases. It then runs all four scanners. Existing `checks` and `svg-edit-browser` jobs depend on `security-scan`, so tests, production build, and browser tests do not start if a scanner reports a blocking finding.

The scanner job does not attempt to generate or modify a lockfile. This is intentional: resolving a lockfile via npm had failed in CI due to an existing dependency-tree conflict before any scanner could run. OSV-Scanner can inspect `package.json` manifests, but manifest-only results are best-effort and less exact than results from a resolved lockfile; version ranges are not the same as installed versions. Adding and maintaining a committed lockfile is the stronger long-term dependency-scanning setup.

The CI worker is ephemeral; no paid API credentials are used. Network access is needed for release downloads, Semgrep's public rules, and vulnerability data. The workflow does not install scanner binaries into the deployed Vercel runtime.

For manual use on Linux x86_64 with curl, tar, sha256sum, Python 3 with venv, and network access:

```bash
bash .circleci/security-scan.sh
```

Each scanner prints its results to CI logs. Review findings and fix them instead of adding broad ignores. Upstream licenses and rule-pack terms still apply.

**Deployment note:** the gate blocks test/build jobs in the CircleCI workflow. It does not independently block a separate Vercel deployment unless deployment policy requires the relevant CI check.
