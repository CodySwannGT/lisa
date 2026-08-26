---
name: lisa-setup-remote-env
description: "Provision and verify a remote…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Setup Remote Environment: $ARGUMENTS

Prepare a remote surface so a host project can execute there. Today that means **Codex Cloud**; the shape is deliberately surface-agnostic so Claude Code web, Cursor remote, and others slot in without redesign.

## What lives where

The remote environment's own configuration fields stay **one line into the repository**. Nothing else is pasted into a vendor UI.

**Ask for that line; do not copy it from here.**

```bash
npx -y @codyswann/lisa@latest remote-env --emit=claude-web
```

The field pins the exact Lisa it runs, and the emitter reads that version from
the package it is running out of — so the line it prints is always pinned to the
version that printed it.

A copy written into this file cannot have that property. It is a snapshot taken
when the package was *built*, and the release bumps the version *after* the
build, so a published tarball's copy names the previous release. That is not a
cosmetic lag: the pinned version predates whatever this file documents, so a
pasted copy can call flags that version does not implement. Measured on
`2.338.1`, whose embedded copy named `2.338.0` — a Lisa with no `--print-tools`,
no `--tools`, and no `tools-from-notes.mjs`. Unknown flags are ignored rather
than rejected, so it did not fail; it installed the full catalogue and re-ran the
whole setup, three times over, inside a five-minute budget.

**That line is identical for every project AND every surface.** Nothing in it names the
repository or the package manager, so it can be pasted unchanged anywhere.

Locating the checkout is the only hard part, because the surfaces disagree about where the
field runs:

| Surface | cwd when the field runs | Checkout |
| --- | --- | --- |
| Codex Cloud | **is** the checkout | `/workspace/<repo>` |
| Claude Code web | `$HOME`, but not reliably | `$HOME/<repo>`, or another root |

So the checkout itself and one level down are tried **relative to cwd first**, then the same
pair under `$HOME` and `/workspace` — the roots the two surfaces actually use — because cwd is
not reliably either of them: a live Claude environment reported `$HOME` as `/root` with the
checkout at `/home/user/lisa`, which a cwd-only search cannot reach.

The cwd-relative candidates coming **first** is the invariant, and a test pins it. An earlier
version of this field used `bash "$HOME"/*/scripts/...` alone, which works on Claude Code web
and fails on Codex Cloud, where the checkout is not under `$HOME` at all: the glob matches
nothing and bash reports `No such file or directory` for a path still containing a literal `*`.

**Every** match is prepared, not the first. A Claude Code web environment can hold more than
one checkout, and stopping at the first glob hit would prepare whichever repository sorts
first and silently ignore the rest — arbitrary rather than merely limited. Each script
anchors itself on its own repository root, and each project's secrets land under its own
`secrets.namespace`, so preparing several is well defined rather than a collision.

The exit status is the **first failure**, and every checkout is still attempted: one broken
repository must not hide the state of the others, and it must not report success either.

The explicit `exit 1` on `n=0` means a missing entrypoint says so rather than the field
silently succeeding — a `for` loop over a glob that matches nothing otherwise exits `0`,
which is the quiet failure this whole section exists to avoid.

They are the same command. A container may be built fresh or resumed from cache; every step is idempotent and version-aware, so running it twice is correct, and running it on resume is what picks up a rotated value, an edited note, or a changed version pin.

The complete logic is repository-owned so it is reviewed, versioned, tested, and reusable. A large inline installer in a settings field is none of those things — and neither is a repository name and a package manager, which is what this field used to carry.

### The script installs the dependencies itself

**A clone does not contain the skills on the harnesses that matter here.** OpenCode and Antigravity have them written into the checkout by `lisa apply`. Claude and Codex receive them as an *installed plugin*, which lives in the user's home directory — so a container that has just cloned the repository has never seen it.

`node_modules/@codyswann/lisa` is therefore the only copy present on a fresh container, and it is a good one: it is the version that project pins, which is the version its setup should run. The entrypoint searches the agent directories first and falls back to it.

