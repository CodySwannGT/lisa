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
  need curl && need unzip && need jq && return 0

  if need apt-get; then
    as_root apt-get update -y
    as_root apt-get install -y curl unzip jq
  elif need dnf; then
    as_root dnf install -y curl unzip jq
  elif need yum; then
    as_root yum install -y curl unzip jq
  else
    fail "install curl, unzip, and jq in the remote image before running this script"
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
  curl -fsSL \
    "https://awscli.amazonaws.com/awscli-exe-linux-${aws_architecture}.zip" \
    -o "$temporary_directory/awscliv2.zip"
  unzip -q "$temporary_directory/awscliv2.zip" -d "$temporary_directory"
  as_root "$temporary_directory/aws/install" \
    --install-dir /usr/local/aws-cli \
    --bin-dir /usr/local/bin
  rm -rf "$temporary_directory"
  trap - EXIT
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

printf '%s' "$profiles_json" | jq -e '
  type == "object" and length > 0 and
  all(to_entries[];
    (.key | test("^[A-Za-z0-9_-]+$")) and
    (.value.roleArn | type == "string" and startswith("arn:aws:iam::")) and
    (.value.region | type == "string" and length > 0)
  )
' >/dev/null || fail "bootstrap profiles must map safe names to roleArn and region"

mkdir -p "$HOME/.aws"
chmod 700 "$HOME/.aws"

aws configure set aws_access_key_id "$access_key_id" --profile "$BOOTSTRAP_PROFILE"
aws configure set aws_secret_access_key "$secret_access_key" --profile "$BOOTSTRAP_PROFILE"
if [ -n "$session_token" ]; then
  aws configure set aws_session_token "$session_token" --profile "$BOOTSTRAP_PROFILE"
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

chmod 600 "$HOME/.aws/credentials" "$HOME/.aws/config"

if [ "${LISA_AWS_SKIP_VERIFY:-0}" != "1" ]; then
  AWS_PAGER="" aws sts get-caller-identity --profile "$default_profile" >/dev/null
fi

profile_names="$(printf '%s' "$profiles_json" | jq -r 'keys | join(", ")')"
echo "remote-agent-aws-setup: ready (${session_name}; default=${default_profile}; profiles=${profile_names})"
