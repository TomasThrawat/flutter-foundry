#!/usr/bin/env bash
set -uo pipefail
TARGET_DIR="${1:-target}"
ENGINE="${AUDIT_ENGINE:-all}"
REPORT_DIR="$RUNNER_TEMP/flutter-foundry-audit-reports"
SUMMARY_FILE="$REPORT_DIR/results.tsv"
mkdir -p "$REPORT_DIR"
: > "$SUMMARY_FILE"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Target directory does not exist: $TARGET_DIR" >&2
  exit 2
fi

run_scan() {
  local name="$1"
  shift
  local log="$REPORT_DIR/$name.log"
  local code=0
  printf 'Running %s...\n' "$name"
  "$@" >"$log" 2>&1 || code=$?
  printf '%s\t%s\n' "$name" "$code" >> "$SUMMARY_FILE"
  if [[ "$code" -eq 0 ]]; then
    printf '%s completed (exit 0).\n' "$name"
  else
    printf '%s exited %s. This can mean findings or scanner/setup problems; inspect its report.\n' "$name" "$code"
  fi
  return 0
}

run_scan_json() {
  local name="$1"
  local report="$2"
  shift 2
  local log="$REPORT_DIR/$name.log"
  local code=0
  printf 'Running %s...\n' "$name"
  "$@" >"$report" 2>"$log" || code=$?
  printf '%s\t%s\n' "$name" "$code" >> "$SUMMARY_FILE"
  if [[ "$code" -eq 0 ]]; then
    printf '%s completed (exit 0).\n' "$name"
  else
    printf '%s exited %s. This can mean findings or scanner/setup problems; inspect %s and %s.\n' "$name" "$code" "$report" "$log"
  fi
  return 0
}

should_run() { [[ "$ENGINE" == "all" || "$ENGINE" == "$1" ]]; }

if should_run trivy; then
  run_scan trivy docker run --rm \
    -v "$PWD/$TARGET_DIR:/src:ro" \
    -v "$REPORT_DIR:/out" \
    aquasec/trivy:latest fs --scanners vuln,misconfig --skip-dirs .git \
    --format json --output /out/trivy.json /src
fi

if should_run gitleaks; then
  run_scan gitleaks docker run --rm \
    -v "$PWD/$TARGET_DIR:/src:ro" \
    -v "$REPORT_DIR:/out" \
    ghcr.io/gitleaks/gitleaks:v8.30.1 dir \
    --redact --report-format json --report-path /out/gitleaks.json /src
fi

if should_run semgrep; then
  run_scan semgrep docker run --rm \
    -v "$PWD/$TARGET_DIR:/src:ro" \
    -v "$REPORT_DIR:/out" \
    semgrep/semgrep:latest semgrep scan --config auto --json \
    --output /out/semgrep.json /src
fi

if should_run osv-scanner; then
  if find "$TARGET_DIR" -type f \( \
    -name 'package-lock.json' -o -name 'pnpm-lock.yaml' -o -name 'yarn.lock' -o \
    -name 'Cargo.lock' -o -name 'go.sum' -o -name 'go.mod' -o \
    -name 'poetry.lock' -o -name 'Pipfile.lock' -o -name 'requirements*.txt' -o \
    -name 'Gemfile.lock' -o -name 'composer.lock' -o -name 'pubspec.lock' -o \
    -name 'mix.lock' -o -name 'pom.xml' -o -name 'gradle.lockfile' -o \
    -name '*.spdx' -o -name '*.spdx.json' -o -name '*.cdx.json' -o \
    -name 'bom.json' -o -name 'bom.xml' \) -print -quit | grep -q .; then
    run_scan_json osv-scanner "$REPORT_DIR/osv-scanner.json" docker run --rm \
      -v "$PWD/$TARGET_DIR:/src:ro" \
      -v "$REPORT_DIR:/out" \
      ghcr.io/google/osv-scanner:v2.3.3 scan source -r /src --format json
  else
    printf 'osv-scanner\\tSKIPPED\\n' >> "$SUMMARY_FILE"
    printf '{"status":"skipped","reason":"No supported lockfile or SBOM was found."}\\n' > "$REPORT_DIR/osv-scanner.json"
    echo "Skipped: no supported lockfile or SBOM was found; package.json alone does not pin resolved dependency versions." > "$REPORT_DIR/osv-scanner.log"
  fi
fi

if should_run zizmor; then
  if [[ -d "$TARGET_DIR/.github/workflows" ]]; then
    pipx install zizmor >/dev/null 2>&1 || true
    if command -v zizmor >/dev/null 2>&1; then
      run_scan zizmor zizmor "$TARGET_DIR/.github/workflows"
    else
      printf 'zizmor\t127\n' >> "$SUMMARY_FILE"
      echo "zizmor could not be installed via pipx." > "$REPORT_DIR/zizmor.log"
    fi
  else
    printf 'zizmor\t0\n' >> "$SUMMARY_FILE"
    echo "No .github/workflows directory found; zizmor skipped." > "$REPORT_DIR/zizmor.log"
  fi
fi

if should_run ruff; then
  if find "$TARGET_DIR" -type f -name '*.py' -print -quit | grep -q .; then
    pipx install ruff >/dev/null 2>&1 || true
    if command -v ruff >/dev/null 2>&1; then
      run_scan_json ruff "$REPORT_DIR/ruff.json" ruff check --output-format=json "$TARGET_DIR"
    else
      printf 'ruff\t127\n' >> "$SUMMARY_FILE"
      echo "ruff could not be installed via pipx." > "$REPORT_DIR/ruff.log"
    fi
  else
    printf 'ruff\t0\n' >> "$SUMMARY_FILE"
    echo "No Python files found; ruff skipped." > "$REPORT_DIR/ruff.log"
  fi
