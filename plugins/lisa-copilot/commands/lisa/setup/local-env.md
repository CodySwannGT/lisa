---
description: "Bring this machine in line with the toolchain the project declares. Reports every tool in remoteEnv.tools that is missing, outdated, or unpinned for this platform, and installs the missing ones into ~/.local/bin from the same pinned, checksummed entries the remote surfaces use — but only when asked with --install-tools. A newer tool already on PATH is left alone."
allowed-tools: ["Skill"]
argument-hint: "[--install-tools] [--json]"
---

Use the /lisa-setup-local-env skill to report and optionally install the project's declared toolchain on this machine. $ARGUMENTS
