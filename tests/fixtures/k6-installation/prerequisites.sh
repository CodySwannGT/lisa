#!/usr/bin/env bash
# Real runner prerequisites only. This never installs k6 or its repository key.
set -eu
test "$(id -u)" = 0
if command -v k6; then exit 41; fi
test ! -e /usr/share/keyrings/k6-archive-keyring.gpg
test ! -e /etc/apt/sources.list.d/k6.list
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates gnupg dirmngr sudo wget
useradd --create-home --shell /bin/bash runner
printf '%s\n' 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner
chmod 440 /etc/sudoers.d/runner
mkdir -p /proof
printf '%s\n' 'PREREQUISITES_COMPLETE_WITHOUT_K6'
