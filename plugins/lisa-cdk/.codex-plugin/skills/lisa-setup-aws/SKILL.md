---
name: lisa-setup-aws
description: "Provision the…"
---
Provision the dev/staging/production/shared AWS accounts this CDK project deploys into via the @codyswann/aws-soc2-setup CLI (Organizations, Control Tower, IAM Identity Center, SOC 2 controls), then wire them in end-to-end: SSO profiles, cdk bootstrap with pipeline trust, PLACEHOLDER account IDs in config/environments.ts, AWS_ACCOUNT_ID_* GitHub secrets, and the .lisa.config.json account map. Idempotent; console-only prerequisites (root MFA, Identity Center, landing zone) surface as a human checklist instead of being automated.

## Lisa Command Compatibility

- Original Claude command: `/lisa:setup:aws`
- Codex invocation: `$lisa-setup-aws` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[management-profile] [region] [dry-run]`
- Claude allowed tools: `Skill`. Codex tool access is governed by the active Codex runtime and project policy.

Use the setup-aws-accounts skill (/lisa-cdk:setup-aws-accounts on harnesses with plugin commands; $setup-aws-accounts on Codex) to assess the AWS organization, run the aws-soc2-setup foundation and account vending, write the SSO profiles, cdk-bootstrap every account with cross-account trust, and wire the resulting account IDs into config/environments.ts, GitHub secrets, and .lisa.config.json. Use the user's surrounding request as this command's arguments.
