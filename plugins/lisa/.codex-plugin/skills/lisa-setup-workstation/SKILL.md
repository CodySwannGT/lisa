---
name: lisa-setup-workstation
description: "Prepare a machine — a fresh…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Setup Workstation: $ARGUMENTS

Get a machine ready to run agents. No checkout required.

## Why this exists separately

`lisa-setup-local-env` reads `remoteEnv.tools` — a **project's** declared toolchain — so it
needs a checkout to exist before it can answer anything. That leaves a gap at the start:
a bare laptop or an empty container has no repository yet, and therefore nothing to ask.

This skill fills that gap and stops there. It describes a **machine**, never a project:

```text
workstation  ->  git clone  ->  lisa-detect-tooling  ->  lisa-setup-local-env
```

Project-scoped tools stay in `remoteEnv.tools` where they belong. Nothing here reads a
repository, and nothing here duplicates that manifest.

## Usage

**Start here — this is the entry point that presumes nothing:**

```sh
npx -y @codyswann/lisa@latest workstation             # report what is present and missing
npx -y @codyswann/lisa@latest workstation --install   # install what is missing
```

That form needs only Node. No checkout, no agent, no Lisa install — npx resolves
the package into its own cache.

**Why it matters:** this skill exists to prepare a machine with *no coding agent*
and *no checkout*. But a skill can only be invoked by typing a slash command into
an agent, and Lisa ships as a devDependency, so it does not exist until a repo is
cloned and its dependencies installed. Both are exactly the state this is meant to
create — so as a skill alone, the bootstrap was unreachable in the one scenario it
was designed for. The CLI is the way in; the skill is the surface for people who
already have an agent.

Every flag is the same either way:

```sh
lisa workstation --install --agents=claude,codex   # only these agents
lisa workstation --provider=bitwarden              # credential manager (asked if a TTY)
lisa workstation --json                            # machine-readable plan
lisa workstation --print-dockerfile                # an image that runs this same script
```

Inside an agent, `/lisa:setup:workstation` runs the identical script; and the
script itself is directly runnable as `node scripts/cli.mjs …`.

Nothing is installed or written without `--install`. Exit status is non-zero when a required
tool is absent or an install fails, so this is usable as a gate.

## Ephemerality is not a mode

There is no Docker branch anywhere in this skill. A container gets a throwaway `$HOME` and
dies with it; a laptop keeps its own. Same code path either way — so the rarely-run one
cannot rot, which is the failure mode a second install path eventually always has.

`--print-dockerfile` emits an image rather than shipping a committed one, so the image cannot
drift from the catalogue it provisions. It deliberately bakes in **no repository**: clone
inside the container, then run `lisa-detect-tooling` and `lisa-setup-local-env` for that
project's own tools.

```sh
node scripts/cli.mjs --print-dockerfile --agents=claude,codex --provider=bitwarden > Dockerfile
docker build -t lisa-workstation . && docker run --rm -it lisa-workstation
```

## Already-installed wins, however it got there

A tool present by **any** means is reported and left alone. That dissolves the "Homebrew or
`~/.local/bin`" question entirely: we never contend for ownership of a tool someone else's
package manager installed, and never shadow it with an earlier PATH entry that would silently
win over their upgrades. The report names where each tool came from so the operator can see
why it was skipped.

Running twice installs nothing the second time, and says so rather than going quiet — silence
reads as "did nothing because it broke".

## Install method is a per-tool property, not a global policy

The obvious design — put every binary in `~/.local/bin` so one code path serves a laptop and a
container alike — is wrong, and the agents show why:

```text
claude        -> ~/.local/share/claude/versions/2.1.221
cursor-agent  -> ~/.local/share/cursor-agent/versions/2026.07.16-899851b
codex         -> ~/.codex/packages/standalone/current/bin/codex
```

Each vendor manages its own version directory, and `~/.local/bin` holds only a **symlink**.
Writing a raw binary there breaks the vendor's self-updater, which expects to swap a link
target and would instead find a real file in its way.

So each catalogue entry declares its own method, and the honest cost is recorded with it:

| kind | pinned | checksummed | notes |
| --- | --- | --- | --- |
| `release-zip` / `release-tar` | yes | yes | reuses the remote-env installer |
| `npm-global` | no | no | vendor registry |
| `vendor-script` | no | no | pipes a fetched script to a shell |
| `manual` | n/a | n/a | no headless installer published |
| `required` | n/a | n/a | expected from the OS or base image |

`vendor-script` is a real weakening of the guarantee `assertPinned` exists to provide, so the
report **names every unchecksummed install** rather than blending them in. Installing them
trusts the vendor's script at fetch time. The alternative — repackaging vendor binaries
ourselves — would break the self-updaters that own those directories.

## The credential manager is asked, never assumed

`lisa-secrets-access` already treats the provider as an axis: Bitwarden, 1Password, Doppler,
Vault, AWS, or plain environment variables. A bootstrap that installed `bws` unconditionally
would contradict that — pushing every workstation onto one vendor and quietly making the
others second-class.

So the provider is a question, `none` is a first-class answer, and only the selected one is
installed. Installing all of them would leave four unused credential CLIs on the machine,
each an extra thing to keep patched for no benefit.

Headless is the primary mode, so with no TTY and no `--provider`, the answer is `none` — not
a prompt that would hang a container build forever. A misspelled provider stops the run
instead of falling back, because quietly provisioning the wrong credential manager is worse
than stopping.

## What it will not do

- **Read a repository.** That is the next step, not this one.
- **Install a credential manager you did not pick.**
- **Reinstall over a tool that is already there**, whatever installed it.
- **Install anything without `--install`.**
- **Install a tool whose vendor publishes no headless installer.** Such an entry is
  reported as manual with a pointer, because "not installed" and "cannot be installed by
  this tool" are different answers to the operator. No agent is currently in that state —
  Antigravity was listed there in error and does publish a bootstrapper.
