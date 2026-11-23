#!/usr/bin/env bash
set -eu
# ShellCheck cannot follow the runner's /etc/os-release on a host without one,
# so the hint names a stand-in declaring the fields read below. It changes
# nothing at run time: this still sources the runner's own file.
# shellcheck source=os-release.txt
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_ID" = 26.04
test "$(uname -m)" = x86_64
test "$(id -un)" = runner
if command -v k6; then exit 41; fi
if dpkg-query -W -f='${Status}' k6 2>/dev/null; then exit 42; fi
test ! -e /usr/share/keyrings/k6-archive-keyring.gpg
test ! -e /etc/apt/sources.list.d/k6.list
test -z "${BASH_ENV:-}"
test -z "${ENV:-}"
case ":$SHELLOPTS:" in *:pipefail:*) exit 43 ;; esac
printf '{"os":"%s","version":"%s","architecture":"%s","user":"%s","k6Absent":true,"packageAbsent":true,"keyringAbsent":true,"sourceAbsent":true,"pipefail":false}\n' "$ID" "$VERSION_ID" "$(uname -m)" "$(id -un)"
