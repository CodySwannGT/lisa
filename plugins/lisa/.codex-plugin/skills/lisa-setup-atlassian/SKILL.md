---
name: lisa-setup-atlassian
description: "Configure Atlassian access for…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion"]
---

# Setup Atlassian: $ARGUMENTS

Resolve and persist Atlassian access for this project. After this skill, `.lisa.config.json` contains `atlassian.cloudId` (required) and optionally `atlassian.site` / `atlassian.email` for multi-account disambiguation.

## Workflow

### Step 0 — Pick a setup path

Ask via `AskUserQuestion`:

> How do you want lisa to talk to Atlassian for this project?
>
> 1. **MCP-only (simplest)** — authenticate the Atlassian MCP once via browser OAuth; lisa uses it for every operation. Best for: single-Atlassian-account developers on a personal laptop. New developers onboard with one OAuth flow, no token management. Skip the rest of this setup.
> 2. **acli (CLI) + MCP fallback** — install acli, authenticate per-profile, MCP picks up anything acli can't do. Best for: developers who work across multiple Atlassian accounts and need profile switching. Continue with acli install.
> 3. **API-token path (headless / CI)** — store a per-user API token in the OS keychain; lisa uses curl for everything. Best for: CI pipelines, headless dev containers, or any case where browser OAuth is impossible. Continue through token-create steps.

If the user picks (1) and the MCP is already authenticated to the right workspace (verify by calling `getAccessibleAtlassianResources` and checking `atlassian.cloudId` is in the result), write only `atlassian.cloudId` and `atlassian.site` into `.lisa.config.json` and skip to Step 6 (cloudId resolution). If the MCP isn't authed yet, instruct the user to run `mcp__plugin_atlassian_atlassian__authenticate` (or the claude.ai equivalent) and complete the OAuth flow in their browser, then re-verify.

If the user picks (2) or (3), continue through the rest of the steps; acli and/or the API token become available alongside the MCP.

### Step 1 — Ensure acli is installed (preferred substrate)

```bash
if ! command -v acli >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew tap atlassian/homebrew-acli
    brew install acli
  else
    cat >&2 <<'EOF'
Error: Homebrew not found. Install acli manually:
  https://developer.atlassian.com/cloud/acli/guides/install-macos/
or skip acli and rely on the Atlassian MCP only (CI/remote envs need acli).
EOF
    # Continue — acli is preferred but MCP-only is acceptable.
  fi
fi
```

If acli install fails or is skipped, the project will operate in MCP mode. Surface this clearly to the user.

### Step 2 — Authenticate

If acli is installed: prefer `acli auth login --web` for interactive environments; for headless, instruct the user to obtain a Rovo MCP-scoped API token and pipe via:

```bash
echo "$ATLASSIAN_TOKEN" | acli jira auth login --site "<site>.atlassian.net" --email "<email>" --token
```

After login, verify with `acli auth status`.

### Step 3 — Acquire an Atlassian API token (curl substrate)

acli covers most JIRA operations but **no Confluence page writes** (only `space`-level commands, and `page view`). The classic-vs-granular OAuth scope mismatch (see `config-resolution` rule) also blocks acli's bearer token from working against the v2 Confluence REST API. So lisa needs a second substrate — **curl with Basic auth + API token** — for everything Confluence-write-related.

**Per-product tokens**: Atlassian's scoped API token UI is per-product, so the easiest path is one Confluence-scoped token. JIRA operations remain on acli (no JIRA token needed). If a future lisa op turns out to need a JIRA-scoped token (e.g., reading transition metadata or remote links — neither is required by the current dispatch), make a second token then.

**Security posture**: the token is stored in the OS keychain when available (macOS/Linux/Windows native backends) so it never lives in plaintext on disk and never flows through chat history. Env-var fallback exists for headless / CI / Linux-without-libsecret.

#### 3a. Check for existing token via the lookup ladder

Use the same ladder `atlassian-access` uses (env var → email-suffixed env var → keychain):

