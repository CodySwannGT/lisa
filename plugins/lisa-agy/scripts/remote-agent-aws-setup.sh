#!/usr/bin/env bash
# Vendor-neutral AWS CLI bootstrap for remote coding environments. This is the
# source copied into every generated Lisa agent plugin.
#
# Required secret:
#   LISA_AWS_BOOTSTRAP_JSON  The complete remote-agent bootstrap bundle, as one
#                            JSON value. cdkstarter's IAM kit emits it, but this
#                            script neither knows nor cares which store it came
#                            from — resolve it through lisa-secrets-access like
#                            any other secret. Note that a project whose
#                            provider is AWS Secrets Manager cannot keep it
#                            there: reading it would need the very credential it
#                            contains.
# Optional plain variables:
#   LISA_REMOTE_AGENT       claude | codex | cursor | copilot | agy | opencode
#   LISA_AWS_PROFILE_NAMESPACE
#                           The project component every written profile is
#                           scoped by. Falls back to the bundle's `namespace`
#                           (or `project`), then to `<owner>-<repo>` from the
#                           git origin remote. Required when none resolves.
#   LISA_AWS_DEFAULT_PROFILE  Stage selected as the default. Defaults to dev,
#                           then the first stage in the bundle.
#   LISA_AWS_EXPECTED_ACCOUNT_ID
#                           Operator-declared account for the default stage.
#                           Checked against the bundle before anything is
#                           written, and against the live identity after.
#   LISA_AWS_VERIFY_ALL_PROFILES
#                           1 to prove every stage's account, not just the
#                           default's.
#   LISA_AWS_CLAIM_DEFAULT_PROFILE
#                           1 to take over a `[default]` this project does not
#                           already own. Off by default: silently repointing
#                           `default` is how one tenant's commands end up in
#                           another tenant's account.
#   LISA_AWS_PRUNE_LEGACY_PROFILES
#                           1 to delete the unnamespaced profiles an earlier
#                           Lisa bootstrap wrote. Off by default; they are
#                           reported either way, never silently orphaned.
#   LISA_AWS_SKIP_VERIFY    Set to 1 only for an offline image build.

set -euo pipefail
umask 077

# Profiles are scoped `<namespace>-agent-<stage>`, matching the convention every
# other profile on a multi-organisation workstation already follows. The old
# name is retained only so an earlier bootstrap's output can be recognised and
# migrated rather than left behind unexplained.
BOOTSTRAP_PROFILE_SUFFIX="-agent-bootstrap"
LEGACY_BOOTSTRAP_PROFILE="lisa-remote-agent-bootstrap"
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

# Delete one whole ini section, header and body, from an AWS shared-config file.
#
# Used only for the migration path: profiles a PREVIOUS Lisa bootstrap wrote
# under the old unnamespaced convention. Sections this script never wrote are
# never candidates — see legacy_profile_sections, which identifies ours by the
# retired source_profile name rather than by guessing from the profile name.
remove_profile_section() {
  local file section temporary_file
  file="$1"
  section="$2"
  [ -f "$file" ] || return 0

  temporary_file="$(mktemp "${file}.XXXXXX")"
  awk -v section="$section" '
    /^\[[^]]*\][[:space:]]*$/ {
      current = $0
      sub(/^\[[[:space:]]*/, "", current)
      sub(/[[:space:]]*\][[:space:]]*$/, "", current)
      in_section = current == section
      if (in_section) next
    }
    !in_section { print }
  ' "$file" >"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$file"
}

# Read one setting out of one ini section, or print nothing.
profile_setting_value() {
  local file section setting
  file="$1"
  section="$2"
  setting="$3"
  [ -f "$file" ] || return 0

  awk -v section="$section" -v setting="$setting" '
    /^\[[^]]*\][[:space:]]*$/ {
      current = $0
      sub(/^\[[[:space:]]*/, "", current)
      sub(/[[:space:]]*\][[:space:]]*$/, "", current)
      in_section = current == section
      next
    }
    in_section && $0 ~ "^[[:space:]]*" setting "[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "")
      sub(/[[:space:]]*$/, "")
      print
      exit
    }
  ' "$file"
}

# Every section written by the OLD, unnamespaced convention.
#
# Identified by the retired bootstrap profile name, which only Lisa ever wrote,
# so an operator's own `[profile dev]` can never be mistaken for ours.
legacy_profile_sections() {
  local file
  file="$1"
  [ -f "$file" ] || return 0

  awk -v bootstrap="$LEGACY_BOOTSTRAP_PROFILE" '
    /^\[[^]]*\][[:space:]]*$/ {
      current = $0
      sub(/^\[[[:space:]]*/, "", current)
      sub(/[[:space:]]*\][[:space:]]*$/, "", current)
      section = current
      next
    }
    $0 ~ "^[[:space:]]*source_profile[[:space:]]*=" {
      value = $0
      sub(/^[^=]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      if (value == bootstrap && section != "") print section
    }
  ' "$file"
}

