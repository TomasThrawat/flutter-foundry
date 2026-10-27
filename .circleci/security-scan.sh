#!/usr/bin/env bash
set -Eeuo pipefail

# Free/open-source security gate for Flutter Foundry; no paid API keys are used.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BIN_DIR="${HOME}/.local/bin"
CACHE_DIR="${HOME}/.cache/flutter-foundry-security"
mkdir -p "$BIN_DIR" "$CACHE_DIR"
export PATH="$BIN_DIR:$PATH"

TRIVY_VERSION="0.74.0"
GITLEAKS_VERSION="8.30.1"
OSV_SCANNER_VERSION="2.7.0"
SEMGREP_VERSION="1.180.0"
GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) ;;
  *) echo "Unsupported host: $(uname -s) $(uname -m); Linux x86_64 is required." >&2; exit 2 ;;
esac
for dep in curl tar sha256sum python3 npm; do command -v "$dep" >/dev/null; done

# Create a lockfile only in the disposable CI checkout when none exists.
if [[ -f package.json && ! -f package-lock.json && ! -f npm-shrinkwrap.json && ! -f pnpm-lock.yaml && ! -f yarn.lock ]]; then
  echo "No lockfile found; resolving one in the temporary checkout for dependency scanning."
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Installing Trivy v${TRIVY_VERSION} and verifying the upstream checksum."
TRIVY_ASSET="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/${TRIVY_ASSET}" -o "$TMP_DIR/$TRIVY_ASSET"
curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_checksums.txt" -o "$TMP_DIR/trivy-checksums.txt"
(cd "$TMP_DIR" && grep -F "$TRIVY_ASSET" trivy-checksums.txt | sha256sum -c -)
tar -xzf "$TMP_DIR/$TRIVY_ASSET" -C "$TMP_DIR" trivy
install -m 0755 "$TMP_DIR/trivy" "$BIN_DIR/trivy"

echo "Installing Gitleaks v${GITLEAKS_VERSION} and verifying the upstream SHA-256."
GITLEAKS_ASSET="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_ASSET}" -o "$TMP_DIR/$GITLEAKS_ASSET"
(cd "$TMP_DIR" && printf '%s  %s\n' "$GITLEAKS_SHA256" "$GITLEAKS_ASSET" | sha256sum -c -)
tar -xzf "$TMP_DIR/$GITLEAKS_ASSET" -C "$TMP_DIR" gitleaks
install -m 0755 "$TMP_DIR/gitleaks" "$BIN_DIR/gitleaks"

echo "Installing OSV-Scanner v${OSV_SCANNER_VERSION} from Google's official release."
curl -fsSL "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" -o "$BIN_DIR/osv-scanner"
chmod 0755 "$BIN_DIR/osv-scanner"
test -s "$BIN_DIR/osv-scanner"

echo "Installing Semgrep Community CLI v${SEMGREP_VERSION} in an isolated Python venv."
python3 -m venv "$TMP_DIR/semgrep-venv"
"$TMP_DIR/semgrep-venv/bin/python" -m pip install --disable-pip-version-check "semgrep==${SEMGREP_VERSION}"
SEMGREP="$TMP_DIR/semgrep-venv/bin/semgrep"

echo
echo "=== Scanner versions ==="
"$BIN_DIR/trivy" --version
"$BIN_DIR/gitleaks" version
"$BIN_DIR/osv-scanner" --version
"$SEMGREP" --version

FAILED=0
run_check() {
  local name="$1"; shift
  echo
  echo "=== $name ==="
  if "$@"; then
    echo "PASS: $name"
  else
    local rc=$?
    echo "FAIL: $name (exit $rc)"
    FAILED=1
  fi
}

run_check "Trivy: HIGH/CRITICAL dependency, configuration, and secret findings" \
  "$BIN_DIR/trivy" fs --cache-dir "$CACHE_DIR/trivy" \
  --skip-dirs node_modules --skip-dirs .next \
  --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --exit-code 1 --no-progress .

run_check "Gitleaks: committed secrets" \
  "$BIN_DIR/gitleaks" git --redact --exit-code 1 --no-banner .

run_check "Semgrep Community: security-audit ERROR findings" \
  "$SEMGREP" scan --config p/security-audit --severity ERROR --error --metrics=off \
  --exclude node_modules --exclude .next .

run_check "OSV-Scanner: dependency vulnerabilities" \
  "$BIN_DIR/osv-scanner" scan source --recursive .

if [[ "$FAILED" -ne 0 ]]; then
  echo
  echo "Security gate failed; review all scanner results above."
  exit 1
fi
echo
echo "All four scanners completed without blocking findings."
