---
name: lisa-detect-tooling
description: "Find the command-line tools a project needs but never declares, and propose pinned manifest entries for them. Reads git hooks and npm scripts for what the project actually RUNS — discovering tools no list mentions — plus MCP servers, credential usage notes and quality configuration. Subtracts whatever remoteEnv.tools, node_modules and the workstation layer already cover, and prints proposals with evidence. Writes nothing and installs nothing — a tool reaches a machine only when a human has reviewed a pinned, checksummed entry. Invoked by lisa-setup-remote-env before provisioning, and runnable on its own."
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Detect Tooling

Lisa provisions tooling through four unrelated mechanisms, and only one of them puts a binary on `PATH`:

| tool | how it arrives | what puts it on PATH |
| --- | --- | --- |
| playwright, stryker | npm devDependency from a stack template | nothing — a local `node_modules` binary |
| maestro | npm **scripts** in the Expo template | **nothing** |
| sonar | `src/sonar/sonar-installer.ts` | nothing |
| linear | MCP server or `LINEAR_API_KEY` | `lisa-linear-access`, not a CLI |
| bws, gh | `remoteEnv.tools` — pinned and checksummed | this, and only this |

Nothing populates that last row. So a project can ship scripts that invoke `maestro`, wire an MCP server whose CLI it also shells out to, and configure Playwright thresholds, while the manifest that actually provisions binaries stays empty — and every one of those fails at the moment of use rather than at setup.

That is the same failure this repository has now paid for twice: `gh` was declared nowhere and a cloud session could not commit; `tar` was needed by an install method and asserted by nothing.

## Discovery, not recognition

The first version of this could only find tools it had been told about: it matched script bodies against a fixed `KNOWN_TOOLS` list. That makes the detector useful for exactly the set that needs it least — the tools someone already thought of.

An Expo project invoking `eas` from **eight** npm scripts and six CI steps produced no proposal, because `eas` was not on the list. `gitleaks`, which runs on every commit in every one of these repositories, produced no proposal either.

So the question asked of executable sources is now the open one — *what does this project actually run* — and everything already provided is subtracted afterwards:

- what `remoteEnv.tools` declares
- what `node_modules/.bin` provides (a dependency's binary never needs to be on PATH)
- what `lisa-setup-workstation` owns (coding agents belong to the machine, not the checkout)

The curated list stays, because a vetted `why` is worth more than an observed one — proposals say which they are, `[curated]` or `[discovered]`.

## What it does

Reads six signals, subtracts what is already covered, and prints what is left with the evidence for each:

- **git hooks** (`.husky/*`, `.git/hooks/*`) that invoke a binary. The **strongest** signal available, stronger than an npm script: a hook runs on every commit and push whether anyone asked or not, so a machine without the tool cannot commit at all.

  A `command -v` guard counts as evidence rather than as "optional", because the guarded shape is the worse one. Lisa's pre-commit hook wraps its secret scan in `command -v gitleaks`, so on a machine without gitleaks the scan is **skipped silently** — the hook passes, the commit succeeds, and nothing was scanned. A guard makes the absence invisible precisely where it matters.

- **npm scripts** that invoke a binary — a script running `maestro test` is the project stating a dependency in executable form. Read from the script *body*, not its name, because the name is a label.
- **MCP servers with a CLI equivalent.** An MCP server is not a substitute for the binary: several authenticate by browser OAuth, which a container cannot do, so a project relying on one remotely has *no* integration rather than a degraded one. Do not infer a CLI for access layers that already define their own headless substrate; Linear is handled by `lisa-linear-access` through `LINEAR_API_KEY` + GraphQL when MCP OAuth is unavailable.
- **Credential usage notes.** A note explaining what a token is for usually names the program that consumes it. `lisa-secrets-access` already exposes these without touching a value, which makes them a first-class input rather than a trick.
- **Quality configuration**, where a threshold implies the tool that produces it.

## Reading shell is the hard part

Discovery only works if "what does this run" can be answered from shell text without inventing commands. Three things had to be right, each found by running it against real repositories:

**Only the first word of a command position counts.** Word-scanning this repo's own hooks proposed `ltrimstr`, `map` and `select` (jq filter internals), `console.log` and `process.exit` (embedded JavaScript), and `load_audit_cves` (a function the hook defines three lines up). Reading only where a command can actually start removes all of them without a denylist entry for any.

**Quoting and commenting nest, so neither can be stripped independently.** The comment on line 9 of `pre-push.local` ends `...the script's exit code)`. That lone apostrophe pairs with the next real quote 28 lines later, blanks everything between, and leaks a `node -e` payload's JavaScript into the results. Stripping comments first does not fix it, because a `#` inside a quoted string is not a comment. One character scanner tracking both is the only correct shape.

**`$( )` restarts the quoting context.** In `"$(printf '%s' "$JSON" | node -e '…')"`, quotes inside the substitution pair among themselves. A flat scanner falls out of phase on the first one and starts reporting the payload's own string literals.

Against Lisa and the three TunnlAI repositories, what survives is `gitleaks`, `jq`, `gtimeout` and `eas` — every one a real, undeclared invocation, with no false positives.

## What it will not do

**It writes nothing and installs nothing.** Output is a proposal with `<pin>`, `<release url>` and `<sha256>` left for a human.

That boundary is the whole design. A tool should reach a machine because someone reviewed a pinned entry with a checksum, never because a detector was confident. Detection is evidence; the manifest is the decision. An auto-writing detector would quietly become a second, unreviewed install path — exactly what `assertPinned` exists to prevent.

## Surfaces

One declaration per tool, with an optional `surfaces` list, rather than separate blocks per surface. Most tools are needed *everywhere* — a Maestro or Sonar CLI is as required on a laptop as in a container — and duplicated blocks drift.

What genuinely differs is **consent**, not the list:

- A remote container is disposable and nobody is watching, so it provisions silently.
- A developer machine belongs to a person, so `--phase=toolchain` reports what is missing and installs nothing unless `--install-tools` is passed.

Omitting `surfaces` means every surface, because that is true of most tools and the cost of forgetting should be a redundant check rather than a silent absence.

Platform differences are **not** expressed with `surfaces`. A downloaded tool declares a
`platforms` map keyed `<platform>-<arch>`, each block carrying its own `install` method, `url`,
and `sha256`:

```json
"platforms": {
  "linux-x64":    { "install": "release-tar", "url": "...", "sha256": "..." },
  "darwin-arm64": { "install": "release-zip", "url": "...", "sha256": "..." }
}
```

The method lives inside the block because it varies — gh ships a `.tar.gz` for Linux and a
`.zip` for macOS. A flat entry means one artifact serves everything, which is true of
`npm-global` and nothing else.

This replaces an earlier convention worth naming, because its residue may still be in a
manifest you read: a Linux archive used to be marked `surfaces: ["remote"]` with a bare
`require` entry for `local`, so a laptop asserted the tool without being offered a binary it
could not run. That kept the wrong binary off the laptop by making the tool uninstallable
there — which is how `bws` and `gh`, the two CLIs Lisa's own guardrails shell out to, came to
be required on developer machines and provisionable only in containers.

## Usage

```sh
node scripts/detect-tooling.mjs          # human-readable proposals
node scripts/detect-tooling.mjs --json   # machine-readable
```

Confirm each proposal with the operator, then hand it to them to apply. **This skill does not hold `Edit`**, deliberately: a skill that both decides a tool is needed and writes the entry that installs it is the second unreviewed install path this design exists to avoid. Granting `Edit` while documenting "writes nothing" would have made the prose the only thing stopping it.

When a proposal is wrong — the tool is genuinely unused, or arrives another way — say so and move on. A rejected proposal is a normal outcome, not a failure.