sanitize_session_name() {
  local candidate
  candidate="$(printf '%s' "${LISA_REMOTE_AGENT:-remote-agent}" \
    | sed 's/[^A-Za-z0-9_+=,.@-]/-/g' \
    | cut -c1-64)"
  [ "${#candidate}" -ge 2 ] || candidate="remote-agent"
  printf '%s\n' "$candidate"
}

# Reduce any project identifier to the safe, stable component of a profile name.
sanitize_namespace() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-*//' -e 's/-*$//' \
    | cut -c1-48
}

# `<owner>-<repository>` for the checkout this script was run from.
#
# The forge owner is what makes the result distinguishing: two organisations
# routinely have a repository of the same NAME, which is the collision this
# whole change exists to remove, and they cannot share an owner.
namespace_from_git() {
  need git || return 0

  local url slug
  url="$(git config --get remote.origin.url 2>/dev/null || true)"
  [ -n "$url" ] || return 0
  url="${url%.git}"
  url="${url%/}"
  slug="$(printf '%s' "$url" \
    | sed -e 's#^[a-zA-Z0-9+.-]*://##' -e 's#^[^@/]*@##' -e 's#^[^/:]*[:/]##')"
  printf '%s' "$slug" | tr '/' '-'
}

# The project component every profile this script writes is scoped by.
#
# Bare stage names (`dev`, `production`) name a stage but not an OWNER. On a
# workstation carrying more than one organisation two bundles then write the
# same names into the same shared `~/.aws/config`, the last bootstrap wins, and
# every later command resolves another tenant's account while reporting success.
# Nothing about the resulting profile is malformed, so no check on the profile
# can catch it; only a name that carries the owner can prevent it.
# Prints `<namespace>\t<where it came from>`. Both halves are returned together
# because this runs in a command substitution: a variable assigned inside a
# subshell never reaches the caller, and reporting the wrong provenance is how
# an operator ends up unable to explain why their profiles are named what they
# are named.
resolve_namespace() {
  local candidate sanitized namespace_source
  namespace_source="LISA_AWS_PROFILE_NAMESPACE"
  candidate="${LISA_AWS_PROFILE_NAMESPACE:-}"
  if [ -z "$candidate" ]; then
    namespace_source="the bootstrap bundle"
    candidate="$(printf '%s' "$bootstrap_json" | jq -r '.namespace // .project // empty')"
  fi
  if [ -z "$candidate" ]; then
    namespace_source="git remote origin"
    candidate="$(namespace_from_git)"
  fi
  [ -n "$candidate" ] || fail \
    "cannot determine which project these AWS profiles belong to. Set LISA_AWS_PROFILE_NAMESPACE (for example the repository slug), add a \"namespace\" to the bootstrap bundle, or run this from a checkout with an origin remote. Unnamespaced profiles collide across organisations on a shared workstation."

  sanitized="$(sanitize_namespace "$candidate")"
  printf '%s' "$sanitized" | grep -qE '^[a-z0-9][a-z0-9-]{1,47}$' || fail \
    "profile namespace from ${namespace_source} (\"${candidate}\") does not reduce to a usable name; set LISA_AWS_PROFILE_NAMESPACE to two or more alphanumeric characters"
  printf '%s\t%s\n' "$sanitized" "$namespace_source"
}

# Prove which ACCOUNT a profile reaches, not merely that it authenticates.
#
# `sts:GetCallerIdentity` succeeding proves the credentials work. It says
# nothing about whose account they work in, and the old code never looked at
# what it returned — a lookup whose success was read as the answer. Comparing
# the returned account against the one named in the role ARN just configured is
# what turns a liveness probe into an identity check.
assert_profile_account() {
  local profile expected stage identity actual
  profile="$1"
  expected="$2"
  stage="$3"

  identity="$(AWS_PAGER="" aws sts get-caller-identity --profile "$profile" --output json)" || fail \
    "sts:GetCallerIdentity failed for profile ${profile} (stage ${stage})"
  actual="$(printf '%s' "$identity" | jq -r '.Account // empty')"
  [ -n "$actual" ] || fail \
    "sts:GetCallerIdentity returned no account id for profile ${profile} (stage ${stage}); cannot prove which account it reached"
  [ "$actual" = "$expected" ] || fail \
    "profile ${profile} (stage ${stage}) resolved to AWS account ${actual}, but this project expects ${expected}. The credentials authenticate; they are not this project's account. Refusing to report ready."
}

