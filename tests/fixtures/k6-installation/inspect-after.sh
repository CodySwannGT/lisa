#!/usr/bin/env bash
# Local forensic readback; this never retries installation or fetches a key.
set -eu
printf '%s\n' 'ACTUAL_ARCHIVE_KEYRING_AFTER_BASELINE'
if test -e /usr/share/keyrings/k6-archive-keyring.gpg; then
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --with-colons --fingerprint
fi
if command -v k6; then k6 version; else printf '%s\n' 'K6_NOT_INSTALLED'; fi
