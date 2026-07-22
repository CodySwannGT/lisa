/**
 * Prose contract for the gardener — lisa-learnings-audit (LLG-6, #1735).
 *
 * The gardener is the maintenance loop of the learnings ladder (PRD #1729):
 * it inventories every knowledge surface, gathers evidence per item,
 * classifies via the ladder router (skill-evaluator, advisory), and
 * communicates exclusively through the tracker — per-item tickets for
 * PROMOTE/DEMOTE, one batch ticket per run for CONFIRM/RETIRE, upstream
 * issues for upstream-scoped recommendations. Everything is human-gated at
 * v1; the skill only files tickets. Recommendations are fingerprint-marked
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

  it("carries every runbook contract section", () => {
    expect(skill).toMatch(/## Intent/);
    expect(skill).toMatch(/## Sources of truth/);
    expect(skill).toMatch(/## Candidate-selection rules/);
    expect(skill).toMatch(/## Scope/);
    expect(skill).toMatch(/## Proof/);
    expect(skill).toMatch(/## Autonomous-vs-approval boundary/);
    expect(skill).toMatch(/## Escalation/);
    expect(skill).toMatch(/## Recovery/);
    expect(skill).toMatch(/## Run outcomes/);
    expect(skill).toMatch(/## Retirement condition/);
  });

  it("declares the six run outcomes and documents the mapping from the retired three", () => {
    expect(skill).toContain(
      "nothing-needed | candidate-proposed | change-proved | approval-requested | recovery-required | policy-obsolete"
    );
    // The retired three-value vocabulary is documented as the prior state it maps from.
    expect(skill).toContain("nothing-needed | candidates-proposed | blocked");
    expect(skill).toContain("`candidates-proposed` → **`candidate-proposed`**");
    expect(skill).toContain("`blocked` → **`recovery-required`**");
    expect(skill).toContain("`approval-requested`");
    expect(skill).toContain("`policy-obsolete`");
  });

  it("is human-gated everything at v1 — the skill only files tickets", () => {
    expect(skill).toMatch(/only files tickets/i);
    expect(skill).toMatch(/human-gated/i);
    expect(skill).toMatch(/status:ready/);
    // It never edits knowledge surfaces itself.
    expect(skill).toMatch(/never (edits?|writes?|deletes?|modif)/i);
  });

  it("inventories every knowledge surface through the proper access paths", () => {
    expect(skill).toContain("parseLearningsFile");
    expect(skill).toContain("projectLearnings");
    expect(skill).toContain("@codyswann/lisa/learnings");
    expect(skill).toContain(".claude/rules");
    expect(skill).toMatch(/wiki index|wiki\/index\.md/i);
    expect(skill).toMatch(/lint|hook|force/i);
  });

  it("gathers the five evidence axes per item", () => {
    expect(skill).toMatch(/recurrence/i);
    expect(skill).toMatch(/staleness/i);
    expect(skill).toMatch(/redundancy/i);
    expect(skill).toMatch(/contradiction/i);
    expect(skill).toMatch(/budget pressure/i);
    // Recurrence is measured since last_confirmed, reusing git-history-analyzer.
    expect(skill).toContain("last_confirmed");
    expect(skill).toContain("git-history-analyzer");
  });

  it("classifies via the ladder router, advisory-only", () => {
    expect(skill).toContain("skill-evaluator");
    expect(skill).toMatch(/advisory/i);
    expect(skill).toContain("drafted_artifact");
  });

  it("emits per-item PROMOTE/DEMOTE tickets via lisa-tracker-write", () => {
    expect(skill).toContain("PROMOTE");
    expect(skill).toContain("DEMOTE");
    expect(skill).toContain("lisa-tracker-write");
    expect(skill).toContain("type:Task");
    expect(skill).toMatch(/three-audience/);
    expect(skill).toMatch(/evidence links/i);
  });

  it("batches CONFIRM and provably-redundant RETIRE into one ticket per run", () => {
    expect(skill).toMatch(/one batch ticket per run/i);
    expect(skill).toContain("CONFIRM");
    expect(skill).toContain("RETIRE");
    expect(skill).toContain("confirmLearningEntry");
    // The gardener never bumps last_confirmed itself; the implementing
    // factory run applies the bumps after the human flips the batch ready.
    expect(skill).toMatch(/implementing factory run|factory.*applies/i);
  });

  it("carries the delimited batch-ticket execution contract, byte-identical to canonical", () => {
    const template = extractBatchTemplate(skill);

    expect(template).toContain("confirmLearningEntry");
    expect(template).toMatch(/proof-citing deletion PR/i);
    expect(template).toMatch(/reverse-atomicity/i);
    expect(template).toMatch(/never hand-edit the ledger/i);

    const canonical = extractBatchTemplate(
      read("plugins/src/base/skills/lisa-learnings-audit/SKILL.md")
    );
    expect(template).toBe(canonical);
  });

  it("embeds the promotion-contract AC template verbatim for EXECUTABLE-CONTROL", () => {
    expect(skill).toContain("EXECUTABLE-CONTROL");
    expect(skill).toContain("promotion-contract");

    const canonical = extractAcTemplate(
      read("plugins/src/base/rules/reference/promotion-contract.md")
    );
    expect(skill).toContain(canonical);
  });

  it("routes upstream scope to the two Lisa lanes, marker-deduped", () => {
    expect(skill).toContain("self-hardening");
    expect(skill).toContain("template-candidate");
    expect(skill).toContain("CodySwannGT/lisa");
  });

  it("uses the stable gardener fingerprint marker grammar", () => {
    expect(skill).toContain("<!-- [lisa-gardener] key=");
    expect(skill).toMatch(/invariant/i);
  });

  it("computes the invariant hash deterministically, never model-estimated", () => {
    // Normalization: trim + collapse internal whitespace + lowercase.
    expect(skill).toMatch(/trim/i);
    expect(skill).toMatch(/collapse/i);
    expect(skill).toMatch(/lowercase/i);
    // Deterministic Bash hash, truncated to 12 hex chars.
    expect(skill).toContain("shasum -a 256");
    expect(skill).toContain("cut -c1-12");
    expect(skill).toMatch(/never estimated by the model/i);
  });

  it("dedupes on the surface prefix first, hash as disambiguation only", () => {
    expect(skill).toContain("searches open AND closed by default");
    expect(skill).toMatch(/prefix.*first|first.*prefix/i);
    expect(skill).toMatch(/disambiguation only/i);
    // Body-enumeration fallback covers search-index lag.
    expect(skill).toMatch(/body-enum/i);
  });

  it("dedupes against open AND closed issues, remembering rejections", () => {
    expect(skill).toMatch(/open AND closed/i);
    expect(skill).toMatch(/closed.*(unmerged|rejected)|rejected/i);
    expect(skill).toMatch(/new evidence.*postdates|postdating/i);
  });

  it("excludes the learning machinery from its own candidate scan", () => {
    expect(skill).toMatch(/no learning loops about learning/i);
    expect(skill).toContain("[lisa-learning-");
    expect(skill).toContain("[lisa-rejection-candidate]");
    expect(skill).toContain("[lisa-archaeology-candidate]");
    expect(skill).toMatch(/its own tickets|the gardener'?s own/i);
  });

  it("audits the eager tier every run, including Lisa's own shipped eager rules", () => {
    expect(skill).toMatch(/eager tier/i);
    expect(skill).toMatch(/every run/i);
    expect(skill).toMatch(/Lisa'?s own shipped eager rules/i);
    expect(skill).toMatch(/demotion-biased/i);
  });

  it("escalates headlessly: status:blocked + human-needed, never prompts", () => {
    expect(skill).toContain("status:blocked");
    expect(skill).toContain("human-needed");
    expect(skill).toMatch(/operator-readable/i);
    expect(skill).toMatch(/never prompts?/i);
  });

  it("documents cron registration via lisa-setup-automations", () => {
    expect(skill).toContain("lisa-setup-automations");
    expect(skill).toMatch(/lisa-auto-<project>-learnings-audit/);
  });

  it("bounds each run with a max_candidates cap", () => {
    expect(skill).toContain("max_candidates");
  });

  it("states a stateless, tracker-derived retirement condition for the loop itself", () => {
    // No durable counter: the condition is derived from the tracker.
    expect(skill).toMatch(/stateless/i);
    expect(skill).toMatch(/never from a\s+counter or state file/i);
    // (a) date-filtered search over the trailing window …
    expect(skill).toMatch(/trailing six-week window/i);
    expect(skill).toContain("--created");
    // … AND (b) the current run itself proposes nothing.
    expect(skill).toMatch(/current run'?s inventory yields zero/i);
    // The old in-memory consecutive-run counter is gone.
    expect(skill).not.toMatch(/six consecutive/i);
  });

  it("is honest about concurrency: convergence, not mutual exclusion", () => {
    expect(skill).toMatch(/convergence, not mutual exclusion/i);
    expect(skill).toMatch(/transient duplicate/i);
    // Single-scheduled-runner assumption + manual runs check the cron first.
    expect(skill).toMatch(/at most ONE\s+learnings-audit automation/i);
    expect(skill).toMatch(/not due\s+or currently running/i);
    // No overstated overlap-safety claim survives.
    expect(skill).not.toMatch(/safely\s+concurrent-adjacent/i);
  });

  it("files per-item tickets first and the batch ticket last for recoverability", () => {
    expect(skill).toMatch(/batch ticket last/i);
    expect(skill).toMatch(/completion signal/i);
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
      expect(setup).toMatch(/opt-in|optional/i);
    });

    it("documents the single-runner assumption instead of overlap safety", () => {
      expect(setup).toMatch(/at most ONE learnings-audit automation/i);
      expect(setup).toMatch(/convergence/i);
      expect(setup).not.toMatch(/overlapping\s+manual runs are safe/i);
    });
  }
);