# Who currently owns `[default]`.
#
# `default` is the one name that cannot be namespaced, so it is the one place
# two projects still contend. Taking it over silently is the whole defect in
# miniature: every unqualified `aws` command would change accounts with nothing
# said. An inert `[default]` holding only region/output is not a claim on it,
# and a container that ships one must still be able to bootstrap.
default_profile_owner() {
  local source_value setting
  source_value="$(profile_setting_value "$config_file" "default" "source_profile")"
  if [ "$source_value" = "$BOOTSTRAP_PROFILE" ]; then
    printf 'ours\n'
    return 0
  fi
  if [ "$source_value" = "$LEGACY_BOOTSTRAP_PROFILE" ]; then
    printf 'legacy\n'
    return 0
  fi
  case "$source_value" in
    *"$BOOTSTRAP_PROFILE_SUFFIX")
      printf 'another Lisa project\n'
      return 0
      ;;
  esac
  for setting in role_arn credential_process sso_start_url sso_session aws_access_key_id; do
    if [ -n "$(profile_setting_value "$config_file" "default" "$setting")" ]; then
      printf 'this workstation operator\n'
      return 0
    fi
  done
  if [ -n "$(profile_setting_value "$credentials_file" "default" "aws_access_key_id")" ]; then
    printf 'this workstation operator\n'
    return 0
  fi
  printf 'unclaimed\n'
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

namespace_resolution="$(resolve_namespace)"
PROFILE_NAMESPACE="${namespace_resolution%%$'\t'*}"
namespace_source="${namespace_resolution#*$'\t'}"
BOOTSTRAP_PROFILE="${PROFILE_NAMESPACE}${BOOTSTRAP_PROFILE_SUFFIX}"

# The role ARN carries the account the role lives in, so every bundle already
# declares an expected account per stage whether or not it says so explicitly.
# Requiring the full ARN shape is what makes that field readable at all.
printf '%s' "$profiles_json" | jq -e --arg bootstrap_profile "$BOOTSTRAP_PROFILE" '
  type == "object" and length > 0 and
  all(to_entries[];
    (.key != $bootstrap_profile) and
    (.key != "bootstrap") and
    (.key | test("^[A-Za-z0-9_-]+$")) and
    (.value.roleArn | type == "string" and test("^arn:aws:iam::[0-9]{12}:role/.+")) and
    (.value.region | type == "string" and length > 0)
  )
' >/dev/null || fail "bootstrap profiles must map safe names (not \"bootstrap\") to a full arn:aws:iam::<account>:role/<name> roleArn and a region"

# An explicitly declared account that disagrees with the role ARN is a bundle
# that cannot be believed. Fail here, before anything is written, naming both.
while IFS="$(printf '\t')" read -r stage declared_account arn_account; do
  [ "$declared_account" = "$arn_account" ] || fail \
    "bundle stage ${stage} declares expectedAccountId ${declared_account} but its roleArn names account ${arn_account}"
