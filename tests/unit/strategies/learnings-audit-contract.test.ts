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
 * These are agent instructions, so the assertions cover the canonical plugin
 * source and every checked-in runtime projection of the skill and command.
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

const SETUP_AUTOMATIONS_PATHS = [
  "plugins/src/base/skills/lisa-setup-automations/SKILL.md",
  "plugins/lisa/skills/lisa-setup-automations/SKILL.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(SKILL_PATHS)("gardener skill runbook (%s)", skillPath => {
  const skill = read(skillPath);

  it("declares the six run outcomes and documents the mapping from the retired three", () => {
    expect(skill).toContain("`candidates-proposed` → **`candidate-proposed`**");
    expect(skill).toContain("`blocked` → **`recovery-required`**");
    expect(skill).toContain("`approval-requested`");
    expect(skill).toContain("`policy-obsolete`");
  });

  it("only files tickets: build-ready, except eager-tier promotions held for a human", () => {
    expect(skill).toContain("build_ready: true");
    expect(skill).toContain(
      'human_gate: "a human decides whether this learning is promoted\ninto the always-loaded rules"'
    );
    expect(skill).toMatch(/status:ready/);
  });

  it("files build-ready under access-only, with a human gate only for a human-authored surface", () => {
    const emission = skill.slice(
      skill.indexOf("## Ticket emission"),
      skill.indexOf("**Per-item tickets")
    );
    expect(emission).toMatch(
      /\*\*`access-only` \(default\)\*\* — file every PROMOTE \/ DEMOTE \/ RETIRE \/\s+CONFIRM ticket \*\*build-ready\*\* \(`status:ready`\), with no `human_gate`/
    );
  });

  it("keeps everything human-gated under strict, with the declared hold reason", () => {
    expect(skill).toContain(
      'ticket passes `human_gate: "a human decides whether this knowledge is\n  promoted, demoted, or retired"`'
    );
  });

  it("inventories every knowledge surface through the proper access paths", () => {
    expect(skill).toContain("parseLearningsFile");
    expect(skill).toContain("projectLearnings");
    expect(skill).toContain("@codyswann/lisa/learnings");
    expect(skill).toContain(".claude/rules");
    expect(skill).toMatch(/wiki index|wiki\/index\.md/i);
  });

  it("gathers the five evidence axes per item", () => {
    // Recurrence is measured since last_confirmed, reusing git-history-analyzer.
    expect(skill).toContain("last_confirmed");
    expect(skill).toContain("git-history-analyzer");
  });

  it("classifies via the ladder router, advisory-only", () => {
    expect(skill).toContain("skill-evaluator");
  });

  it("emits per-item PROMOTE/DEMOTE tickets via lisa-tracker-write", () => {
    expect(skill).toContain("lisa-tracker-write");
    expect(skill).toContain("type:Task");
  });

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

  it("batches CONFIRM and provably-redundant RETIRE into one ticket per run", () => {
    expect(skill).toContain("RETIRE");
    expect(skill).toContain("confirmLearningEntry");
  });

  it("carries the delimited batch-ticket execution contract, byte-identical to canonical", () => {
    const template = extractBatchTemplate(skill);

    expect(template).toContain("confirmLearningEntry");
    // RETIRE names its shell tool and says it works over the cap
    // (CodySwannGT/lisa#4536): an over-budget ledger is exactly the state a
    // retire most often exists to repair.
    expect(template).toContain("bunx @codyswann/lisa learnings-retire");
    // RETIRE deletes go through the fingerprint-guarded CAS API, and a
    // drifted row is skipped rather than deleted (CodySwannGT/lisa#4530).
    expect(template).toContain(
      "retireLearningEntry(projectRoot, id, expectedFingerprint)"
    );
    expect(template).toMatch(
      /returns `not-found` means the entry is already gone: note it\s+in the PR and skip the row/
    );

    const canonical = extractBatchTemplate(
      read("plugins/src/base/skills/lisa-learnings-audit/SKILL.md")
    );
    expect(template).toBe(canonical);
  });

  it("makes every RETIRE row carry the full entry fingerprint, not the marker hash", () => {
    expect(skill).toContain("expectedFingerprint");
  });

  it("requires a mutation proof before retiring a rule as owned by a test", () => {
    expect(skill).toMatch(/A RETIRE owned by a test needs a mutation proof/);
  });

  it("embeds the promotion-contract AC template verbatim for EXECUTABLE-CONTROL", () => {
    expect(skill).toContain("promotion-contract");

    const canonical = extractAcTemplate(
      read("plugins/src/base/rules/reference/promotion-contract.md")
    );
    expect(skill).toContain(canonical);
  });

  it("routes upstream scope to the two Lisa lanes, marker-deduped", () => {
    expect(skill).toContain("self-hardening");
    expect(skill).toContain("CodySwannGT/lisa");
  });

  it("computes the invariant hash deterministically, never model-estimated", () => {
    // Shared executable fingerprint, truncated to 12 hex chars.
    expect(skill).toContain("lisa effectiveness fingerprint --input");
    expect(skill).toContain("12 SHA-256");
  });

  it("escalates headlessly: status:blocked + human-needed, never prompts", () => {
    expect(skill).toContain("status:blocked");
    expect(skill).toContain("human-needed");
  });

  it("documents cron registration via lisa-setup-automations", () => {
    expect(skill).toContain("lisa-setup-automations");
    expect(skill).toMatch(/lisa-auto-<project>-learnings-audit/);
  });
});

describe.each(COMMAND_PATHS)("gardener command (%s)", commandPath => {
  const command = read(commandPath);

  it("passes through to the lisa-learnings-audit skill", () => {
    expect(command).toContain("lisa-learnings-audit");
    expect(command).toContain("$ARGUMENTS");
  });

  it("carries a description and argument-hint frontmatter", () => {
    expect(command).toMatch(/^description:/m);
    expect(command).toMatch(/^argument-hint:/m);
  });
});

describe.each(SETUP_AUTOMATIONS_PATHS)(
  "setup-automations optional gardener loop (%s)",
  setupPath => {
    const setup = read(setupPath);

    it("registers learnings-audit as an optional (opt-in) automation", () => {
      expect(setup).toContain("learnings-audit");
    });
  }
);
