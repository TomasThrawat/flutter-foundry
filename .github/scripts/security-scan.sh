#!/usr/bin/env bash
set -Eeuo pipefail

# Free/open-source security gate for Flutter Foundry; no paid API keys are used.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

case "$(uname -s):$(uname -m)" in
 Linux:x86_64) ;;
 *) echo "Unsupported host: $(uname -s) $(uname -m); Linux x86_64 is required." >&2; exit 2 ;;
esac
for dep in curl tar sha256sum python3 npm; do command -v "$dep" >/dev/null; done

# Use per-job writable storage for all tools and npm cache. The runner's shared
# ~/.npm cache has produced EACCES/EEXIST failures when resolving the manifest.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
CACHE_DIR="$TMP_DIR/cache"
NPM_CACHE_DIR="$TMP_DIR/npm-cache"
mkdir -p "$BIN_DIR" "$CACHE_DIR" "$NPM_CACHE_DIR"

download_release_asset() {
  local url="$1"
  local destination="$2"
  curl --fail --show-error --location \
    --retry 5 --retry-delay 3 --retry-all-errors --retry-max-time 240 \
    --connect-timeout 20 --max-time 120 \
    "$url" -o "$destination"
}

export PATH="$BIN_DIR:$PATH"
export npm_config_cache="$NPM_CACHE_DIR"

# OSV-Scanner and Trivy need resolved JavaScript versions. Generate a temporary
# lockfile only in this disposable CI checkout if the repository has no lockfile.
# The legacy peer flag avoids the existing peer-resolution conflict; neither
# package.json nor a generated lockfile is committed by this job.
if [[ -f package.json && ! -f package-lock.json && ! -f npm-shrinkwrap.json && ! -f pnpm-lock.yaml && ! -f yarn.lock ]]; then
 echo "No npm lockfile found; generating a CI-only lockfile using a fresh, writable npm cache."
 npm install --package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps
fi

# Reject only minimatch releases covered by the current security advisory.
# Older 3.x consumers remain unchanged; affected releases are >=7 and <11.0.1.
node <<'NODE'
const fs = require('node:fs')
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const entries = Object.entries(lock.packages || {}).filter(([path]) =>
  path === 'node_modules/minimatch' || path.endsWith('/node_modules/minimatch')
)
if (entries.length === 0) {
  console.error('No minimatch entries found in package-lock.json; refusing an unverified dependency scan.')
  process.exit(1)
}
for (const [path, pkg] of entries) console.log(`minimatch ${pkg.version} at ${path}`)
const affected = entries.filter(([, pkg]) => {
  const [major, minor, patch] = String(pkg.version).split('.').map(Number)
  return major >= 7 && (major < 11 || (major === 11 && minor === 0 && patch < 1))
})
if (affected.length) {
  console.error('Vulnerable minimatch versions remain in package-lock.json')
  process.exit(1)
}
console.log('PASS: no advisory-affected minimatch versions in package-lock.json')
NODE

TRIVY_VERSION="0.76.2"
GITLEAKS_VERSION="8.30.1"
OSV_SCANNER_VERSION="2.7.0"
SEMGREP_VERSION="1.182.1"

echo "Installing Trivy v${TRIVY_VERSION} from the official signed Debian repository."
sudo apt-get install -y --no-install-recommends gnupg
download_release_asset "https://aquasecurity.github.io/trivy-repo/deb/public.key" "$TMP_DIR/trivy-repo-public.key"
sudo install -d -m 0755 /usr/share/keyrings
sudo gpg --dearmor --batch --yes --output /usr/share/keyrings/trivy.gpg "$TMP_DIR/trivy-repo-public.key"
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" | sudo tee /etc/apt/sources.list.d/trivy.list >/dev/null
sudo apt-get update
TRIVY_APT_VERSION="$(apt-cache policy trivy | awk '/Candidate:/ {print $2; exit}')"
case "$TRIVY_APT_VERSION" in
  "${TRIVY_VERSION}"|"${TRIVY_VERSION}"-*) ;;
  *)
    echo "ERROR: Official Trivy repository candidate is '${TRIVY_APT_VERSION}', expected ${TRIVY_VERSION}." >&2
    exit 1
    ;;
esac
sudo apt-get install -y --no-install-recommends "trivy=${TRIVY_APT_VERSION}"
TRIVY_INSTALLED_VERSION="$(trivy --version | awk '/Version:/ {print $2; exit}')"
if [[ "$TRIVY_INSTALLED_VERSION" != "$TRIVY_VERSION" ]]; then
  echo "ERROR: Installed Trivy version '${TRIVY_INSTALLED_VERSION}' does not match required ${TRIVY_VERSION}." >&2
  exit 1
fi
install -m 0755 "$(command -v trivy)" "$BIN_DIR/trivy"

echo "Installing Gitleaks v${GITLEAKS_VERSION} and verifying its official checksum."
GITLEAKS_ASSET="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
GITLEAKS_CHECKSUMS="gitleaks_${GITLEAKS_VERSION}_checksums.txt"
download_release_asset "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_ASSET}" "$TMP_DIR/$GITLEAKS_ASSET"
download_release_asset "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_CHECKSUMS}" "$TMP_DIR/$GITLEAKS_CHECKSUMS"
(cd "$TMP_DIR" && grep -F "$GITLEAKS_ASSET" "$GITLEAKS_CHECKSUMS" | sha256sum -c -)
tar -xzf "$TMP_DIR/$GITLEAKS_ASSET" -C "$TMP_DIR" gitleaks
install -m 0755 "$TMP_DIR/gitleaks" "$BIN_DIR/gitleaks"

echo "Installing OSV-Scanner v${OSV_SCANNER_VERSION} from Google's official release."
download_release_asset "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" "$BIN_DIR/osv-scanner"
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