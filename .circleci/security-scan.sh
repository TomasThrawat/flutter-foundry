#!/usr/bin/env bash
set -Eeuo pipefail

# Free/open-source security gate for Flutter Foundry; no paid API keys are used.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) ;;
  *) echo "Unsupported host: $(uname -s) $(uname -m); Linux x86_64 is required." >&2; exit 2 ;;
esac
for dep in curl tar sha256sum python3 npm; do command -v "$dep" >/dev/null; done

# OSV-Scanner and Trivy need resolved JavaScript versions. Generate a temporary
# lockfile only in this disposable CI checkout if the repository has no lockfile.
# The legacy peer flag avoids the repository's existing peer-resolution conflict;
# it does not change package.json or commit a generated lockfile.
if [[ -f package.json && ! -f package-lock.json && ! -f npm-shrinkwrap.json && ! -f pnpm-lock.yaml && ! -f yarn.lock ]]; then
  echo "No npm lockfile found; generating a CI-only lockfile for dependency scanning."
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps
fi

# Install tools and cache into a writable per-job temporary directory.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
CACHE_DIR="$TMP_DIR/cache"
mkdir -p "$BIN_DIR" "$CACHE_DIR"
export PATH="$BIN_DIR:$PATH"

TRIVY_VERSION="0.74.0"
GITLEAKS_VERSION="8.30.1"
OSV_SCANNER_VERSION="2.7.0"
SEMGREP_VERSION="1.180.0"

echo "Installing Trivy v${TRIVY_VERSION} and verifying the checksum published with its release."
TRIVY_ASSET="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/${TRIVY_ASSET}" -o "$TMP_DIR/$TRIVY_ASSET"
curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_checksums.txt" -o "$TMP_DIR/trivy-checksums.txt"
(cd "$TMP_DIR" && grep -F "$TRIVY_ASSET" trivy-checksums.txt | sha256sum -c -)
tar -xzf "$TMP_DIR/$TRIVY_ASSET" -C "$TMP_DIR" trivy
install -m 0755 "$TMP_DIR/trivy" "$BIN_DIR/trivy"

echo "Installing Gitleaks v${GITLEAKS_VERSION} and verifying its official checksum."
GITLEAKS_ASSET="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
GITLEAKS_CHECKSUMS="gitleaks_${GITLEAKS_VERSION}_checksums.txt"
curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_ASSET}" -o "$TMP_DIR/$GITLEAKS_ASSET"
curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_CHECKSUMS}" -o "$TMP_DIR/$GITLEAKS_CHECKSUMS"
(cd "$TMP_DIR" && grep -F "$GITLEAKS_ASSET" "$GITLEAKS_CHECKSUMS" | sha256sum -c -)
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

run_check "Trivy: HIGH/CRITICAL dependency vulnerabilities and misconfigurations" \
  "$BIN_DIR/trivy" fs --cache-dir "$CACHE_DIR/trivy" \
  --skip-dirs node_modules --skip-dirs .next \
  --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 --no-progress .

run_check "Gitleaks: committed secrets (redacted output)" \
  "$BIN_DIR/gitleaks" git --redact --exit-code 1 --no-banner .

run_check "Semgrep Community: security-audit ERROR findings" \
  "$SEMGREP" scan --config p/security-audit --severity ERROR --error --metrics=off \
  --exclude node_modules --exclude .next .

run_check "OSV-Scanner: dependency vulnerabilities" \
  "$BIN_DIR/osv-scanner" scan source --recursive .

if [[ "$FAILED" -ne 0 ]]; then
  echo
  echo "Security gate failed; review each scanner's output above."
  exit 1
fi

echo
echo "All four scanners completed without blocking findings."
