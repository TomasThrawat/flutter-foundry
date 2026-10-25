#!/usr/bin/env bash
set -uo pipefail
TARGET_DIR="${1:-target}"
ENGINE="${AUDIT_ENGINE:-all}"
REPORT_DIR="$RUNNER_TEMP/flutter-foundry-audit-reports"
SUMMARY_FILE="$REPORT_DIR/results.tsv"
mkdir -p "$REPORT_DIR"
: > "$SUMMARY_FILE"
if [[ ! -d "$TARGET_DIR" ]]; then echo "Target directory does not exist: $TARGET_DIR" >&2; exit 2; fi
run_scan() {
  local name="$1"; shift
  local log="$REPORT_DIR/$name.log"; local code=0
  printf 'Running %s...\n' "$name"
  "$@" >"$log" 2>&1 || code=$?
  printf '%s\t%s\n' "$name" "$code" >> "$SUMMARY_FILE"
  if [[ "$code" -eq 0 ]]; then printf '%s completed (exit 0).\n' "$name"; else printf '%s exited %s. This can mean findings or scanner/setup problems; inspect its report.\n' "$name" "$code"; fi
  return 0
}
should_run() { [[ "$ENGINE" == "all" || "$ENGINE" == "$1" ]]; }
if should_run trivy; then run_scan trivy docker run --rm -v "$PWD/$TARGET_DIR:/src:ro" -v "$REPORT_DIR:/out" aquasec/trivy:latest fs --scanners vuln,misconfig --skip-dirs .git --format json --output /out/trivy.json /src; fi
if should_run gitleaks; then run_scan gitleaks docker run --rm -v "$PWD/$TARGET_DIR:/src:ro" -v "$REPORT_DIR:/out" ghcr.io/gitleaks/gitleaks:v8.30.1 dir --redact --report-format json --report-path /out/gitleaks.json /src; fi
if should_run semgrep; then run_scan semgrep docker run --rm -v "$PWD/$TARGET_DIR:/src:ro" -v "$REPORT_DIR:/out" semgrep/semgrep:latest scan --config auto --json --output /out/semgrep.json /src; fi
if should_run osv-scanner; then run_scan osv-scanner docker run --rm -v "$PWD/$TARGET_DIR:/src:ro" -v "$REPORT_DIR:/out" ghcr.io/google/osv-scanner:v2.3.3 scan source -r /src --format json --output-file /out/osv-scanner.json; fi
if should_run zizmor; then
  if [[ -d "$TARGET_DIR/.github/workflows" ]]; then
    pipx install zizmor >/dev/null 2>&1 || true
    if command -v zizmor >/dev/null 2>&1; then run_scan zizmor zizmor "$TARGET_DIR/.github/workflows"
    else printf 'zizmor\t127\n' >> "$SUMMARY_FILE"; echo "zizmor could not be installed via pipx." > "$REPORT_DIR/zizmor.log"; fi
  else printf 'zizmor\t0\n' >> "$SUMMARY_FILE"; echo "No .github/workflows directory found; zizmor skipped." > "$REPORT_DIR/zizmor.log"; fi
fi
if should_run ruff; then
  if find "$TARGET_DIR" -type f -name '*.py' -print -quit | grep -q .; then
    pipx install ruff >/dev/null 2>&1 || true
    if command -v ruff >/dev/null 2>&1; then run_scan ruff ruff check --output-format=json "$TARGET_DIR"
    else printf 'ruff\t127\n' >> "$SUMMARY_FILE"; echo "ruff could not be installed via pipx." > "$REPORT_DIR/ruff.log"; fi
  else printf 'ruff\t0\n' >> "$SUMMARY_FILE"; echo "No Python files found; ruff skipped." > "$REPORT_DIR/ruff.log"; fi
fi
if should_run shellcheck; then
  if find "$TARGET_DIR" -type f -name '*.sh' -print -quit | grep -q .; then
    sudo apt-get update >/dev/null 2>&1 && sudo apt-get install --yes shellcheck >/dev/null 2>&1
    mapfile -d '' files < <(find "$TARGET_DIR" -type f -name '*.sh' -print0)
    if command -v shellcheck >/dev/null 2>&1; then run_scan shellcheck shellcheck -f json "${files[@]}"
    else printf 'shellcheck\t127\n' >> "$SUMMARY_FILE"; echo "shellcheck could not be installed." > "$REPORT_DIR/shellcheck.log"; fi
  else printf 'shellcheck\t0\n' >> "$SUMMARY_FILE"; echo "No shell scripts found; ShellCheck skipped." > "$REPORT_DIR/shellcheck.log"; fi
fi
if should_run biome; then
  if find "$TARGET_DIR" -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.css' \) -print -quit | grep -q .; then run_scan biome npm exec --yes --package=@biomejs/biome -- biome check "$TARGET_DIR" --reporter=json
  else printf 'biome\t0\n' >> "$SUMMARY_FILE"; echo "No supported JS/TS/JSON/CSS files found; Biome skipped." > "$REPORT_DIR/biome.log"; fi
fi
{
  echo "# Audit report"; echo
  echo "- Target: $TARGET_REPOSITORY@$TARGET_REF"
  echo "- Engine selection: $ENGINE"
  echo "- Exit code 0 means the command completed; non-zero can mean findings or scanner/configuration problems."
  echo "- The workflow scans files and does not run target build scripts or package install scripts."
  echo; echo "| Scanner | Exit code |"; echo "|---|---:|"
  while IFS=$'\t' read -r name code; do [[ -n "${name:-}" ]] || continue; echo "| $name | $code |"; done < "$SUMMARY_FILE"
  echo; echo "Download the artifact for individual scanner logs and machine-readable reports."
} > "$REPORT_DIR/summary.md"
cat "$REPORT_DIR/summary.md" >> "$GITHUB_STEP_SUMMARY"
echo "Audit complete. Detailed logs and reports are in $REPORT_DIR."
exit 0