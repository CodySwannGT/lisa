---
disable-model-invocation: true
description: "Prepare this machine or a container to run coding agents before any repo exists, installing only what's missing. Idempotent; nothing is installed without --install."
allowed-tools: ["Skill"]
argument-hint: "[--install] [--agents=claude,codex] [--provider=bitwarden] [--json] [--print-dockerfile]"
---

Use the /lisa-setup-workstation skill to report and optionally install the coding agents, credential manager, and base tools this machine needs. $ARGUMENTS

Note: on a machine with no agent and no checkout — which is what this prepares — reach the same bootstrap without Lisa installed at all: `npx -y @codyswann/lisa@latest workstation --install`.
