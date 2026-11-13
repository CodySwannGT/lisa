/**
 * Regression tests for issue #3439: auto-merge must not be armed before a
 * review exists.
 *
 * `lisa-drive-pr-to-merge` carries an exception permitting a merge past a
 * review check that reported `SUCCESS` having reviewed nothing — five
 * conditions verified against a live poll, and a mandatory
 * `MERGED — NOT REVIEWED` line in the terminal report. That exception was
 * UNREACHABLE: `lisa-git-submit-pr` armed the latch at submit time, before any
 * review could exist, so GitHub merged the pull request the moment CI went
 * green and none of the five conditions was ever evaluated. The merge happened
 * on the latch, not on the reasoning.
 *
 * The fix is an arm gate, not a red gate. Nothing here makes a vacuous review
 * BLOCK — the owner's ruling on CodySwannGT/lisa#3221 waives the two vendor
 * entitlement descriptions precisely because reddening every pull request on a
 * billing state is a worse gate than the one it replaces. What changes is who
 * decides: with the latch held off, an unreviewed merge has exactly one route
 * left, and that route reports itself.
 *
 * Each vacuity mode gets its OWN named test on purpose. A fix keyed on
 * `Review rate limited` alone would pass on this repository's rate-limited
 * merges while leaving the policy, size-limit and bare-skip modes untouched,
 * and would look complete — so narrowing the skill to that one string must
 * redden three tests separately rather than one.
 *
 * Both source and generated plugin roots — including the sixth Codex root — are
 * asserted so a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-arm-gate
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe.each(ROOTS)("drive-pr-to-merge arm gate (%s)", root => {
  const content = readSkill(root, "lisa-drive-pr-to-merge");

  /**
   * The gate itself, sliced by its own heading so an assertion cannot be
   * satisfied by prose living somewhere else in a 700-line document.
   *
   * @returns The arm-gate section, from its heading to the watch loop
   */
  const armGate = (): string => {
    const start = content.indexOf("### The arm gate");
    const end = content.indexOf("## 2. The watch loop");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return content.slice(start, end);
  };

  it("consults the shipped prover rather than re-deriving its vocabulary", () => {
    // The sharper framing of #3439: the repository already ships a detector
    // that sees every one of these modes. They merged because nothing on the
    // merge path ever consulted it.
    const gate = armGate();
    expect(gate).toMatch(/check-skipped-required-checks\.mjs --vacuity --pr=/);
    // Every kind the prover can return is routed, including the refusal.
    for (const kind of [
      "review_evidence_unsatisfied",
      "review_evidence_waived",
      "vacuous_required_check",
      "unproven_required_check",
    ]) {
      expect(gate).toContain(kind);
    }
  });

  it("scopes itself to repositories that declare a review check", () => {
    // Without this the gate holds every PR in every repository that never
    // adopted the declaration — a fleet-wide stall for a gate none of them
    // asked for, which is how a guard gets deleted rather than adopted. The
    // defect is a REQUIRED review context reporting satisfied having read
    // nothing; where there is no such context there is no false green.
    const gate = armGate();
    // "nothing to inspect" and "something was not inspected" are the same
    // `inspected: false` and opposite answers, so the refusal kind is what
    // must be read.
    expect(gate).toContain("vacuity_none_declared");
    expect(gate).toContain("vacuity_checks_unreadable");
  });

  it("scopes the never-terminate-unarmed invariant to a cleared gate", () => {
    // An unqualified invariant contradicts the gate: it would require restoring
    // the very latch the gate exists to withhold.
    expect(content).toMatch(
      /`auto_merge=true` \*\*and the arm gate cleared\*\*/
    );
  });

  it("extends the sole-gate exception to every vacuity mode", () => {
    expect(content).toMatch(
      /Both routes write the `MERGED — NOT REVIEWED` line/
    );
  });

  it("substitutes then stops on a stale bot verdict a rate limit cannot replace", () => {
    // #4572: under a throttle the bot cannot post a fresh review, so its old
    // CHANGES_REQUESTED on an outdated head is the only blocker and will not
    // clear on its own. Waiting for the window is the stall this removes.
    const start = content.indexOf("### e. Review gate stall");
    const end = content.indexOf("### f. Pending auto-fix PR");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
  });

  it("discriminates a stranded verdict by unresolved threads, not reviewDecision", () => {
    // The same vendor limit produces opposite failures, and the two signals
    // diverge in BOTH directions — neither is a proxy for the other.
    expect(content).toMatch(
      /discriminator between a stranded verdict and a live objection is the\s+unresolved thread count, not `reviewDecision`/i
    );
    expect(content).toMatch(/Never dismiss on `reviewDecision` alone/i);
  });

  it("requires the terminal report to name the mode it actually read", () => {
    // Asserts the REPORT's content, not that a merge happened — the sixth
    // scenario is the one that currently cannot fire at all.
    expect(content).toMatch(/MERGED — NOT REVIEWED/);
    expect(content).toMatch(/NOT MERGED — NOT REVIEWED: blocked:unreviewed/);
  });
});

describe.each(ROOTS)("git-submit-pr does not arm auto-merge (%s)", root => {
  const content = readSkill(root, "lisa-git-submit-pr");

  it("never runs `gh pr merge --auto`", () => {
    // The defect itself: at submit time no review exists, so arming here
    // authorises a merge before anything could have objected.
    //
    // Asserted line by line rather than as a bare `not.toMatch`, because the
    // prohibition necessarily QUOTES the command it forbids. A document-wide
    // absence check can only pass by never naming the thing it bans, which
    // leaves the next reader with a rule and no idea what it refers to.
    const naming = content
      .split("\n")
      .filter(line => /gh pr merge --auto/.test(line));
    expect(naming.length).toBeGreaterThan(0);
    expect(naming.filter(line => !/Never run|Do not arm/i.test(line))).toEqual(
      []
    );
    // The old instruction form is gone, not merely contradicted further down.
    expect(content).not.toMatch(/use `gh pr merge --auto --merge`/);
    expect(content).toMatch(/Never run `gh pr merge --auto` in this skill/i);
  });

  it("delegates arming to drive-pr-to-merge, and says the delegation is load-bearing", () => {
    expect(content).toMatch(/Arming is delegated to `drive-pr-to-merge`/i);
  });
});
