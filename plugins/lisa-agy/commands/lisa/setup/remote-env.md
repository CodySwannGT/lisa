---
description: "Provision and verify a remote execution environment for this project — Codex Cloud today. Generates the repository-owned setup script that installs the declared toolchain, materializes secrets through lisa-secrets-access, and runs the project's own hook. Provisions by API where one exists, by driving the vendor console where one does not, and by emitting exact config otherwise, then proves the result with the same read-back regardless of tier. Run this before dispatching work with executionEnv."
allowed-tools: ["Skill"]
argument-hint: "[codex-cloud] [--verify]"
---

Use the /lisa-setup-remote-env skill to provision and verify a remote execution environment. $ARGUMENTS
