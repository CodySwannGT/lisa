#!/usr/bin/env bash
# Vendor-neutral AWS CLI bootstrap for remote coding environments. This is the
# source copied into every generated Lisa agent plugin.
#
# Required secret:
#   LISA_AWS_BOOTSTRAP_JSON  Complete SecretString emitted by cdkstarter's
#                            remote-agent IAM kit.
# Optional plain variables:
#   LISA_REMOTE_AGENT       claude | codex | cursor | copilot | agy | opencode
#   LISA_AWS_DEFAULT_PROFILE  Defaults to dev, then the first available profile.
#   LISA_AWS_SKIP_VERIFY    Set to 1 only for an offline image build.

set -euo pipefail
umask 077

BOOTSTRAP_PROFILE="lisa-remote-agent-bootstrap"
AWS_CLI_VERSION="2.36.2"

fail() {
  echo "remote-agent-aws-setup: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif need sudo; then
    sudo "$@"
  else
    fail "root access is required to install $1"
  fi
}

install_base_tools() {
  need curl && need unzip && need jq && need gpg && return 0

  if need apt-get; then
    as_root apt-get update -y
    as_root apt-get install -y curl unzip jq gnupg
  elif need dnf; then
    as_root dnf install -y curl unzip jq gnupg2
  elif need yum; then
    as_root yum install -y curl unzip jq gnupg2
  else
    fail "install curl, unzip, jq, and gpg in the remote image before running this script"
  fi
}

install_aws_cli() {
  need aws && return 0

  local architecture aws_architecture temporary_directory
  architecture="$(uname -m)"
  case "$architecture" in
    x86_64 | amd64) aws_architecture="x86_64" ;;
    aarch64 | arm64) aws_architecture="aarch64" ;;
    *) fail "unsupported AWS CLI architecture: $architecture" ;;
  esac

  temporary_directory="$(mktemp -d)"
  trap 'rm -rf "${temporary_directory:-}"' EXIT
  local installer_url
  installer_url="https://awscli.amazonaws.com/awscli-exe-linux-${aws_architecture}-${AWS_CLI_VERSION}.zip"
  curl -fsSL \
    "$installer_url" \
    -o "$temporary_directory/awscliv2.zip"
  curl -fsSL "$installer_url.sig" -o "$temporary_directory/awscliv2.sig"
  cat >"$temporary_directory/aws-cli-public-key.asc" <<'AWS_CLI_PUBLIC_KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBF2Cr7UBEADJZHcgusOJl7ENSyumXh85z0TRV0xJorM2B/JL0kHOyigQluUG
