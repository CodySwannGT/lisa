#!/usr/bin/env bash
set -euo pipefail
binary=$(command -v k6)
printf 'selected_path=%s\n' "$binary"
readlink -f "$binary"
sha256sum "$binary"
if [ "$1" = explicit ]; then
  test "$binary" = /usr/local/bin/k6
  if dpkg-query -W -f='${Status}' k6 2>/dev/null; then exit 42; fi
  test ! -e /etc/apt/sources.list.d/k6.list
  test ! -e /usr/share/keyrings/k6-archive-keyring.gpg
  sha256sum k6-v2.3.0-linux-amd64.tar.gz
  archive_binary=$(tar -xOf k6-v2.3.0-linux-amd64.tar.gz k6-v2.3.0-linux-amd64/k6 | sha256sum)
  selected_binary=$(sha256sum /usr/local/bin/k6)
  printf 'archive_binary_sha256=%s\n' "${archive_binary%% *}"
  test "${archive_binary%% *}" = "${selected_binary%% *}"
else
  test "$binary" = /usr/bin/k6
  dpkg-query -W -f='${Status}\n${Version}\n' k6
  sudo gpg --show-keys --with-colons /usr/share/keyrings/k6-archive-keyring.gpg
  sha256sum /usr/share/keyrings/k6-archive-keyring.gpg
fi
