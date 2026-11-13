# Audit Engine Scans

The workflow at .github/workflows/audit-engines.yml runs security scanners on pull requests targeting main and supports manual runs with workflow_dispatch. A scanner execution error or non-zero scanner result now fails the workflow after its diagnostic artifact is uploaded. Trivy HIGH/CRITICAL findings block; MEDIUM findings are reported as non-blocking advisories.

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

## Dart duplication and fix preview

Two more read-only adapters target Dart/Flutter projects. Both are skipped unless the selected project root contains pubspec.yaml.

- `dart-fix-preview` runs the fixed command `dart fix --dry-run`. It only lists the analyzer fixes available (for example unused imports) and never modifies files; `--apply` is never used. Fixes appear only for lints enabled in `analysis_options.yaml`.
- `jscpd` runs a duplicate-code scan over `**/*.dart` with the console reporter only, so no report files are written. Generated `*.g.dart`, `*.freezed.dart`, `*.gr.dart` and `*.mocks.dart` files and `.dart_tool` and `build` folders are ignored. It reports duplication; it does not remove it.

`dart-code-linter` (`check-unused-files`, `check-unused-code`) is catalogued but not runnable by this server. It is started with `dart run`, which executes the project's own dev dependency, so run it yourself inside a project you trust.

## Version-pinned scanner execution

The repository security gate pins Trivy and Semgrep versions and uses digest-pinned Gitleaks and OSV-Scanner images. The external audit runner uses explicit versions for Trivy and Semgrep, plus digest-pinned Gitleaks and OSV-Scanner images. Scanner findings and execution errors fail the workflow after reports are written; SKIPPED remains distinct from a clean scan.

## Full project coverage

The CI pipeline keeps the focused icon coverage report and adds npm run test:coverage to report coverage across the loaded lib/*.ts modules.