ZMLhENaG0bYatdrKP+3H91lvK050pXwnO/R7fB/FSTouki4ciIx5OuLlnJZIxSzx
PqGl0mkxImLNbGWoi6Lto0LYxqHN2iQtzlwTVmq9733zd3XfcXrZ3+LblHAgEt5G
TfNxEKJ8soPLyWmwDH6HWCnjZ/aIQRBTIQ05uVeEoYxSh6wOai7ss/KveoSNBbYz
gbdzoqI2Y8cgH2nbfgp3DSasaLZEdCSsIsK1u05CinE7k2qZ7KgKAUIcT/cR/grk
C6VwsnDU0OUCideXcQ8WeHutqvgZH1JgKDbznoIzeQHJD238GEu+eKhRHcz8/jeG
94zkcgJOz3KbZGYMiTh277Fvj9zzvZsbMBCedV1BTg3TqgvdX4bdkhf5cH+7NtWO
lrFj6UwAsGukBTAOxC0l/dnSmZhJ7Z1KmEWilro/gOrjtOxqRQutlIqG22TaqoPG
fYVN+en3Zwbt97kcgZDwqbuykNt64oZWc4XKCa3mprEGC3IbJTBFqglXmZ7l9ywG
EEUJYOlb2XrSuPWml39beWdKM8kzr1OjnlOm6+lpTRCBfo0wa9F8YZRhHPAkwKkX
XDeOGpWRj4ohOx0d2GWkyV5xyN14p2tQOCdOODmz80yUTgRpPVQUtOEhXQARAQAB
tCFBV1MgQ0xJIFRlYW0gPGF3cy1jbGlAYW1hem9uLmNvbT6JAlQEEwEIAD4CGwMF
CwkIBwIGFQoJCAsCBBYCAwECHgECF4AWIQT7Xbd/1cEYuAURraimMQrMRnJHXAUC
akV0ygUJDqP4lQAKCRCmMQrMRnJHXFHjD/9eyZLYcKuQOlLvtqSDtUBiEZf6ZZjM
i3ygYH8rJNtuToUH+HvSpe819urJCquXhDrlK6N+aqW0hCLtNABJG/vsafIgvIYJ
hSGgpgtNnQyMV1jViRWqPjbouw8OkYKBThUfT1i2Y+wn58ifs6ODBCmTexWtXspA
Si+Gt49xDOW0APmbOPnI+a4HJW6tVEo6MWS0WjzpiBayR3d1A4pt4YrPfSdDgpLo
h2SLQqlRqvvVZJaWBjhkErNFpfsBA06sDcPEOb0G8LBUbR4WOcdvhe5LubJbZuxC
AG9kNPCVeQP1ixwjgjXKysaxeQ6rv0VzIQgRp6tLVLWhy6AKDNvLjFSsmXZ1Wl08
Y/RlOHXlzLuQMRE6sR1wOdRxc9TsrNWTGiBK65cvSWOy03JeBkQQ8pesqltiyxI9
U21kkgiXtTSKNGfKK8pO27D81YANhRqPK7iTp6kuFiY2WtOg90KTMNlIT+Ff85Y2
b1rHj6Z0SrCkJujhWk3IBPic/wJgz01LEc/OAdUPlby90RJZcIBhSlWhT7mXnXIO
c0HWlNQrns2s3CTyYwZSiSlYe9ApeLwhjDo8NhbFuCAy61l6O5UsR4AfZxx/rGKv
2wFb1/RN/P4gNe6vmxZAPjR0AQcwD3tc2McimOLr/22kmPz8IH3I0X7WoSFr0Biz
E91G7bb0hOb/cA==
=knv7
-----END PGP PUBLIC KEY BLOCK-----
AWS_CLI_PUBLIC_KEY
  mkdir -m 700 "$temporary_directory/gnupg"
  gpg --batch --homedir "$temporary_directory/gnupg" \
    --import "$temporary_directory/aws-cli-public-key.asc" >/dev/null 2>&1
  gpg --batch --homedir "$temporary_directory/gnupg" \
    --verify "$temporary_directory/awscliv2.sig" \
    "$temporary_directory/awscliv2.zip"
  unzip -q "$temporary_directory/awscliv2.zip" -d "$temporary_directory"
  as_root "$temporary_directory/aws/install" \
    --install-dir /usr/local/aws-cli \
    --bin-dir /usr/local/bin
  rm -rf "$temporary_directory"
  trap - EXIT
}

remove_profile_setting() {
  local credentials_file profile setting temporary_file
  credentials_file="$1"
  profile="$2"
  setting="$3"
  [ -f "$credentials_file" ] || return 0

  temporary_file="$(mktemp "${credentials_file}.XXXXXX")"
  awk -v profile="$profile" -v setting="$setting" '
    /^\[[^]]+\][[:space:]]*$/ {
      section = $0
      sub(/^\[/, "", section)
      sub(/\][[:space:]]*$/, "", section)
      in_profile = section == profile
    }
    !(in_profile && $0 ~ "^[[:space:]]*" setting "[[:space:]]*=") { print }
  ' "$credentials_file" >"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$credentials_file"
}

sanitize_session_name() {
  local candidate
  candidate="$(printf '%s' "${LISA_REMOTE_AGENT:-remote-agent}" \
    | sed 's/[^A-Za-z0-9_+=,.@-]/-/g' \
    | cut -c1-64)"
  [ "${#candidate}" -ge 2 ] || candidate="remote-agent"
  printf '%s\n' "$candidate"
}

install_base_tools
install_aws_cli

[ -z "${AWS_ACCESS_KEY_ID:-}" ] || fail \
  "do not set AWS_ACCESS_KEY_ID directly; set only LISA_AWS_BOOTSTRAP_JSON so role profiles cannot be bypassed"
[ -z "${AWS_SECRET_ACCESS_KEY:-}" ] || fail \
  "do not set AWS_SECRET_ACCESS_KEY directly; set only LISA_AWS_BOOTSTRAP_JSON so role profiles cannot be bypassed"