So the install has to happen before the runner is resolved — and the entrypoint does it, rather than the settings field. Which package manager is read from the lockfile the project actually commits (`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`), never guessed: a guessed one fails on the container's first command with an error that blames the project rather than the guess. The step is skipped when `node_modules` already exists, which is what keeps a resumed container cheap, and `LISA_SKIP_INSTALL=1` opts out entirely for a caller that has already installed.

A project with no lockfile is not fatal on its own — a checkout may carry the skill directly — so the script says so and lets the resolver decide.

## The three phases

1. **Toolchain** — assert what must already be present, install what is not.
2. **Secrets** — materialize through `lisa-secrets-access`. This skill never reimplements any part of that contract; the single chokepoint is what makes the one-store rule enforceable.
3. **Project hook** — an optional `setup.local.sh` the project owns.

Order matters. The toolchain comes first because the secrets step needs the provider CLI it installs. The hook comes last because it is the only part that may assume everything else is ready.

### Which phases run depends on the surface

Not every surface runs all three here, and the reason is worth understanding before changing it.

A surface that **re-runs this script when a container resumes** — Codex Cloud — should materialize during setup. Re-running is exactly what picks up a rotated value, an edited note, or a changed version pin.

A surface that **skips this script whenever a filesystem cache exists** — Claude Code web — must not. Materializing here would write the values once and then never refresh them, so a credential rotated on Tuesday would still be serving Monday's value until the cache expired days later. Those surfaces materialize from a session-start hook instead, which runs every session including a resumed one:

```sh
bash scripts/lisa-remote-env/session-start.sh   # guard; reruns toolchain, secrets, then hook
```

The selection comes from the surface's `materializeAt` capability in `lisa-secrets-access`, not from its name, so adding a surface does not mean editing a branch. The hook is committed to the repository, so it also fires on a developer's machine — it exits `0` immediately there rather than failing, because a correct local session must not look broken.

## Detect before you provision

Run `/lisa:detect-tooling` first, every time. The manifest is the only thing that puts a binary on `PATH`, and nothing populates it — so a project ships npm scripts invoking `maestro`, wires an MCP server whose CLI it also shells out to, and configures Playwright thresholds, while `remoteEnv.tools` stays empty and each of those fails at the moment of use instead of at setup.

This repository has paid for that twice: `gh` was declared nowhere and a cloud session could not commit anything; `tar` was needed by an install method and asserted by nothing.

The detector proposes and a human decides. It writes nothing, so provisioning still only ever happens from a reviewed, pinned, checksummed entry.

## The same manifest provisions a laptop

`remoteEnv.tools` is not a remote-only manifest, and `/lisa:setup:local-env` is how a developer
applies it to their own machine — same pins, same checksums, same installers, differing only in
that nothing installs without `--install-tools` and that a newer tool already on `PATH` is left
alone rather than downgraded.

A downloaded tool declares a `platforms` map keyed `<platform>-<arch>`, each block carrying its
own `install` method, `url`, and `sha256`, because the artifact and the archive kind both vary
by platform. Before that existed, the only way to keep a Linux binary off a laptop was
`surfaces: ["remote"]`, which achieved it by making the tool uninstallable there — so `bws` and
`gh` were required on developer machines and provisionable only in containers.

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
          "name": "gh",
          "version": "2.83.0",
          "platforms": {
            "linux-x64": {
              "install": "release-tar",
              "url": "https://<vendor>/releases/download/v2.83.0/gh_2.83.0_linux_amd64.tar.gz",
              "sha256": "<sha256 published with that exact release>",
              "binary": "gh_2.83.0_linux_amd64/bin/gh"
            },
            "darwin-arm64": {
              "install": "release-zip",
              "url": "https://<vendor>/releases/download/v2.83.0/gh_2.83.0_macOS_arm64.zip",
              "sha256": "<sha256 published with that exact release>",
              "binary": "gh_2.83.0_macOS_arm64/bin/gh"
            }
          }
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

### The four `install` methods

| `install` | Required fields | Use it when |
| --- | --- | --- |
| `release-zip` | `url` **and** `sha256` | The vendor publishes a Linux zip of the release. |
| `release-tar` | `url` **and** `sha256` — plus `binary` in practice | The vendor publishes no zip for Linux, only a `.tar.gz`. |
| `release-tree` | `url`, `sha256` **and** `binary` | The archive is a **directory**, not a single binary — an entry point that resolves its own siblings at run time. |
| `npm-global` | `package` | The tool ships on the npm registry. |

