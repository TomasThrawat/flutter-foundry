# Audit Engine Scans

The workflow at `.github/workflows/audit-engines.yml` runs the repository audit scanners on pushes to `main` and supports manual runs with `workflow_dispatch`.

## Run manually

Open the repository's **Actions** tab, select **Audit Engine Scans**, choose **Run workflow**, and select `main`.

## Reports

Each run uploads an `audit-report-<run-id>.zip` artifact. It contains `summary.md`, `results.tsv`, and scanner-specific logs and reports.

## Skipped scanners

A scanner marked `SKIPPED` did not run; this is not the same as a clean pass. For example, OSV-Scanner needs a supported lockfile or SBOM, and Ruff needs Python source files. Review the report to decide whether the project should contain those inputs.

## Local Flutter analyzer

flutter-analyze is a fixed, read-only CLI adapter. It runs flutter analyze --no-pub only when:

- The host has a Flutter SDK on PATH.

- The selected project resolves inside AUDIT_ALLOWED_ROOTS.

- The selected project root contains pubspec.yaml.

It does not invoke pub get, run tests or builds, or accept arbitrary CLI arguments. Vercel does not bundle the Flutter SDK; its engine status is therefore not_installed unless a separate host explicitly provides Flutter.
