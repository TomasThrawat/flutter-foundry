# Flutter Foundry security scanning

Flutter Foundry's active CI workflow installs and runs four free/open-source scanners:

- **Trivy 0.74.0** checks dependencies and repository configuration for HIGH/CRITICAL vulnerabilities and misconfigurations when supported dependency files are present.
- **Gitleaks 8.30.1** scans the checked-out Git history for committed credentials and redacts secret findings.
- **Semgrep Community CLI 1.180.0** runs public `p/security-audit` rules and blocks on ERROR-severity findings.
- **OSV-Scanner 2.7.0** checks supported dependency lockfiles and SBOMs against the public OSV vulnerability database.

## Execution order

The active CircleCI pipeline definition uses `.github/workflows/ci.yml`. The `security-scan` job downloads pinned scanner releases, verifies Trivy and Gitleaks using official release checksum files, then runs all four scanners. Existing `checks` and `svg-edit-browser` jobs depend on `security-scan`, so tests, production build, and browser tests do not start if a scanner reports a blocking finding.

This repository currently lacks an npm lockfile. For the security job only, the script generates `package-lock.json` in CircleCI's disposable checkout using `--package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps`, then scans that resolved dependency tree. The generated file is not committed and does not modify `package.json`. The compatibility flag is needed because plain lockfile generation encounters an existing npm peer-resolution conflict; it does not fix or conceal that underlying dependency issue in the application. The regular test/build job remains responsible for proving the actual application install and build work.

The tools install into a writable per-job temporary directory; no paid API credentials are used. Network access is needed for release downloads, Semgrep's public rules, and vulnerability data. The workflow does not install scanner binaries into the deployed Vercel runtime.

For manual use on Linux x86_64 with curl, tar, sha256sum, Python 3 with venv, Node/npm, and network access:

```bash
bash .circleci/security-scan.sh
```

Each scanner prints its results to CI logs. Review findings and fix them instead of adding broad ignores. Upstream licenses and rule-pack terms still apply.

**Deployment note:** the gate blocks test/build jobs in the CircleCI workflow. It does not independently block a separate Vercel deployment unless deployment policy requires the relevant CI check.