Anything else is rejected by name at plan time, so a typo fails loudly rather than silently installing nothing.

**`release-tree` exists because the single-file kinds fail silently on a tree.** They extract the archive and copy *one* file onto PATH, which is right for a static binary and wrong for anything that locates its own resources. Maestro is the case that forced it — one 314 MB zip containing:

```text
maestro/bin/maestro     <- launcher
maestro/lib/*.jar       <- 100+ MB of classpath
```

and a launcher that computes `CLASSPATH=$APP_HOME/lib/*` where `APP_HOME` is the parent of wherever the script itself sits. Declared as `release-zip` with `binary: maestro/bin/maestro`, the launcher lands in `~/.local/bin`, `APP_HOME` resolves to `~/.local`, and the classpath points at an empty directory. **The install reports success and the tool dies at first use** with `Could not find or load main class` — exactly the failure this manifest exists to turn into a loud setup error.

So `release-tree` extracts the whole archive to `~/.local/share/<name>/<version>` and puts a **wrapper** on PATH that `exec`s the entry point in place. Not a copy, and deliberately not a symlink either: a launcher that does not resolve symlinks before computing its own location would read the link's directory as its home and look for its resources beside the link — the same broken install, narrowed to a subset of tools. `binary` has no default here, because the archive root is a directory and guessing would install a directory as a binary.

Both archive kinds carry the **same** obligation and differ only in how they are unpacked: `url` and `sha256` are both mandatory, the checksum is verified *before* the archive is unpacked, and a version bump must move the checksum in the same reviewed commit. Neither is a weaker path than the other — `release-tar` exists because some tools worth pinning simply do not publish a zip. `gh` is the case that forced it: it ships `.deb`, `.rpm` and `.tar.gz` and nothing else, so a zip-only installer could not pin the CLI that Lisa's own commit guardrails shell out to.

**`binary` means something different for a tarball.** It defaults to the tool's `name` and is resolved relative to the unpacked directory. Release tarballs almost always nest their contents under a versioned top-level directory, so for `release-tar` it must be the path *within* the archive — `gh_2.83.0_linux_amd64/bin/gh`, not `gh`. A bare name there resolves to nothing after a download that otherwise succeeded, and the install fails at the copy step rather than at the fetch, which reads as a broken release when it is a manifest mistake. Bump the version and this path moves with it, alongside the `url` and the `sha256`.

Because `release-tar` unpacks with `tar` rather than `unzip`, a project using it should assert `tar` in its `require` list the same way a zip-installing project asserts `unzip` — the base image providing it is an assumption, not a contract.

### Rules

- **The base image is not a contract.** A vendor can change it. A project quietly depending on a preinstalled `jq` should break loudly at setup when that happens, not mysteriously mid-task weeks later. `require` is what converts an implicit assumption into an explicit check.
- **Detect first, install second.** Check the installed version, skip when it matches the pin, reinstall only when the pin changed. This is what makes setup and maintenance the same script, and it is the cheap path on cache resume.
- **Version-assert, not just presence.** A base-image bump that moves off a supported Node or Python must be caught. Presence alone is not enough when a project depends on a specific version.
- **Prefer what is there.** A second Node beside the image's creates PATH ambiguity and wastes container time.
- **Pin and checksum together, in one reviewed commit.** A version bump that does not move the checksum fails before installation, not after. An archive is verified *before* it is unpacked, so unexpected contents never reach a directory on PATH.

## Tooling is never *authorised* by secret notes

Deliberately rejected — notes may not cause an install:

- Most tooling has **no credential** — `jq`, ripgrep, browsers, a linter — so notes could only ever cover a subset, and a second mechanism would be needed anyway.
- Most credentials **imply no tool**: a webhook is curl'd, a REST key needs no CLI.
- The mapping is **guesswork** — which CLI, what version, pinned how — and is exactly the inference the secrets contract already forbids from authorising anything.
- It makes **prose load-bearing**: a note lives provider-side, is editable outside review, and is unfixable by a read-only account.
- It is a **supply-chain path** — provider write access would become arbitrary install access.

