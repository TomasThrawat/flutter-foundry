# Audit Engine Scans

The workflow at `.github/workflows/audit-engines.yml` runs the repository audit scanners on pushes to `main` and supports manual runs with `workflow_dispatch`.

## Run manually

Open the repository's **Actions** tab, select **Audit Engine Scans**, choose **Run workflow**, and select `main`.

## Reports

Each run uploads an `audit-report-<run-id>.zip` artifact. It contains `summary.md`, `results.tsv`, and scanner-specific logs and reports.

## Skipped scanners

A scanner marked `SKIPPED` did not run; this is not the same as a clean pass. For example, OSV-Scanner needs a supported lockfile or SBOM, and Ruff needs Python source files. Review the report to decide whether the project should contain those inputs.
