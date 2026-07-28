#!/usr/bin/env bash
# npm "version" hook: stamp plugin manifests and stage them for the release commit.

VERSION="$npm_package_version"
if [ -z "$VERSION" ]; then
  echo "sync-plugin-versions: no npm_package_version set" >&2
  exit 1
fi

MANIFESTS=(
  "plugins/comic-strip/.claude-plugin/plugin.json"
  "plugins/comic-strip/.codex-plugin/plugin.json"
  ".claude-plugin/marketplace.json"
)

for f in "${MANIFESTS[@]}"; do
  if [ ! -f "$f" ]; then
    echo "sync-plugin-versions: $f not found, skipping" >&2
    continue
  fi
  node -e "
    const fs = require('fs');
    const p = '$f';
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (obj.version) obj.version = '$VERSION';
    if (obj.metadata?.version) obj.metadata.version = '$VERSION';
    const indent = raw.match(/^\t/m) ? '\t' : '  ';
    fs.writeFileSync(p, JSON.stringify(obj, null, indent) + '\n');
  "
  git add "$f"
done