```bash
EMAIL=$(jq -r '.atlassian.email // empty' .lisa.config.local.json 2>/dev/null)
SITE=$(jq -r '.atlassian.site // empty' .lisa.config.json)
CLOUDID=$(jq -r '.atlassian.cloudId // empty' .lisa.config.json)

read_token() {
  local email="$1"
  [ -n "$ATLASSIAN_API_TOKEN" ] && { echo "$ATLASSIAN_API_TOKEN"; return; }
  local slug=$(echo "$email" | tr '[:upper:]@.' '[:lower:]__')
  local varname="ATLASSIAN_API_TOKEN_${slug}"
  [ -n "${!varname}" ] && { echo "${!varname}"; return; }
  case "$(uname -s)" in
    Darwin)  security find-generic-password -s lisa-atlassian -a "$email" -w 2>/dev/null ;;
    Linux)   command -v secret-tool >/dev/null && secret-tool lookup service lisa-atlassian account "$email" 2>/dev/null ;;
    MINGW*|MSYS*|CYGWIN*)
      # `cmdkey /generic ... /pass:` stores the secret in Windows Credential Manager, but
      # `cmdkey /list` never prints stored passwords (by design). Read the CredentialBlob
      # back via the Win32 CredRead API through PowerShell; pass the target name via an env
      # var to dodge nested quoting, and strip the CRLF powershell.exe appends.
      LISA_CRED_TARGET="lisa-atlassian-${email}" powershell.exe -NoProfile -NonInteractive -Command '
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LisaCred {
  [StructLayout(LayoutKind.Sequential)]
  private struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) { return null; }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0) { return String.Empty; }
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
}
"@
[LisaCred]::Read($env:LISA_CRED_TARGET)' 2>/dev/null | tr -d '\r' ;;
  esac
}

EXISTING=$(read_token "$EMAIL")
if [ -n "$EXISTING" ]; then
  # Validate against Confluence.
  AUTH=$(printf '%s:%s' "$EMAIL" "$EXISTING" | base64)
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Basic $AUTH" \
    "https://api.atlassian.com/ex/confluence/${CLOUDID}/wiki/rest/api/space?limit=1")
  if [ "$CODE" = "200" ]; then
    echo "Existing Atlassian API token validated. Skipping setup."
    # proceed to Step 4
  fi
fi
```

If validation fails or no token is found, continue.

#### 3b. Prompt the user to generate a token

Open the token-creation page in their browser:

```bash
case "$(uname -s)" in
  Darwin) open "https://id.atlassian.com/manage-profile/security/api-tokens" ;;
  Linux)  xdg-open "https://id.atlassian.com/manage-profile/security/api-tokens" 2>/dev/null ;;
  MINGW*|MSYS*|CYGWIN*) start "https://id.atlassian.com/manage-profile/security/api-tokens" ;;
esac
```

Then print these instructions for the user:

```
1. Click "Create API token with scopes" (NOT the legacy unscoped form).
2. Label it: lisa-confluence-<machine-name>   (anything; just for revocation traceability)
3. App: Confluence
4. Select EXACTLY these scopes:
     Read:   read:page:confluence
             read:hierarchical-content:confluence
             read:comment:confluence
             read:space:confluence
     Write:  write:page:confluence
             write:comment:confluence
             write:label:confluence
     Search: search:confluence
5. Set an expiry (1 year max).
6. Click "Create token" and copy the value.
```

#### 3c. Have the user store the token via OS keychain (token never enters chat)

**Critical: don't use the interactive prompt form of `security` / `secret-tool` / `cmdkey`.** Atlassian scoped tokens end with `=<CRC>` (a checksum); terminal `getpass`-style prompts on macOS Terminal.app and iTerm have been observed to silently truncate the paste at the `=` sign, storing a 128-byte prefix instead of the full ~192-byte token. The result authenticates as 401 because the CRC fails. Symptom: the stored token validates against `printf` length checks (the prefix is well-formed) but every API call returns 401 with `x-failure-category: FAILURE_CLIENT_AUTH`.

Always pipe from the clipboard instead. Print platform-specific commands that take `$(pbpaste)` / `$(xsel)` / `$(Get-Clipboard)` directly into the `-w` / store arg:

