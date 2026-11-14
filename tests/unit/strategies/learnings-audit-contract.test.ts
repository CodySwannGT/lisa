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

  // #4764: a PROMOTE ticket once named sections and a file that did not
  // exist, an 18-line-stale pointer, and a count contradicting its evidence.
  // Structural check only: the delimited block exists, sits inside Ticket
  // emission before the per-item filing it gates, is referenced from the
  // audit cycle, and carries the machine tokens Proof records per ticket.
  it("validates destinations and counts before filing PROMOTE/DEMOTE (#4764)", () => {
    const start = skill.indexOf("<!-- destination-validation:start -->");
    const end = skill.indexOf("<!-- destination-validation:end -->");
    const emission = skill.indexOf("## Ticket emission");
    const perItem = skill.indexOf("**Per-item tickets — PROMOTE / DEMOTE**");
    const nextSection = skill.indexOf("\n## ", emission + 1);

    expect(start).toBeGreaterThan(emission);
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(perItem);
    expect(perItem).toBeLessThan(nextSection);

    const block = skill.slice(start, end);
    for (const token of [
      "destinations_checked",
      "destinations_missing",
      "destinations_new",
      "pointer_sha",
      "counts_reconciled",
      "refused",
    ]) {
      expect(block).toContain(token);
    }

    // The audit cycle, Proof, and the drafted_artifact bullet (embedded only
    // after validation edits it) all point at the check.
    for (const [from, to] of [
      ["3. **Classify**", "4. **Emit**"],
      ["## Proof", "## The audit cycle"],
      ["**`drafted_artifact`** verbatim", "For **EXECUTABLE-CONTROL**"],
    ] as const) {
      const fromAt = skill.indexOf(from);
      const toAt = skill.indexOf(to);
      // A renamed anchor must fail, not slice an empty or wrong range.
      expect(fromAt).toBeGreaterThanOrEqual(0);
      expect(toAt).toBeGreaterThan(fromAt);
      expect(skill.slice(fromAt, toAt)).toContain("destination-validation");
    }
  });

  // #4885: an assumed upstream branch name makes every upstream destination
  // look missing, and a mixed run's refusals were reachable only from the
  // run report. Machine tokens only: the upstream lookup resolves
  // `.default_branch` before its commits call, and Run outcomes routes
  // refusals of a `candidate-proposed` run into `--summary`.
  it("resolves the upstream default branch and summarises every refusal (#4885)", () => {
    const start = skill.indexOf("<!-- destination-validation:start -->");
    const end = skill.indexOf("<!-- destination-validation:end -->");
    const block = skill.slice(start, end);
    const resolve = block.indexOf("--jq .default_branch");
    const commits = block.indexOf("/commits/<upstreamDefault>");

    expect(resolve).toBeGreaterThan(0);
    expect(commits).toBeGreaterThan(resolve);
    expect(block).not.toContain("/commits/<default>");

    const outcomesAt = skill.indexOf("## Run outcomes");
    expect(outcomesAt).toBeGreaterThan(0);
    const outcomesEnd = skill.indexOf("\n## ", outcomesAt + 1);
    const outcomes = skill.slice(outcomesAt, outcomesEnd);
    const mixed = outcomes
      .split("\n- ")
      .find(
        chunk =>
          chunk.includes("`candidate-proposed`") &&
          chunk.includes("refused") &&
          chunk.includes("`--summary`")
      );
    expect(mixed).toBeDefined();
  });

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
