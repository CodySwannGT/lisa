---
name: lisa-secrets-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Secrets Access: $ARGUMENTS

Single chokepoint for reading credentials. Caller skills MUST go through this — they MUST NOT read the OS keychain, parse a `.env`, or invoke a provider CLI themselves.

The rule this exists to enforce: **a secret lives in exactly one store.** Every local cache is a copy that will eventually drift from its source, and a drifted copy is indistinguishable from a valid one until something fails in production.

## Invocation contract

```text
operation: get      name: ATTIO_API_KEY
operation: list                                  # names only, never values
operation: describe name: ATTIO_API_KEY          # the usage note, not the value
operation: verify                                # every declared secret resolves
```

`get` returns the value on stdout and nothing else. `list` and `describe` never emit a secret value.

## Configuration

In `.lisa.config.json`:

```json
{
  "secrets": {
    "provider": "bitwarden",
    "bootstrap": { "sources": ["env", "keychain"], "key": "BWS_ACCESS_TOKEN" },
    "require": ["ATTIO_API_KEY", "SLACK_WEBHOOK_URL"]
  }
}
```

**`provider`** — `bitwarden` | `1password` | `aws` | `doppler` | `vault` | `env`.

**`bootstrap`** — how to obtain the one credential that unlocks the rest. `sources` is ordered: environment first, so CI injection wins over any local copy. This is the **only** credential permitted in a keychain; it is a bootstrap, not a cache.

**`require`** — optional. Omit it and every secret the provider grants is available, which is correct when the provider already scopes access per project. Present, it narrows to exactly those names **and asserts them**: a listed name that does not resolve is a startup error, not a late surprise. Use it when a repo needs a subset of a deliberately broader project.

There is no map of secret IDs, deliberately. Copying an ID per secret is the same duplication in a smaller costume, and lookup is by name.

## The naming convention this rests on

**A secret's key is the exact environment-variable name.** No inference, no fuzzy matching, no case folding. A secret named `attio-prod` will not resolve for `ATTIO_API_KEY`, and the error says so rather than silently returning nothing.

Enforce it: `doctor` should warn on any key that is not a valid `UPPER_SNAKE_CASE` identifier.

## Workflow

### Step 1 — Environment first

If `$<NAME>` is set and non-empty, return it. This is how CI injects secrets, and it means a scheduled run never touches the provider or a local store.

### Step 2 — Bootstrap

Resolve the bootstrap credential by walking `bootstrap.sources` in order. Fail with an actionable message naming where it was looked for.

### Step 3 — Provider lookup by name

| Provider | Read |
| --- | --- |
| `bitwarden` | `bws secret list` → index by `key` |
| `1password` | `op read "op://<vault>/<name>/credential"` |
| `aws` | `aws secretsmanager get-secret-value --secret-id <name>` |
| `doppler` | `doppler secrets get <name> --plain` |
| `vault` | `vault kv get -field=<name> <path>` |
| `env` | environment only; the provider is the environment |

Cache **in-process only**. Never write a resolved value to disk — that recreates the problem this skill exists to remove.

### Step 4 — Fail loudly and usefully

A missing name reports what *is* visible, so the caller can see immediately whether the secret is absent or merely misnamed:

```text
GOOGLE_SERVICE_ACCOUNT_JSON is not available to this account.
Visible: APOLLO_API_KEY, ATTIO_API_KEY, SLACK_WEBHOOK_URL
A secret's key must be the exact environment variable name.
```

## Usage metadata lives on the secret

Every provider has a description field — Bitwarden `note`, 1Password notes, AWS `Description`, Doppler notes, Vault custom metadata. **That is where a secret's usage documentation belongs**, not in a config file: a note travels with the secret and therefore cannot drift from it, which is precisely the property config lacks.

Format — first line prose, then `key: value` lines:

```text
Attio CRM - system of record for the sales funnel.
scope: object_configuration, record, list_entry - read-write
owner: <name>
ci: yes - injected by <mechanism>
docs: <path>
```

`describe` returns this. When a note is empty, **infer purpose from the name, mark it inferred, and report the gap** — infer *and* warn, never instead of. A silent fallback that works well enough guarantees the notes stay empty forever.

**An inferred mapping must never authorise a write.** It orients a reader; it does not pick which credential calls a production API. `ATTIO_API_KEY` versus `ATTIO_API_KEY_STAGING` is exactly the guess that silently writes to the wrong system.

## This skill never writes

No create, no update, no rotate. Writing secrets or their notes requires an authority a CI credential should not hold, and a read-only path cannot be turned against the vault if it leaks.

Where a rotating credential must persist a new value — an OAuth refresh token that the issuer replaces on every use — that is a **separate, deliberately-scoped writer**, and exactly one process may hold that loop. Two refreshers race, and each invalidates the other's token silently.

## Doctor checks worth wiring

- Every name in `require` resolves.
- Every key matches `^[A-Z][A-Z0-9_]*$`.
- No secret has an empty note.
- **No secret is readable from two stores.** A value present in both the provider and a local cache is not a duplicate — it is **two live credentials**, one of which is untracked. This is the check most worth having: it catches drift before a deletion turns the forgotten copy into an orphan nobody can revoke.

## Rules

1. **Never read a keychain, `.env`, or provider CLI outside this skill.** One chokepoint is what makes the single-store rule enforceable.
2. **Never log a secret value.** Print a length or a hash prefix when proving identity.
3. **Never write a resolved value to disk**, including "temporary" files.
4. **Verify a credential when it is stored, not when it is first used.** An unverified credential is indistinguishable from a broken one, and the gap between the two is measured in weeks.
5. **Treat a mismatch as stop-and-ask.** If a value differs between two places, they are two live credentials — not a stale copy to be discarded. Deleting the one you cannot verify leaves a working credential that no record accounts for.