```bash
case "$(uname -s)" in
  Darwin)
    cat <<EOF
1. Click "Copy" in the Atlassian token-create modal so the token is in your clipboard.
2. Run this single line in your terminal — leading space keeps it out of zsh history:

   security delete-generic-password -s lisa-atlassian -a "$EMAIL" 2>/dev/null;  TOK="\$(pbpaste)"; security add-generic-password -U -s lisa-atlassian -a "$EMAIL" -w "\$TOK"; unset TOK

The token is piped from clipboard straight to keychain — no prompt, no truncation.
EOF
    ;;
  Linux)
    if command -v secret-tool >/dev/null 2>&1; then
      # Pick whichever clipboard tool is available.
      if   command -v wl-paste >/dev/null 2>&1; then CLIP=wl-paste
      elif command -v xclip    >/dev/null 2>&1; then CLIP="xclip -selection clipboard -o"
      elif command -v xsel     >/dev/null 2>&1; then CLIP="xsel --clipboard --output"
      else CLIP="cat"  # caller will have to paste; fallback path below
      fi
      cat <<EOF
1. Click "Copy" in the Atlassian token modal so the token is in your clipboard.
2. Run this single line in your terminal:

   secret-tool clear service lisa-atlassian account "$EMAIL" 2>/dev/null; printf '%s' "\$($CLIP)" | secret-tool store --label="Lisa Atlassian ($EMAIL)" service lisa-atlassian account "$EMAIL"

(If no clipboard tool is installed, the command will read from stdin — paste your token, press Ctrl-D.)
EOF
    else
      cat <<EOF
libsecret / secret-tool is not installed. Options:

  1. Install it (recommended on desktop Linux):
       Debian/Ubuntu:  sudo apt install libsecret-tools
       Fedora/RHEL:    sudo dnf install libsecret
     Then re-run /lisa:setup:atlassian.

  2. Fall back to env-var storage (headless / CI / Docker):
       Add this line to your shell rc (.bashrc / .zshrc):
         export ATLASSIAN_API_TOKEN_$(echo "$EMAIL" | tr '[:upper:]@.' '[:lower:]__')="<paste-token-here>"
       Reload shell. Be aware: token will be in plaintext on disk.
EOF
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    cat <<EOF
1. Click "Copy" in the Atlassian token modal so the token is in your clipboard.
2. Run this in PowerShell (cmdkey doesn't accept piped passwords; this uses Credential Manager via PowerShell):

   \$tok = Get-Clipboard; cmdkey /generic:"lisa-atlassian-$EMAIL" /user:"$EMAIL" /pass:"\$tok"; Remove-Variable tok
EOF
    ;;
  *)
    cat <<EOF
Unknown platform. Fall back to env-var:

  export ATLASSIAN_API_TOKEN_$(echo "$EMAIL" | tr '[:upper:]@.' '[:lower:]__')="<token>"

Add to your shell rc to persist.
EOF
    ;;
esac
```

**Do NOT accept the token via chat or stdin into this skill.** The user runs the command themselves; the token enters only the OS keychain. The clipboard-pipe form is mandatory — never advise the interactive `-w` (no-arg) prompt form, which truncates scoped tokens at the `=` sign on multiple terminal/readline combos.

Wait for the user to confirm they've stored it.

#### 3d. Verify retrieval

After the user confirms storage, retrieve via the same `read_token` ladder and validate. Use a **v2 endpoint** (not v1) since v1 returns 410 Gone — and v2 is what `atlassian-access` actually uses at runtime.

