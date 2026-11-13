---
description: "Provision the AWS accounts this CDK project deploys into and wire them in: SSO profiles, CDK bootstrap, account IDs, GitHub secrets, and the account map. Idempotent; console-only steps are listed for a human."
allowed-tools: ["Skill"]
argument-hint: "[management-profile] [region] [dry-run]"
---

Use the setup-aws-accounts skill (/lisa-cdk:setup-aws-accounts on harnesses with plugin commands; $setup-aws-accounts on Codex) to assess the AWS organization, run the aws-soc2-setup foundation and account vending, write the SSO profiles, cdk-bootstrap every account with cross-account trust, and wire the resulting account IDs into config/environments.ts, GitHub secrets, and .lisa.config.json. $ARGUMENTS
