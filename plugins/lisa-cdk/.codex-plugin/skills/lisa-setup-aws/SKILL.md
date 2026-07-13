---
name: lisa-setup-aws
description: "Provision the dev/staging/produc…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:setup:aws`
- Codex invocation: `$lisa-setup-aws` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[management-profile] [region] [dry-run]`
- Claude allowed tools: `Skill`. Codex tool access is governed by the active Codex runtime and project policy.

Use the /lisa-cdk:setup-aws-accounts skill to assess the AWS organization, run the aws-soc2-setup foundation and account vending, write the SSO profiles, cdk-bootstrap every account with cross-account trust, and wire the resulting account IDs into config/environments.ts, GitHub secrets, and .lisa.config.json. Use the user's surrounding request as this command's arguments.
