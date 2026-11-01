/**
 * Prose contract for the planning-miss learning loop (CodySwannGT/lisa#4569).
 *
 * A dispatched worker that stops because something was missing, unclear,
 * contradictory or undecided, or that has to file a new ticket mid-build
 * because the item was mis-scoped, is a planning-phase failure. These
 * assertions pin the loop end to end, in the source and in every generated
 * copy a runtime reads:
 *
 * 1. `learning-judge` classifies it `planning-miss` and persists it (a first
 *    occurrence at `low` confidence, so a human merges it), while a spec gap
 *    caught before dispatch stays a drop.
 * 2. `lisa-persist-learning` routes the new classification to its PR path and
 *    leaves a countable `[lisa-planning-miss]` note on the item.
 * 3. The session manager routes the candidate after marking an item, in the
 *    background, so it never blocks dispatch; `lisa-implement` routes the
 *    mid-build ticket case.
 * 4. Planning-stage skills consume the learned checks through the bounded
 *    projection.
 * 5. Delivery effectiveness reports the planning-miss rate.
 * @module tests/unit/strategies/planning-miss-learning-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Read a repo-relative file.
 * @param relativePath - Path from the repository root
 * @returns File contents
 */
const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/** Every skill root a runtime reads: the source plus each projection. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

/** Every checked-in copy of the judge. Codex installs from plugins/lisa. */
const JUDGES = [
  "plugins/src/base/agents/learning-judge.md",
  "plugins/lisa/agents/learning-judge.md",
  "plugins/lisa-cursor/agents/learning-judge.md",
  "plugins/lisa-agy/agents/learning-judge.md",
  "plugins/lisa-copilot/agents/learning-judge.agent.md",
  "plugins/lisa-devin/agents/learning-judge.md",
] as const;

/** Rule copies (agy has no rules tree; lisa-implement carries it there). */
const FILING_RULES = [
  "plugins/src/base/rules/reference/ready-role-filing.md",
  "plugins/lisa/rules/reference/ready-role-filing.md",
  "plugins/lisa-copilot/rules/reference/ready-role-filing.md",
  "plugins/lisa-devin/rules/reference/ready-role-filing.md",
  "plugins/lisa-cursor/rules/ready-role-filing-reference.mdc",
] as const;

const VALIDATORS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

const TO_TRACKERS = [
  "lisa-notion-to-tracker",
  "lisa-confluence-to-tracker",
  "lisa-linear-to-tracker",
  "lisa-github-to-tracker",
] as const;

const PLANNING_MISS = "`planning-miss`";
const PERSIST = "lisa-persist-learning";
const STEP_ZERO = "`lisa-task-decomposition` step 0";

describe.each(JUDGES)("learning-judge (%s)", judgePath => {
  const judge = read(judgePath);

  it("adds planning-miss to the taxonomy and lets it persist", () => {
    expect(judge).toContain("- **`planning-miss`** —");
    expect(judge).toMatch(
      /`classification` \| `durable-learning` \\\| `planning-miss` \\\|/
    );
    expect(judge).toContain("`persist` iff durable-learning or planning-miss");
    expect(judge).not.toContain("only durable-learning ever persists");
  });

  it("persists a first occurrence at low confidence, for a human to merge", () => {
    expect(judge).toContain(
      "A first-occurrence planning miss persists at `low` confidence"
    );
    expect(judge).toContain("never blocks a first occurrence");
  });

  it("phrases the rule as the planning check, naming the stage", () => {
    expect(judge).toContain("`Planning (<stage>): <check>`");
    for (const stage of ["`prd`", "`decomposition`", "`ready-gate`"]) {
      expect(judge).toContain(stage);
    }
    expect(judge).toContain("`planning_stage`");
    expect(judge).toContain("quotes what the worker could not find");
  });

  it("keeps a spec gap caught before dispatch as a drop", () => {
    expect(judge).toMatch(
      /- \*\*`misunderstanding\/spec-gap`\*\* — [^\n]*\*\*before\*\* the item was dispatched[^\n]*Disposition `drop`/
    );
  });

  it("excludes environmental stops and flagged human gates", () => {
    const miss = judge.slice(judge.indexOf("- **`planning-miss`** —"));
    expect(miss).toMatch(/outage/);
    expect(miss).toMatch(/expired credential/);
    expect(miss).toMatch(/flagged as a human gate/);
  });
});

describe.each(SKILL_ROOTS)("planning-miss loop (%s)", root => {
  const skill = (name: string): string => read(`${root}/${name}/SKILL.md`);

  it("persist-learning routes planning-miss to the PR path with a countable note", () => {
    const persist = skill(PERSIST);
    expect(persist).toContain(
      "### `persist` (classification `durable-learning` or `planning-miss`)"
    );
    expect(persist).toContain("[lisa-planning-miss] key=<fingerprint>");
    expect(persist).toContain("isolated worktree");
  });

  it("the session manager routes the candidate without blocking dispatch", () => {
    const manager = skill("lisa-session-manager");
    expect(manager).toContain("6. **Planning-miss signal.**");
    expect(manager).toContain("7. **Continue the cycle.**");
    expect(manager).toContain("`planningMiss.counts`");
    expect(manager).toContain("`run_in_background: true`");
    expect(manager).toContain("never waits for it");
    expect(manager).toContain("`--cause environment`");
    expect(manager).toContain("`--cause human-gate`");
  });

  it("lisa-implement routes a mid-build ticket and an unmanaged human-needed stop", () => {
    const implement = skill("lisa-implement");
    expect(implement).toContain("**Planning-miss signal.**");
    expect(implement).toContain("mid-build");
    expect(implement).toContain(PERSIST);
    expect(implement).toContain(
      "Under `managedBy=`, the manager routes a human-needed stop"
    );
  });

  it("decomposition loads the learned planning checks through the bounded projection", () => {
    const decomposition = skill("lisa-task-decomposition");
    expect(decomposition).toContain("### 0. Load the learned planning checks");
    expect(decomposition).toContain("projectLearnings");
    expect(decomposition).toContain("resolveProjectLearningsFile");
    expect(decomposition).toContain(
      "Planning \\((prd|decomposition|ready-gate)\\):"
    );
    expect(decomposition).not.toMatch(/cat [^\n]*PROJECT_LEARNINGS/);
  });

  it("lisa-plan, the validators and the PRD intake paths consume them", () => {
    expect(skill("lisa-plan")).toContain(STEP_ZERO);
    for (const validator of VALIDATORS) {
      const s18 = skill(validator).split("S18 — Stateless-pickup dry-run")[1];
      expect(s18, validator).toContain("**Learned planning checks.**");
      expect(s18, validator).toContain(STEP_ZERO);
    }
    for (const toTracker of TO_TRACKERS) {
      expect(skill(toTracker), toTracker).toContain(
        "- **Learned planning checks** —"
      );
    }
  });

  it("delivery effectiveness reports the planning-miss rate", () => {
    const effectiveness = skill("lisa-delivery-effectiveness");
    expect(effectiveness).toContain("| **Planning-miss rate** |");
    expect(effectiveness).toContain("| Planning-miss rate | | | | | |");
    expect(effectiveness).toContain("`[lisa-planning-miss]`");
  });
});

describe.each(FILING_RULES)("ready-role-filing (%s)", rulePath => {
  it("names a mid-build filing as a planning signal", () => {
    const rule = read(rulePath);
    expect(rule).toContain("## Mid-build filings are a planning signal");
    expect(rule).toContain(PERSIST);
    expect(rule).toContain(PLANNING_MISS);
  });
});