done < <(printf '%s' "$profiles_json" | jq -r '
  to_entries[]
  | select(.value.expectedAccountId != null)
  | [.key, (.value.expectedAccountId | tostring), (.value.roleArn | split(":")[4])]
  | @tsv
')

default_stage="${LISA_AWS_DEFAULT_PROFILE:-dev}"
if ! printf '%s' "$profiles_json" | jq -e --arg stage "$default_stage" 'has($stage)' >/dev/null; then
  default_stage="$(printf '%s' "$profiles_json" | jq -r 'keys[0]')"
fi

default_role_arn="$(printf '%s' "$profiles_json" | jq -er --arg stage "$default_stage" '.[$stage].roleArn')"
default_region="$(printf '%s' "$profiles_json" | jq -er --arg stage "$default_stage" '.[$stage].region')"
default_expected_account="$(printf '%s' "$profiles_json" | jq -er --arg stage "$default_stage" '
  (.[$stage].expectedAccountId // (.[$stage].roleArn | split(":")[4])) | tostring
')"

if [ -n "${LISA_AWS_EXPECTED_ACCOUNT_ID:-}" ] \
  && [ "$LISA_AWS_EXPECTED_ACCOUNT_ID" != "$default_expected_account" ]; then
  fail "LISA_AWS_EXPECTED_ACCOUNT_ID is ${LISA_AWS_EXPECTED_ACCOUNT_ID} but the bundle's ${default_stage} role is in account ${default_expected_account}"
fi

credentials_file="${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}"
config_file="${AWS_CONFIG_FILE:-$HOME/.aws/config}"
mkdir -p "$HOME/.aws" "$(dirname "$credentials_file")" "$(dirname "$config_file")"
chmod 700 "$HOME/.aws"

profile_names="$(printf '%s' "$profiles_json" \
  | jq -r --arg namespace "$PROFILE_NAMESPACE" 'keys | map($namespace + "-agent-" + .) | join(", ")')"

# Migration: the previous convention's profiles are still on this workstation.
#
# They are reported rather than removed, because deleting a profile an operator
# may still be using is its own silent surprise. Pruning is opt-in and says
# exactly what it removed.
legacy_sections="$(legacy_profile_sections "$config_file")"
legacy_names=""
if [ -n "$legacy_sections" ]; then
  legacy_names="$(printf '%s\n' "$legacy_sections" | sed 's/^profile //' | paste -sd ',' - | sed 's/,/, /g')"
  if [ "${LISA_AWS_PRUNE_LEGACY_PROFILES:-0}" = "1" ]; then
    printf '%s\n' "$legacy_sections" | while IFS= read -r section; do
      [ -n "$section" ] || continue
      remove_profile_section "$config_file" "$section"
    done
    remove_profile_section "$config_file" "profile ${LEGACY_BOOTSTRAP_PROFILE}"
    remove_profile_section "$credentials_file" "$LEGACY_BOOTSTRAP_PROFILE"
  fi
fi

default_owner="$(default_profile_owner)"
case "$default_owner" in
  ours | legacy | unclaimed) ;;
  *)
    [ "${LISA_AWS_CLAIM_DEFAULT_PROFILE:-0}" = "1" ] || fail \
      "refusing to overwrite the [default] AWS profile in ${config_file}: it belongs to ${default_owner}, not to ${PROFILE_NAMESPACE}. Overwriting it would silently repoint every unqualified aws command at this project's accounts. Use the named profiles instead (${profile_names}), or set LISA_AWS_CLAIM_DEFAULT_PROFILE=1 to take it over deliberately."
    ;;
esac

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
while IFS="$(printf '\t')" read -r stage role_arn region; do
  profile_name="${PROFILE_NAMESPACE}-agent-${stage}"
  aws configure set role_arn "$role_arn" --profile "$profile_name"
  aws configure set source_profile "$BOOTSTRAP_PROFILE" --profile "$profile_name"
  aws configure set external_id "$external_id" --profile "$profile_name"
  aws configure set role_session_name "$session_name" --profile "$profile_name"
  aws configure set region "$region" --profile "$profile_name"
done < <(printf '%s' "$profiles_json" | jq -r 'to_entries[] | [.key, .value.roleArn, .value.region] | @tsv')

default_profile="${PROFILE_NAMESPACE}-agent-${default_stage}"
aws configure set role_arn "$default_role_arn" --profile default
aws configure set source_profile "$BOOTSTRAP_PROFILE" --profile default
aws configure set external_id "$external_id" --profile default
aws configure set role_session_name "$session_name" --profile default
aws configure set region "$default_region" --profile default

chmod 600 "$credentials_file" "$config_file"

if [ "${LISA_AWS_SKIP_VERIFY:-0}" != "1" ]; then
  if [ "${LISA_AWS_VERIFY_ALL_PROFILES:-0}" = "1" ]; then
    while IFS="$(printf '\t')" read -r stage expected_account; do
      assert_profile_account "${PROFILE_NAMESPACE}-agent-${stage}" "$expected_account" "$stage"
    done < <(printf '%s' "$profiles_json" | jq -r '
      to_entries[]
      | [.key, ((.value.expectedAccountId // (.value.roleArn | split(":")[4])) | tostring)]
      | @tsv
    ')
  else
    assert_profile_account "$default_profile" "$default_expected_account" "$default_stage"
  fi
fi

if [ -n "$legacy_names" ]; then
  if [ "${LISA_AWS_PRUNE_LEGACY_PROFILES:-0}" = "1" ]; then
    echo "remote-agent-aws-setup: removed unnamespaced profiles left by an earlier bootstrap: ${legacy_names}" >&2
  else
    echo "remote-agent-aws-setup: ${config_file} still contains unnamespaced profiles written by an earlier Lisa bootstrap: ${legacy_names}. They name a stage but no owner, so on a workstation carrying more than one organisation they can resolve to another tenant's account. Review them, or re-run with LISA_AWS_PRUNE_LEGACY_PROFILES=1 to delete the ones Lisa wrote." >&2
  fi
fi

echo "remote-agent-aws-setup: ready (${session_name}; namespace=${PROFILE_NAMESPACE} via ${namespace_source}; default=${default_profile} in account ${default_expected_account}; profiles=${profile_names})"
