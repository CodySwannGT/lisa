/**
 * Prose contract for the gardener — lisa-learnings-audit (LLG-6, #1735).
 *
 * The gardener is the maintenance loop of the learnings ladder (PRD #1729):
 * it inventories every knowledge surface, gathers evidence per item,
 * classifies via the ladder router (skill-evaluator, advisory), and
 * communicates exclusively through the tracker — per-item tickets for
 * PROMOTE/DEMOTE, one batch ticket per run for CONFIRM/RETIRE, upstream
 * issues for upstream-scoped recommendations. The skill only files tickets:
 * build-ready under the default `humanGate.mode: "access-only"` (except an
 * eager-tier promotion or a change to a human-authored surface), human-gated
 * under `"strict"` (#4687). Recommendations are fingerprint-marked
 * and deduped against open AND closed issues, and the gardener's own output
 * is never a candidate (no learning loops about learning).
 *
 * The assertions here are structural: every runtime projection carries the
 * batch-ticket execution template byte-identical to the canonical source, the
 * skill embeds the promotion-contract AC template verbatim, and the command
 * keeps its frontmatter and forwards `$ARGUMENTS`. The runbook prose is
 * guidance and is reviewed, not pinned (#4867).
 * @module tests/unit/strategies/learnings-audit-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractAcTemplate,
  extractBatchTemplate,
} from "./promotion-contract-helpers.js";

const SKILL_PATHS = [
  "plugins/src/base/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-agy/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-devin/skills/lisa-learnings-audit/SKILL.md",
] as const;

const COMMAND_PATHS = [
  "plugins/src/base/commands/learnings/audit.md",
  "plugins/lisa/commands/learnings/audit.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(SKILL_PATHS)("gardener skill runbook (%s)", skillPath => {
  const skill = read(skillPath);

  it("carries the delimited batch-ticket execution contract, byte-identical to canonical", () => {
    const template = extractBatchTemplate(skill);
    const canonical = extractBatchTemplate(
      read("plugins/src/base/skills/lisa-learnings-audit/SKILL.md")
    );
    expect(template).toBe(canonical);
  });

  it("embeds the promotion-contract AC template verbatim for EXECUTABLE-CONTROL", () => {
    const canonical = extractAcTemplate(
      read("plugins/src/base/rules/reference/promotion-contract.md")
    );
    expect(skill).toContain(canonical);
  });
});

describe.each(COMMAND_PATHS)("gardener command (%s)", commandPath => {
  const command = read(commandPath);

  it("passes its arguments through to the skill", () => {
    expect(command).toContain("$ARGUMENTS");
  });

  it("carries a description and argument-hint frontmatter", () => {
    expect(command).toMatch(/^description:/m);
    expect(command).toMatch(/^argument-hint:/m);
  });
});
