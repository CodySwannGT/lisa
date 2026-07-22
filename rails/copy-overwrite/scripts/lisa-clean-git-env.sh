#!/bin/sh

set -eu

# Git supplies repository-local GIT_* variables to hooks. Remove exactly Git's
# documented local set before a quality command enters any nested repository.
GIT_LOCAL_ENV_VARS=$(git rev-parse --local-env-vars) || exit 1
for GIT_LOCAL_ENV_VAR in $GIT_LOCAL_ENV_VARS; do
  unset "$GIT_LOCAL_ENV_VAR"
done
unset GIT_LOCAL_ENV_VAR GIT_LOCAL_ENV_VARS

exec "$@"
