---
name: lisa-setup-remote-env
description: "Provision and verify a remote…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Setup Remote Environment: $ARGUMENTS

Prepare a remote surface so a host project can execute there. Today that means **Codex Cloud**; the shape is deliberately surface-agnostic so Claude Code web, Cursor remote, and others slot in without redesign.

## What lives where

The remote environment's own configuration fields stay **two one-line calls into the repository**. Nothing is pasted into a vendor UI.

```text
setup:       bash scripts/lisa-remote-env/setup.sh
maintenance: bash scripts/lisa-remote-env/setup.sh
```

They are the same script. A container may be built fresh or resumed from cache; every step is idempotent and version-aware, so running it twice is correct, and running it on resume is what picks up a rotated value, an edited note, or a changed version pin.

The complete logic is repository-owned so it is reviewed, versioned, tested, and reusable. A large inline installer in a settings field is none of those things.

## The three phases

1. **Toolchain** — assert what must already be present, install what is not.
2. **Secrets** — materialize through `lisa-secrets-access`. This skill never reimplements any part of that contract; the single chokepoint is what makes the one-store rule enforceable.
3. **Project hook** — an optional `setup.local.sh` the project owns.

Order matters. The toolchain comes first because the secrets step needs the provider CLI it installs. The hook comes last because it is the only part that may assume everything else is ready.

## Toolchain manifest — two entry kinds

```json
{
  "remoteEnv": {
    "tools": {
      "require": [
        { "name": "python3" },
        { "name": "node", "minVersion": "20" },
        { "name": "curl" },
        { "name": "unzip" }
      ],
      "install": [
        {
          "name": "bws",
          "version": "2.1.0",
          "install": "release-zip",
          "url": "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-x86_64-unknown-linux-gnu-2.1.0.zip",
          "sha256": "ba8233c3a4aee5d43e3c73bbd04d99e9bc5aba13bbbfd06d89b073abe732b860"
        },
        {
          "name": "codex",
          "version": "0.144.6",
          "install": "npm-global",
          "package": "@openai/codex"
        }
      ]
    },
    "hook": "scripts/lisa-remote-env/setup.local.sh",
    "surfaces": {
      "codex-cloud": {
        "environmentId": "<id>",
        "repository": "<org>/<repo>",
        "branch": "main"
      }
    }
  }
}
```

**`require`** — assert present, optionally at a minimum version. For everything the base image already provides.

**`install`** — provision it, pinned and checksummed. Only for what genuinely is not there.

Expected shape for most projects: a short `require` list, an empty or near-empty `install` list, and the provider CLI as the only thing always provisioned.

### Rules

- **The base image is not a contract.** A vendor can change it. A project quietly depending on a preinstalled `jq` should break loudly at setup when that happens, not mysteriously mid-task weeks later. `require` is what converts an implicit assumption into an explicit check.
- **Detect first, install second.** Check the installed version, skip when it matches the pin, reinstall only when the pin changed. This is what makes setup and maintenance the same script, and it is the cheap path on cache resume.
- **Version-assert, not just presence.** A base-image bump that moves off a supported Node or Python must be caught. Presence alone is not enough when a project depends on a specific version.
- **Prefer what is there.** A second Node beside the image's creates PATH ambiguity and wastes container time.
- **Pin and checksum together, in one reviewed commit.** A version bump that does not move the checksum fails before installation, not after. An archive is verified *before* it is unpacked, so unexpected contents never reach a directory on PATH.

## Tooling is never derived from secret notes

Deliberately rejected:

- Most tooling has **no credential** — `jq`, ripgrep, browsers, a linter — so notes could only ever cover a subset, and a second mechanism would be needed anyway.
- Most credentials **imply no tool**: a webhook is curl'd, a REST key needs no CLI.
- The mapping is **guesswork** — which CLI, what version, pinned how — and is exactly the inference the secrets contract already forbids from authorising anything.
- It makes **prose load-bearing**: a note lives provider-side, is editable outside review, and is unfixable by a read-only account.
- It is a **supply-chain path** — provider write access would become arbitrary install access.

**Notes are an assertion target instead.** At verify time, a tool that declares a credential which is not materialized is an **error**; a credential materialized with no declared consumer is a **warning**. The arrow points the safe way: the repository declares intent, and the provider is checked against it.

## Provisioning tiers

Preference order, falling back:

1. **API** — provision programmatically.
2. **Console** — drive the vendor's web console.
3. **Emit** — generate exact config for a human to paste.

**For Codex Cloud today, start at tier 2 or 3.** Verified on 2026-08-01: `codex cloud` exposes only `exec | status | list | apply | diff`. There is no environment-provisioning subcommand, so there is nothing to call. Do not claim tier 1 for this surface until the CLI grows one.

When emitting, produce exactly:

```text
Environment name:  <project> remote executor
Repository:        <org>/<repo>        (must be the default checkout)
Setup script:      bash scripts/lisa-remote-env/setup.sh
Maintenance:       bash scripts/lisa-remote-env/setup.sh
Environment vars:  LISA_SECRETS_SURFACE=codex-cloud
                   BWS_ACCESS_TOKEN=<from the provider; an environment
                   variable, not a task secret — setup and cache-resume
                   maintenance both run before task secrets exist>
```

## Verification is tier-independent

**Whatever tier provisioned it, the same read-back proves it.** Trust comes from the verify, not the mechanism — which is what makes emit-tier as trustworthy as API-tier.

```sh
scripts/verify-remote-env.mjs [SECRETS_DIR]
```

Asserts, without printing a value: each declared tool at its pinned or minimum version, the detected surface, the secrets directory at mode `0700`, both files at mode `0600`, and a clean checkout.

**Never verify against vendor UI state.** On 2026-08-01 a Codex environments table reported zero tasks for an environment that had demonstrably completed one, because the task records carried a null environment identifier and the `--env` filter was correspondingly unreliable. Reconcile through durable identifiers only.

## Preconditions

Checked when setup runs, not at 3am:

- the environment exists and is bound to **this** repository as its default checkout;
- the bootstrap credential resolves;
- Lisa has been applied to the repository, so its skills are present in that checkout.

Fail with a message naming what is missing. Never provision-and-hope.

## Bootstrap credential placement

On Codex Cloud the bootstrap must be an **environment variable, not a task secret**: setup runs on a new container and maintenance runs on cache resume, both before task secrets exist. The tradeoff is that the variable remains visible during the task, so compensate by keeping the machine account narrowly scoped and instructing the task never to inspect or use it.

## Related

- `lisa-secrets-access` — owns every part of the secrets contract this skill composes with.
- `lisa-remote-dispatch` — dispatches work to an environment this skill prepared.
