#!/usr/bin/env bash
set -Eeuo pipefail

# Free/open-source security gate for Flutter Foundry; no paid API keys are used.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

case "$(uname -s):$(uname -m)" in
 Linux:x86_64) ;;
 *) echo "Unsupported host: $(uname -s) $(uname -m); Linux x86_64 is required." >&2; exit 2 ;;
esac
for dep in curl tar sha256sum python3 node docker; do command -v "$dep" >/dev/null; done

# Use per-job writable storage for scanner binaries and their database cache.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
CACHE_DIR="$TMP_DIR/cache"
mkdir -p "$BIN_DIR" "$CACHE_DIR"

download_release_asset() {
  local url="$1"
  local destination="$2"
  curl --fail --show-error --location \
    --retry 5 --retry-delay 3 --retry-all-errors --retry-max-time 240 \
    --connect-timeout 20 --max-time 120 \
    "$url" -o "$destination"
}

export PATH="$BIN_DIR:$PATH"

# OSV-Scanner and Trivy require resolved JavaScript dependency versions.
# Fail closed when the repository lockfile is missing instead of scanning an
# uncommitted dependency resolution that cannot be reproduced by contributors.
if [[ ! -f package.json || ! -f package-lock.json ]]; then
 echo "ERROR: package.json and a committed package-lock.json are required for dependency scanning." >&2
 exit 2
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

# Official GHCR images pinned to immutable Linux/amd64 manifest digests.
GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v${GITLEAKS_VERSION}@sha256:b109bc5f8f76a38196a3e413704fc5b9e3c32360bce4e4b603bd6f45b3721dbb"
OSV_SCANNER_IMAGE="ghcr.io/google/osv-scanner:v${OSV_SCANNER_VERSION}-amd64@sha256:d2c46aa2483c4e02759bc25f2224d28a5ceeb3dca5a1ecd1f569fbed83a626f0"

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is required to run the pinned official scanner images, but the Docker daemon is unavailable." >&2
  exit 2
fi

pull_pinned_image() {
  local image="$1"
  local attempt
  for attempt in 1 2 3 4 5; do
    if docker pull --platform linux/amd64 "$image"; then
      return 0
    fi
    if [[ "$attempt" -lt 5 ]]; then
      echo "Docker image pull failed (attempt $attempt/5); retrying in 5 seconds." >&2
      sleep 5
    fi
  done
  echo "ERROR: Could not pull pinned scanner image: $image" >&2
  return 1
}

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

echo "Installing Gitleaks v${GITLEAKS_VERSION} from its official digest-pinned GHCR image."
pull_pinned_image "$GITLEAKS_IMAGE"
cat > "$BIN_DIR/gitleaks" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
exec docker run --rm --pull=never --platform linux/amd64 --network none \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$ROOT_DIR:/repo:ro" -w /repo \
  "$GITLEAKS_IMAGE" "\$@"
EOF
chmod 0755 "$BIN_DIR/gitleaks"

echo "Installing OSV-Scanner v${OSV_SCANNER_VERSION} from Google's official digest-pinned GHCR image."
pull_pinned_image "$OSV_SCANNER_IMAGE"
cat > "$BIN_DIR/osv-scanner" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
exec docker run --rm --pull=never --platform linux/amd64 \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$ROOT_DIR:/src:ro" -w /src \
  "$OSV_SCANNER_IMAGE" "\$@"
EOF
chmod 0755 "$BIN_DIR/osv-scanner"

echo "Installing Semgrep Community CLI v${SEMGREP_VERSION} from its version-pinned official container."
SEMGREP_IMAGE="semgrep/semgrep:${SEMGREP_VERSION}"
docker pull --platform linux/amd64 "$SEMGREP_IMAGE"

echo
echo "=== Scanner versions ==="
"$BIN_DIR/trivy" --version
"$BIN_DIR/gitleaks" version
"$BIN_DIR/osv-scanner" --version
docker run --rm --pull=never --platform linux/amd64 "$SEMGREP_IMAGE" semgrep --version

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

# MEDIUM findings are retained as advisory results and do not block the gate.
run_check "Trivy: MEDIUM severity advisory report (non-blocking)" \
 "$BIN_DIR/trivy" fs --cache-dir "$CACHE_DIR/trivy" \
 --skip-dirs node_modules --skip-dirs .next \
 --scanners vuln,misconfig --severity MEDIUM --exit-code 0 --no-progress .

run_check "Gitleaks: committed secrets (redacted output)" \
 "$BIN_DIR/gitleaks" git --redact --exit-code 1 --no-banner .

run_check "Semgrep Community: security-audit ERROR findings" \
 docker run --rm --pull=never --platform linux/amd64 \
 --user "$(id -u):$(id -g)" -e HOME=/tmp \
 -v "$ROOT_DIR:/src:ro" -w /src \
 "$SEMGREP_IMAGE" semgrep scan --config p/security-audit --severity ERROR --error --metrics=off \
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