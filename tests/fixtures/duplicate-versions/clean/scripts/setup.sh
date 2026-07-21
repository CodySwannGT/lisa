#!/usr/bin/env bash
# Fixture: a governed script that derives its tool version from the canonical
# manifest instead of copying the pin.
set -euo pipefail

AST_GREP_VERSION="$(node -p "require('./package.json').dependencies['@ast-grep/cli'].replace(/^[^0-9]*/, '')")"
npm install -g "@ast-grep/cli@${AST_GREP_VERSION}"
