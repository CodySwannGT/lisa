---
description: "Detect whether any Lisa-native reimplementation of a curated third-party Claude plugin has drifted behind its upstream version (report-only, CI-gateable exit code)"
allowed-tools: ["Skill"]
argument-hint: "(blank for default roots) | --skills-root <dir> --cache-root <dir> --json"
---

Use the /plugin-parity-drift skill to scan `synced-from`-stamped skills, resolve each curated plugin's current upstream version from the installed plugin cache, and report any drift via the script's exit code. $ARGUMENTS