fi

if should_run shellcheck; then
  if find "$TARGET_DIR" -type f -name '*.sh' -print -quit | grep -q .; then
    sudo apt-get update >/dev/null 2>&1 && sudo apt-get install --yes shellcheck >/dev/null 2>&1
    mapfile -d '' files < <(find "$TARGET_DIR" -type f -name '*.sh' -print0)
    if command -v shellcheck >/dev/null 2>&1; then
      run_scan_json shellcheck "$REPORT_DIR/shellcheck.json" shellcheck -f json "${files[@]}"
    else
      printf 'shellcheck\t127\n' >> "$SUMMARY_FILE"
      echo "shellcheck could not be installed." > "$REPORT_DIR/shellcheck.log"
    fi
  else
    printf 'shellcheck\t0\n' >> "$SUMMARY_FILE"
    echo "No shell scripts found; ShellCheck skipped." > "$REPORT_DIR/shellcheck.log"
  fi
fi

if should_run biome; then
  if find "$TARGET_DIR" -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.css' \) -print -quit | grep -q .; then
    run_scan_json biome "$REPORT_DIR/biome.json" npm exec --yes --package=@biomejs/biome -- biome check "$TARGET_DIR" --reporter=json
  else
    printf 'biome\t0\n' >> "$SUMMARY_FILE"
    echo "No supported JS/TS/JSON/CSS files found; Biome skipped." > "$REPORT_DIR/biome.log"
  fi
fi

python3 - "$SUMMARY_FILE" "$REPORT_DIR" "$TARGET_REPOSITORY" "$TARGET_REF" "$ENGINE" > "$REPORT_DIR/summary.md" <<'PY'
import json, os, sys
summary_file, report_dir, repository, ref, engine = sys.argv[1:]
def read_json(name):
    try:
        with open(os.path.join(report_dir, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None
rows = []
with open(summary_file, encoding="utf-8") as f:
    for line in f:
        fields = line.rstrip("\n").split("\t", 1)
        if len(fields) == 2:
            rows.append(fields)
details = {}
trivy = read_json("trivy.json")
if isinstance(trivy, dict):
    results = trivy.get("Results") or []
    vulns = sum(len(r.get("Vulnerabilities") or []) for r in results if isinstance(r, dict))
    misconfigs = sum(len(r.get("Misconfigurations") or []) for r in results if isinstance(r, dict))
    details["trivy"] = f"{vulns} vulnerabilities; {misconfigs} misconfigurations"
gitleaks = read_json("gitleaks.json")
if isinstance(gitleaks, list):
    details["gitleaks"] = f"{len(gitleaks)} secret findings"
semgrep = read_json("semgrep.json")
semgrep_parser_errors = 0
if isinstance(semgrep, dict):
    findings = len(semgrep.get("results") or [])
    errors = semgrep.get("errors") or []
    semgrep_parser_errors = len(errors)
    details["semgrep"] = f"{findings} findings; {len(errors)} scan/parser diagnostics"
osv = read_json("osv-scanner.json")
if isinstance(osv, dict) and osv.get("status") == "skipped":
    details["osv-scanner"] = "skipped: no supported lockfile/SBOM"
elif isinstance(osv, dict):
    details["osv-scanner"] = "report generated; inspect JSON for package vulnerability details"
biome = read_json("biome.json")
biome_errors = 0
if isinstance(biome, dict):
    stat = biome.get("summary") or {}
    biome_errors = int(stat.get("errors") or 0)
    warnings = int(stat.get("warnings") or 0)
    details["biome"] = f"{biome_errors} errors; {warnings} warnings"
for name in ("ruff", "shellcheck"):
    data = read_json(name + ".json")
    if isinstance(data, list):
        details[name] = f"{len(data)} diagnostics"
    elif data is not None:
        details[name] = "machine-readable report generated"
with open(os.path.join(report_dir, "summary.md"), "a", encoding="utf-8") as f:
    f.write("# Audit report\n\n")
    f.write(f"- Target: {repository}@{ref}\n")
    f.write(f"- Engine selection: {engine}\n")
    f.write("- The workflow scans files without running target build scripts or dependency-install scripts.\n")
    f.write("- Exit codes are not vulnerability verdicts; review scanner reports and diagnostic logs.\n\n")
    f.write("| Scanner | Exit code/status | Summary |\n|---|---:|---|\n")
    for name, code in rows:
        if code == "SKIPPED":
            status = "SKIPPED"
        elif code != "0":
            status = "non-zero (inspect report)"
        elif name == "semgrep" and semgrep_parser_errors:
            status = "partial scan (parser diagnostics)"
        elif name == "biome" and biome_errors:
            status = "lint diagnostics"
        else:
            status = "command completed"
        detail = details.get(name, "see log/artifact")
        f.write(f"| {name} | {status} | {detail} |\n")
    f.write("\nInspect the individual JSON and log files for full details.\n")
PY

cat "$REPORT_DIR/summary.md" >> "$GITHUB_STEP_SUMMARY"

echo "Audit complete. Detailed logs and reports are in $REPORT_DIR."
exit 0
