---
description: "Prepare this machine — or a throwaway container — to run coding agents, before any repository exists. Detects which of Lisa's supported agents are already installed, asks which credential manager the machine uses (or none), and installs only what is missing, each by its vendor's own preferred method. Idempotent and headless; --print-dockerfile emits a spin-up/spin-down environment. Nothing is installed without --install."
allowed-tools: ["Skill"]
argument-hint: "[--install] [--agents=claude,codex] [--provider=bitwarden] [--json] [--print-dockerfile]"
---

Use the /lisa-setup-workstation skill to report and optionally install the coding agents, credential manager, and base tools this machine needs. $ARGUMENTS
