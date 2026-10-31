#!/usr/bin/env bash
# Only the named canonical fetch is faulted; all other routes are rejected.
set -eu
printf '%s\n' "$*" >> "$K6_FAULT_DIR/curl-route.txt"
if [ "$#" != 2 ] || [ "$1" != '-fsSL' ] || [ "$2" != 'https://dl.k6.io/key.gpg' ]; then
  printf '%s\n' 'UNEXPECTED_CURL_ROUTE' >&2
  exit 97
fi
cat "$K6_FAULT_DIR/public-key.gpg"
exit 23
