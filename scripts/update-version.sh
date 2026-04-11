#!/usr/bin/env bash
# Regenerate version.json with the current git commit hash.
# Run before each playtest session to tag logs with the right build.
#
# Optional: install as a post-commit hook so it runs automatically:
#   ln -sf ../../scripts/update-version.sh .git/hooks/post-commit

set -euo pipefail

cd "$(dirname "$0")/.."

COMMIT="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > version.json <<EOF
{
  "commit": "${COMMIT}",
  "short": "${SHORT}",
  "updatedAt": "${DATE}"
}
EOF

echo "version.json → ${SHORT}"
