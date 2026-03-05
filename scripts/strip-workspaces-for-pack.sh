#!/usr/bin/env bash
# Strips the `workspaces` field from package.json before npm creates a tarball.
#
# The workspaces field is only meaningful for Lisa's local monorepo development.
# When published to npm, it causes bun to erroneously try resolving workspace
# directory names (e.g. "eslint-plugin-component-structure") as npm packages,
# producing FileNotFound errors in downstream projects during `bun update`.
#
# Called via the `prepack` lifecycle hook; the `postpack` hook restores the
# original package.json from the backup created here.
set -euo pipefail

cp package.json package.json.bak
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  delete pkg.workspaces;
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "prepack: stripped workspaces from package.json"