**Notes are an assertion target instead.** At verify time, a tool that declares a credential which is not materialized is an **error**; a credential materialized with no declared consumer is a **warning**. The arrow points the safe way: the repository declares intent, and the provider is checked against it.

### Reading a note as *evidence* is a different act

`lisa-detect-tooling` does read notes, and this section is why it may. Every objection above is an objection to a note **causing** something: authorising an install, being the sole source, deciding a version. None of that changes.

What the detector produces is a proposal with `<pin>`, `<release url>` and `<sha256>` left blank, printed for a human. It cannot install, cannot write config, and its output is inert until someone commits a pinned, checksummed entry that `assertPinned` then enforces. Provider write access therefore buys an attacker one line of text in a proposal a human reads — not arbitrary install access, which is the specific escalation this section exists to block.

The other objections stay true and stay unfixed: most tooling has no credential and most credentials imply no tool, so notes are one signal among four and the weakest of them. They are read *after* npm scripts and MCP servers, and a note alone should be the least persuasive reason to add anything.

## One command, four surfaces

`lisa environment <surface> --tenant=<name>` configures one surface for one
tenant. The only difference between them is whether Lisa can execute there:

| Surface | What happens | Materializes |
| --- | --- | --- |
| `local` | runs here: stores the bootstrap, materializes, installs AWS profiles | on request |
| `container` | emits an image definition and a `docker run` line | at container start |
| `claude-web` | emits text for the environment dialog | at setup **and** session start |
| `codex-cloud` | emits text for the environment settings | at setup |

None of it needs a checkout, which is the point: the surfaces most in need of
configuration are the ones with no repository attached.

`--tenant` is required on `local` because that path **writes**. Every namespace
is a directory under `$XDG_CONFIG_HOME`, so resolving the wrong one puts one
tenant's credentials where another tenant's sessions read — and on a machine
serving several, the two would share a store. The named tenant also outranks any
`.lisa.config.json` in the working directory: someone who typed `--tenant=acme`
means acme, whichever repository they happen to be standing in.

Re-running `environment local` is how a token is **rotated**. It is not an
installer, so it does not reinstall agents to replace one credential; it reports
that a bootstrap is already stored and leaves it alone unless `--rotate` says
otherwise.

`workstation` remains the separate question — what binaries does this machine
have — with no tenant and no credentials.

`remote-env --emit=<surface>` still works, and is the older spelling of the same
thing. It named the machinery rather than the task: from a laptop it reads as
"prepare the remote environment I am currently in", which is the opposite of
configuring a cloud environment.

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
Setup script:      <printed by `remote-env --emit`; never copied
                   from prose, so its pin is always the version
                   that printed it>
Maintenance:       <same line, printed by the same command>
                   (identical for every project — the script finds the
                   checkout and installs from the committed lockfile)
Environment vars:  LISA_SECRETS_SURFACE=codex-cloud
                   BWS_ACCESS_TOKEN=<from the provider; an environment
                   variable, not a task secret — setup and cache-resume
                   maintenance both run before task secrets exist>
