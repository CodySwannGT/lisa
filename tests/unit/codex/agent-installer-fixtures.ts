/**
 * Agent ids, file names, plugin names and agent sources shared by the Codex agent installer suites.
 * @module tests/unit/codex/agent-installer-fixtures
 */

/** Common agent id reused across multiple test cases */
export const BUG_FIXER = "bug-fixer";
/** Common second agent id reused across multiple test cases */
export const OPS_SPECIALIST = "ops-specialist";
/** Filename for the bug-fixer agent's .md source */
export const BUG_FIXER_MD = `${BUG_FIXER}.md`;
/** Filename for the bug-fixer agent's emitted .toml */
export const BUG_FIXER_TOML = `${BUG_FIXER}.toml`;
/** Filename for the ops-specialist agent's .md source */
export const OPS_SPECIALIST_MD = `${OPS_SPECIALIST}.md`;
/** Filename for a stale agent file used in deletion tests */
export const OLD_AGENT_TOML = "old-agent.toml";
/** Filename for a host-authored agent file used in safety tests */
export const HOST_AGENT_TOML = "host-agent.toml";
/** Base Lisa plugin name */
export const PLUGIN_LISA = "lisa";
/** Stack-specific Rails plugin name (sorts after base alphabetically) */
export const PLUGIN_LISA_RAILS = "lisa-rails";
/** Hypothetical plugin that sorts before 'lisa' alphabetically */
export const PLUGIN_AA = "aa-plugin";

export const SAMPLE_AGENT = `---
name: bug-fixer
description: Bug fix agent
---

Body content.
`;

export const SAMPLE_AGENT_2 = `---
name: builder
description: Builder agent
---

Builder body.
`;
