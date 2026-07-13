---
description: "Provision the dev/staging/production/shared AWS accounts this CDK project deploys into via the @codyswann/aws-soc2-setup CLI (Organizations, Control Tower, IAM Identity Center, SOC 2 controls), then wire them in end-to-end: SSO profiles, cdk bootstrap with pipeline trust, PLACEHOLDER account IDs in config/environments.ts, AWS_ACCOUNT_ID_* GitHub secrets, and the .lisa.config.json account map. Idempotent; console-only prerequisites (root MFA, Identity Center, landing zone) surface as a human checklist instead of being automated."
allowed-tools: ["Skill"]
argument-hint: "[management-profile] [region] [dry-run]"
---

Use the /lisa-cdk:setup-aws-accounts skill to assess the AWS organization, run the aws-soc2-setup foundation and account vending, write the SSO profiles, cdk-bootstrap every account with cross-account trust, and wire the resulting account IDs into config/environments.ts, GitHub secrets, and .lisa.config.json. $ARGUMENTS