```

### Claude Code web is emit-only, and that is not a fallback

**For Claude Code web there is no tier 1 or tier 2 to fall back from.** A cloud environment is account-scoped configuration — network access level, environment variables, setup script — edited only in the environment selector at claude.ai/code, which has no settings page, no direct URL, and no API. `/remote-env` selects an environment; it cannot create or edit one.

Note what this surface's environment is *not*: it carries no repository. The repository arrives per session, so an environment is reusable across every project, and there is nothing to bind. Its durable handle is the routine that dispatch fires, which is why `remoteEnv.surfaces["claude-web"]` records `routineId` and `fireUrl` rather than a repository.

Generate the exact text to paste:

```sh
node scripts/setup-remote-env.mjs --emit=claude-web
```

It reads the bootstrap name from `secrets.bootstrap.key` and emits the environment fields, the `.claude/settings.json` hook block, and the base-image surprises worth knowing before they cost an afternoon:

- **`gh` is not pre-installed.** If the project's flows shell out to it, add it to `remoteEnv.tools.install`, pinned and checksummed like anything else.
- **A proxied credential reads as the literal string `proxy-injected`.** Tools that authenticate through the GitHub proxy work; a script that reads the variable directly gets the placeholder. The read-back asserts this rather than leaving it to be discovered against a live service.
- **The surfaces disagree about where the setup field runs.** Codex Cloud runs it inside the checkout; Claude Code web runs it from `$HOME` with the checkout one level down. That is why the field tries the checkout itself and then one level down relative to cwd, and only then the same pair under `$HOME` and `/workspace` — the script anchors itself on whichever matched. Nothing in the emitted line names this project, so it is the same line everywhere.
- **Trusted network access is not enough for provider CLIs.** Use Custom and include package registries, GitHub, cloud SDK hosts, and the bootstrap credential manager API.

### One environment per project, pinned locally

An environment is **not** bound to a repository — the repository arrives per session, and one environment is technically reusable across all of them. Give each project its own anyway, because an environment's *contents* are project-shaped: its setup script is a repository-relative path and its bootstrap is scoped to that project's secrets. Pointing one project's session at another's environment runs a setup script that may not exist there, and a setup script that exits non-zero means the session never starts.

`/remote-env` writes `remote.defaultEnvironmentId` into **user** settings, which is one value for the whole machine — wrong as soon as a developer has two projects. Pin it per project instead:

```sh
node scripts/setup-remote-env.mjs --install --pin-env=<environment-id>
```

That writes `.claude/settings.local.json`, which outranks user settings and is gitignored — correct on both counts, since an environment belongs to one developer's account and is meaningless in someone else's checkout. Existing keys in that file are merged, not replaced; it commonly holds permission grants worth keeping.

**Only the bootstrap belongs in the environment-variable box.** Values there are stored as plain text and are readable by anyone who uses the environment — on an organization-shared environment, that is every member of the organization. Everything else is materialized by the session-start hook. There is no dedicated secrets store on this surface, and personal versus shared environments cannot be told apart programmatically, so this one is a rule the operator upholds rather than something the tooling can enforce.

## Verification is tier-independent

**Whatever tier provisioned it, the same read-back proves it.** Trust comes from the verify, not the mechanism — which is what makes emit-tier as trustworthy as API-tier.

```sh
scripts/verify-remote-env.mjs [SECRETS_DIR]
```

Asserts, without printing a value: each declared tool at its pinned or minimum version, the detected surface, the secrets directory at mode `0700`, both files at mode `0600`, a clean checkout, and that every name in `secrets.require` resolves to a real credential rather than a proxy placeholder.

That last one exists because presence is a weaker claim than usability. A credential the surface keeps outside the sandbox and substitutes at egress is present and non-empty, so a presence check passes — and a script that reads the variable and puts it in a header sends the placeholder and fails against the service, with an error pointing anywhere but at the environment.

**Never verify against vendor UI state.** On 2026-08-01 a Codex environments table reported zero tasks for an environment that had demonstrably completed one, because the task records carried a null environment identifier and the `--env` filter was correspondingly unreliable. Reconcile through durable identifiers only.

## Preconditions

Checked when setup runs, not at 3am:

- the environment exists, and on a surface that binds one, is bound to **this** repository as its default checkout — Claude cloud environments bind no repository at all, so there is nothing to check there;
- the bootstrap credential resolves;
- either a checkout-local Lisa skill is present, or the project dependency install has made the pinned `@codyswann/lisa` package available under `node_modules`.

Fail with a message naming what is missing. Never provision-and-hope.

## Bootstrap credential placement

On Codex Cloud the bootstrap must be an **environment variable, not a task secret**: setup runs on a new container and maintenance runs on cache resume, both before task secrets exist. The tradeoff is that the variable remains visible during the task, so compensate by keeping the machine account narrowly scoped and instructing the task never to inspect or use it.

On Claude Code web the same placement applies for the same reason, with the exposure widened rather than narrowed: there is no secrets store, values are stored as plain text, and anyone who uses the environment can read them. On an organization-shared environment that is every member. Keep the bootstrap in a **personal** environment, scope the machine account to the minimum, and treat every other credential as something the session-start hook materializes rather than something a human pastes.

## Related

- `lisa-secrets-access` — owns every part of the secrets contract this skill composes with.
- `lisa-remote-dispatch` — dispatches work to an environment this skill prepared.
