# On-demand Flutter Project CI

Flutter Foundry includes .github/workflows/flutter-project-ci.yml for active public GitHub Flutter repositories.

## What it runs

1. Validates the target repository, branch/tag/commit, and public/non-archived status.
2. Checks out the target with persisted Git credentials disabled.
3. Installs the selected Flutter channel (stable, beta, or main).
4. Runs flutter pub get and flutter analyze --no-pub.
5. Runs flutter test --no-pub --coverage when Dart test files exist.
6. Builds flutter build apk --release --no-pub.
7. Uploads the APK, coverage/lcov.info when generated, and pubspec.lock as a GitHub Actions artifact.

The workflow is dispatched manually, so it does not consume runner minutes on every push to Flutter Foundry. It accepts active public repositories only. Target build scripts run on an ephemeral GitHub-hosted runner without persisted checkout credentials or target-specific secrets. Review an untrusted project's source before requesting a build.

## Trigger from GitHub

Open Actions → Flutter Project CI → Run workflow, then provide owner/repository, the branch/tag/commit, and the Flutter channel. Download the flutter-ci-<run-id> artifact after the workflow completes.

## Trigger from MCP

The flutter_run_github_project_ci tool dispatches the same workflow. It requires GITHUB_AUDIT_TOKEN in the Vercel Production environment, scoped to this repository with Actions read/write and Contents read. The MCP endpoint itself remains unauthenticated; the token is used server-side only to dispatch the workflow and read its run status. The MCP tool limits dispatches to 6 per hour.

## Current limitations

- Only active public GitHub repositories are accepted.
- The workflow builds an Android release APK; it does not sign the APK with a user-owned release key.
- It does not publish the target project's APK as a GitHub Release or modify the target repository.
- Projects without Dart test files skip flutter test; that skip is recorded in the workflow log.