bootstrap_json="${LISA_AWS_BOOTSTRAP_JSON:-}"
[ -n "$bootstrap_json" ] || fail "LISA_AWS_BOOTSTRAP_JSON is required"

printf '%s' "$bootstrap_json" | jq -e '
  type == "object" and
  (.accessKeyId | type == "string" and length > 0) and
  (.secretAccessKey | type == "string" and length > 0) and
  (.externalId | type == "string" and length > 0) and
  (.profiles | (type == "object" or type == "string"))
' >/dev/null || fail "LISA_AWS_BOOTSTRAP_JSON is not a valid remote-agent bootstrap bundle"

access_key_id="$(printf '%s' "$bootstrap_json" | jq -er '.accessKeyId')"
secret_access_key="$(printf '%s' "$bootstrap_json" | jq -er '.secretAccessKey')"
external_id="$(printf '%s' "$bootstrap_json" | jq -er '.externalId')"
session_token="$(printf '%s' "$bootstrap_json" | jq -r '.sessionToken // empty')"
profiles_json="$(printf '%s' "$bootstrap_json" | jq -c '
  if (.profiles | type) == "string" then
    .profiles | fromjson
  else
    .profiles
  end
')"

printf '%s' "$profiles_json" | jq -e --arg bootstrap_profile "$BOOTSTRAP_PROFILE" '
  type == "object" and length > 0 and
  all(to_entries[];
    (.key != $bootstrap_profile) and
    (.key | test("^[A-Za-z0-9_-]+$")) and
    (.value.roleArn | type == "string" and startswith("arn:aws:iam::")) and
    (.value.region | type == "string" and length > 0)
  )
' >/dev/null || fail "bootstrap profiles must map safe names to roleArn and region"

credentials_file="${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}"
config_file="${AWS_CONFIG_FILE:-$HOME/.aws/config}"
mkdir -p "$HOME/.aws" "$(dirname "$credentials_file")" "$(dirname "$config_file")"
chmod 700 "$HOME/.aws"

aws configure set aws_access_key_id "$access_key_id" --profile "$BOOTSTRAP_PROFILE"
aws configure set aws_secret_access_key "$secret_access_key" --profile "$BOOTSTRAP_PROFILE"
if [ -n "$session_token" ]; then
  aws configure set aws_session_token "$session_token" --profile "$BOOTSTRAP_PROFILE"
else
  remove_profile_setting \
    "$credentials_file" \
    "$BOOTSTRAP_PROFILE" \
    "aws_session_token"
fi

session_name="$(sanitize_session_name)"
while IFS=$'\t' read -r profile_name role_arn region; do
  aws configure set role_arn "$role_arn" --profile "$profile_name"
  aws configure set source_profile "$BOOTSTRAP_PROFILE" --profile "$profile_name"
  aws configure set external_id "$external_id" --profile "$profile_name"
  aws configure set role_session_name "$session_name" --profile "$profile_name"
  aws configure set region "$region" --profile "$profile_name"
done < <(printf '%s' "$profiles_json" | jq -r 'to_entries[] | [.key, .value.roleArn, .value.region] | @tsv')

default_profile="${LISA_AWS_DEFAULT_PROFILE:-dev}"
if ! printf '%s' "$profiles_json" | jq -e --arg profile "$default_profile" 'has($profile)' >/dev/null; then
  default_profile="$(printf '%s' "$profiles_json" | jq -r 'keys[0]')"
fi

default_role_arn="$(printf '%s' "$profiles_json" | jq -er --arg profile "$default_profile" '.[$profile].roleArn')"
default_region="$(printf '%s' "$profiles_json" | jq -er --arg profile "$default_profile" '.[$profile].region')"
aws configure set role_arn "$default_role_arn" --profile default
aws configure set source_profile "$BOOTSTRAP_PROFILE" --profile default
aws configure set external_id "$external_id" --profile default
aws configure set role_session_name "$session_name" --profile default
aws configure set region "$default_region" --profile default

chmod 600 "$credentials_file" "$config_file"

if [ "${LISA_AWS_SKIP_VERIFY:-0}" != "1" ]; then
  AWS_PAGER="" aws sts get-caller-identity --profile "$default_profile" >/dev/null
fi

profile_names="$(printf '%s' "$profiles_json" | jq -r 'keys | join(", ")')"
echo "remote-agent-aws-setup: ready (${session_name}; default=${default_profile}; profiles=${profile_names})"