```bash
NEW=$(read_token "$EMAIL")
if [ -z "$NEW" ]; then
  echo "Error: token not retrievable from any source. Re-check the storage command and try again." >&2
  exit 1
fi

# Length probe — Atlassian scoped tokens are ~192 chars (token body + '=' + CRC).
# A stored value shorter than ~150 chars almost certainly means the terminal truncated
# the paste at the '=' separator before the CRC.
if [ ${#NEW} -lt 150 ]; then
  echo "Error: token is ${#NEW} chars — too short. Scoped tokens are ~192 chars and end with '=<CRC>'." >&2
  echo "Likely your terminal truncated the paste. Use the clipboard-pipe form in Step 3c." >&2
  exit 1
fi

AUTH=$(printf '%s:%s' "$EMAIL" "$NEW" | base64)
PROBE=$(curl -s -o /tmp/lisa-probe -w "%{http_code}" \
  -H "Authorization: Basic $AUTH" \
  "https://api.atlassian.com/ex/confluence/${CLOUDID}/wiki/api/v2/pages/$(jq -r '.confluence.parentPageId // empty' .lisa.config.json)")
# If no parentPageId in config, fall back to a generic spaces list (also v2).
if [ -z "$(jq -r '.confluence.parentPageId // empty' .lisa.config.json)" ]; then
  PROBE=$(curl -s -o /tmp/lisa-probe -w "%{http_code}" \
    -H "Authorization: Basic $AUTH" \
    "https://api.atlassian.com/ex/confluence/${CLOUDID}/wiki/api/v2/spaces?limit=1")
fi

if [ "$PROBE" != "200" ]; then
  echo "Error: token probe returned HTTP $PROBE." >&2
  cat /tmp/lisa-probe >&2
  echo "" >&2
  echo "Likely causes: missing required scope (see Step 3b), or token was truncated during paste." >&2
  exit 1
fi
rm -f /tmp/lisa-probe
echo "Token validated (${#NEW} chars). Confluence v2 access ready."
```

#### 3e. CI / headless instructions

For pipelines that can't use keychain: the token comes in via `ATLASSIAN_API_TOKEN` as a pipeline secret env var. No setup-skill changes needed; the lookup ladder already prefers env. Document this in the project's CI README rather than the skill.

### Step 4 — Resolve cloudId

If acli is installed and authenticated:

```bash
acli auth status --output json
# Returns { "site": "...", "email": "...", ... } — but cloudId is not always returned by acli.
```

If the MCP is available, call `mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources` and pick the entry whose `url` matches the desired site. Its `id` is the cloudId.

If the user has multiple sites under their account, use `AskUserQuestion` to disambiguate, presenting each site's URL + cloudId as an option.

### Step 5 — Write config files (split by ownership)

Shared fields → `.lisa.config.json` (committed). Developer-specific fields → `.lisa.config.local.json` (gitignored). This is non-negotiable: a developer's email pinned in the committed file would break every other developer on the project.

**Shared fields (committed):**

```bash
touch .lisa.config.json
[ -s .lisa.config.json ] || echo '{}' > .lisa.config.json
jq --arg cloudid "$CLOUDID" \
   --arg site "$SITE" \
   '.atlassian = ((.atlassian // {}) | .cloudId = $cloudid | .site = $site)' \
   .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

**Developer-specific fields (local override, gitignored):**

```bash
touch .lisa.config.local.json
[ -s .lisa.config.local.json ] || echo '{}' > .lisa.config.local.json
jq --arg email "$EMAIL" \
   '.atlassian = ((.atlassian // {}) | .email = $email)' \
   .lisa.config.local.json > .lisa.config.local.json.tmp \
   && mv .lisa.config.local.json.tmp .lisa.config.local.json
```

Confirm `.lisa.config.local.json` is gitignored (it should already be — lisa's bootstrap template adds it). If not, surface the issue and add it. NEVER write `email` to the committed file under any circumstances; if a user explicitly insists, refuse and explain why.

### Step 6 — Verify

```bash
jq -e '.atlassian.cloudId' .lisa.config.json >/dev/null
acli auth status     # if acli installed
```

Report success with the resolved `cloudId` and `site`. Direct the user to `/lisa:setup:jira` and/or `/lisa:setup:confluence` next, depending on what they need.

## Idempotency

- Re-running this skill replaces the `atlassian` section's fields rather than appending. Use `jq` merge semantics (above) — never raw-append JSON.
- If the section already exists and matches the resolved values, exit successfully without prompting.
- If the section exists but mismatches (different site/cloudId), prompt via `AskUserQuestion` whether to overwrite or abort.

## Rules

- Never write secrets to `.lisa.config.json`. Tokens stay in env / acli's `~/.config/acli/` / the MCP's keychain entry.
- Never edit `.claude/settings.json` by hand-concatenation — always use `jq` to preserve the JSON shape.
- Never default `tracker` or `source` from this skill — that is the job of `setup-jira` / `setup-confluence`.
- If the user has multiple Atlassian accounts available locally, ask explicitly which to pin to this project; do not silently pick one.
