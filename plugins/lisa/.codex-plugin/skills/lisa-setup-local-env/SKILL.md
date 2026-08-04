---
name: lisa-setup-local-env
description: "Bring a developer's machine in…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Setup Local Environment: $ARGUMENTS

Make this machine match what the project says it needs.

## Why this exists separately

`remoteEnv.tools` was always the manifest for **every** surface, and the executor always
understood `local`. What did not exist was a way to ask for it. The only path ran a file named
`setup-remote-env.mjs`, out of a directory named `lisa-remote-env`, via a skill named
`lisa-setup-remote-env` — and it only existed at all once someone had provisioned a *remote*
environment, because that is what writes it into the repository.

So the machine most likely to be missing a tool was the one with no way to ask about it.

This skill is that surface. It adds no manifest, no pins, and no installer: it imports the
ones the remote flow owns. A second installer would be a second thing to keep honest, and the
one people run least is the one that rots.

## Usage

```sh
node scripts/local-env.mjs                  # report what diverges
node scripts/local-env.mjs --install-tools  # install what is missing
node scripts/local-env.mjs --json           # machine-readable plan
```

Exit status is non-zero when a tool cannot be resolved, so this is usable as a gate.

## What differs from a container

Two things, and both are because a person is here.

**Consent.** A container is disposable and provisions itself silently — that is the whole
point of it. A laptop belongs to someone, and putting pinned binaries into their
`~/.local/bin` uninvited is not ours to decide. Nothing installs until `--install-tools`.
Reporting happens either way, because knowing the machine diverges from what the project
declares is most of the value.

**The pin is a floor, not an equality.** A container should hold exactly the pinned version;
it exists to be reproducible. A developer's machine is shared with every other project they
work on, so installing a pinned binary ahead of a **newer** one already on `PATH` is a
downgrade this project imposed on all of them. A newer tool is reported as `newer` and left
alone. Older, or absent, is an install.

## Platform pins

An install entry either serves every platform — true of `npm-global` and nothing else — or
declares a `platforms` map keyed `<platform>-<arch>`, each block carrying its own `install`
method, `url`, and `sha256`:

```json
{
  "name": "gh",
  "version": "2.83.0",
  "platforms": {
    "linux-x64":    { "install": "release-tar", "url": "...linux_amd64.tar.gz", "sha256": "...", "binary": "gh_2.83.0_linux_amd64/bin/gh" },
    "darwin-arm64": { "install": "release-zip", "url": "...macOS_arm64.zip",    "sha256": "...", "binary": "gh_2.83.0_macOS_arm64/bin/gh" }
  }
}
```

The method lives **inside** each block because it varies: gh publishes a `.tar.gz` for Linux
and a `.zip` for macOS, so a single method would have forced one platform onto an archive kind
its vendor does not ship.

When a tool has no block for the running platform, this skill says so and stops there. It will
not guess a download URL — a guessed artifact is one the checksum cannot vouch for, and the
checksum is the only thing standing between a pinned entry and whatever a URL serves today.
Add the block, or install that one tool however the platform normally would.

## Detect before you install

Run `/lisa:detect-tooling` when the report looks thin. The manifest is the only thing that puts
a binary on `PATH`, and nothing populates it automatically — so a project ships npm scripts
invoking `maestro`, wires an MCP server whose CLI it also shells out to, and configures
Playwright thresholds, while `remoteEnv.tools` stays empty and each of those fails at the
moment of use instead of at setup.

The detector proposes and a human decides. It writes nothing, so a tool still only ever reaches
a machine from a reviewed, pinned, checksummed entry.

## What it will not do

- **No unpinned installs.** Every install goes through the same `assertPinned` gate the remote
  flow uses, and the same in-process checksum verification, which refuses before unpacking.
- **No package-manager fallback.** Shelling out to Homebrew would give no version pin and no
  checksum, which is the property this design exists to enforce.
- **No writes to the manifest.** Proposing entries belongs to `/lisa:detect-tooling`; deciding
  belongs to a human reviewing a diff.
