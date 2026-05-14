# Template Governance

Lisa distributes standards to downstream projects through template families and explicit installation strategies.

## Strategy Vocabulary

- `copy-overwrite`: enforced files that Lisa may replace on update.
- `create-only`: project-owned files that Lisa creates once and should not overwrite later.
- `merge`: shared defaults that must preserve local additions where possible.
- `copy-contents`: directory content copying for template payloads.
- `package-lisa`: package metadata and dependency management strategy.
- `tagged-merge`: marker-aware merging for files with Lisa-managed sections.

## Template Families

Template families observed in the monorepo include all, TypeScript, Expo, NestJS, CDK, Rails, tsconfig, oxlint, and plugin-related assets.

## Practical Rule

When updating Lisa templates, preserve the strategy contract. A downstream project may rely on Lisa overwriting one file while preserving another.
