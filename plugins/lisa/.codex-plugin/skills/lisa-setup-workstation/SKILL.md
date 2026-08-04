---
name: lisa-setup-workstation
description: "Bootstrap a machine before any…"
allowed-tools: ["Bash", "Read"]
---

# Setup Workstation: $ARGUMENTS

Prepare a developer workstation or ephemeral home directory before cloning a project.

This is lower than `/lisa:setup:local-env`: local-env reads a project's
`remoteEnv.tools` manifest from `.lisa.config.json`; workstation setup has no
repository yet, so it uses Lisa's built-in bootstrap fleet.

## Usage

```sh
node scripts/workstation-bootstrap.mjs
node scripts/workstation-bootstrap.mjs --yes
node scripts/workstation-bootstrap.mjs --agents=claude,codex --yes
node scripts/workstation-bootstrap.mjs --json
```

The default run only reports. `--yes` permits installs. Existing tools are left
alone regardless of how they were installed.

## Contract

- Agent CLIs use their vendor installer surface. These entries are not pinned or
  checksummed, and the report calls that out instead of mixing them with
  `remoteEnv.tools` archive pins.
- `gh` and `bws` use Lisa's pinned archive installer with checksum verification.
- `aws` and `sonar` use vendor installers because their official setup flows are
  installer-managed rather than Lisa-owned release archives.
- `--agents=a,b` narrows only the agent CLIs. Universal tools are still checked
  because every factory needs them.
- `--json` is machine-readable and performs no installs.

