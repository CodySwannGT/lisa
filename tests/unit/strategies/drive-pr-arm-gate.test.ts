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

  it("arms only against a review context that did work", () => {
    const gate = armGate();
    expect(gate).toMatch(
      /latch may only ever be armed against a review context that did work/i
    );
    // The reasoning has to travel with the rule, or the next reader restores
    // the unconditional arm the first time a PR sits unmerged.
    expect(gate).toMatch(/AFTER the latch is on/);
    expect(gate).toMatch(/merges on green checks/i);
  });

  it("consults the shipped prover rather than re-deriving its vocabulary", () => {
    // The sharper framing of #3439: the repository already ships a detector
    // that sees every one of these modes. They merged because nothing on the
    // merge path ever consulted it.
    const gate = armGate();
    expect(gate).toMatch(/check-skipped-required-checks\.mjs --vacuity --pr=/);
    // `--vacuity` is the arm that WAITS for the checks to settle; an immediate
    // read classifies every PR as vacuous off an intermediate status.
    expect(gate).toMatch(/WAITS/);
    // The exit code is not the answer: a waived entitlement is report-only
    // under every flag, so a zero exit is not evidence of a review.
    expect(gate).toMatch(/violations\[\]\.kind/);
    expect(gate).toMatch(/never the exit code/i);
    // Every kind the prover can return is routed, including the refusal.
    for (const kind of [
      "review_evidence_unsatisfied",
      "review_evidence_waived",
      "vacuous_required_check",
      "unproven_required_check",
    ]) {
      expect(gate).toContain(kind);
    }
    expect(gate).toMatch(/an empty inspection is not a pass/i);
  });

  it("scopes itself to repositories that declare a review check", () => {
    // Without this the gate holds every PR in every repository that never
    // adopted the declaration — a fleet-wide stall for a gate none of them
    // asked for, which is how a guard gets deleted rather than adopted. The
    // defect is a REQUIRED review context reporting satisfied having read
    // nothing; where there is no such context there is no false green.
    const gate = armGate();
    expect(gate).toMatch(/Scope: repositories that declare a review check/i);
    expect(gate).toMatch(/passes this gate immediately/i);
    // "nothing to inspect" and "something was not inspected" are the same
    // `inspected: false` and opposite answers, so the refusal kind is what
    // must be read.
    expect(gate).toContain("vacuity_none_declared");
    expect(gate).toContain("vacuity_checks_unreadable");
    expect(gate).toMatch(
      /read the refusal\s+kind rather than the `inspected` flag/i
    );
  });

  it("treats the rate limit as vacuous AND transient", () => {
    const gate = armGate();
    expect(gate).toMatch(/Review rate limited/);
    expect(gate).toMatch(/throughput window/i);
  });

  it("treats the public-repository policy skip as vacuous and NOT transient", () => {
    // The mode that matters most in this repository, and the one a naive
    // wait-and-arm hangs forever on: it never clears on its own, so waiting
    // produces a stall that reads as progress.
    const gate = armGate();
    expect(gate).toMatch(
      /Review skipped: manual review required for this OSS repository/
    );
    expect(gate).toMatch(/standing vendor policy for public repositories/i);
    expect(gate).toMatch(/do not wait at all/i);
  });

  it("treats the size-limit skip as vacuous, exactly as a rate limit", () => {
    const gate = armGate();
    expect(gate).toMatch(/Review skipped: N files exceed the limit of M/);
    expect(gate).toMatch(/without splitting the pull request/i);
  });

  it("treats a bare `Review skipped` as vacuous without a stated reason", () => {
    // The case a fix is likeliest to miss, because it carries no reason to key
    // on — and in one measured population it was the dominant form by an order
    // of magnitude.
    const gate = armGate();
    expect(gate).toMatch(/`Review skipped` \(bare, no stated reason\)/);
    expect(gate).toMatch(/treat as standing/i);
    expect(gate).toMatch(
      /Requiring a stated reason before treating a skip as vacuous/i
    );
  });

  it("arms once a genuine verdict arrives", () => {
    const gate = armGate();
    expect(gate).toMatch(/the check did work \| \*\*arm\*\*/);
    expect(gate).toMatch(/If it now proves work, arm/i);
  });

  it("re-requests at most once, and never loops", () => {
    // A retry loop re-triggers the limit it is escaping, and a re-request in
    // this repository was measured minting a second hollow green rather than
    // obtaining a review (#3220).
    const gate = armGate();
    expect(gate).toMatch(/at most once/i);
    expect(gate).toMatch(/Never loop/i);
    expect(gate).toMatch(/#3220/);
  });

  it("turns off a latch armed by somebody else, and fails closed", () => {
    // Not arming is not enough: submit-pr, an older Lisa, or a prior session
    // may have left the latch on, and an armed latch merges on green
    // regardless of what this gate concluded.
    const gate = armGate();
    expect(gate).toMatch(/gh pr merge <pr> --disable-auto/);
    expect(gate).toMatch(/must print null/);
    expect(gate).toMatch(/fail closed/i);
  });

  it("states what holding the latch costs, so the trade is not re-litigated blind", () => {
    // This is the OPPOSITE trade from the armed-across-fix-pushes rule, and a
    // document that stated only the rule would read as a contradiction.
    const gate = armGate();
    expect(gate).toMatch(/cannot merge unattended/i);
    expect(gate).toMatch(/opposite trade/i);
    expect(gate).toMatch(/blocked:unreviewed/);
  });

  it("keeps the arm gate off the capability fallback's blind spot", () => {
    // On a repo that disallows auto-merge the direct-merge fallback IS the
    // merge, so exempting it would reinstate the whole defect one layer down.
    expect(content).toMatch(
      /A green review context that did no work does NOT clear the gate here either/
    );
  });

  it("binds the arm gate in on_blocker=report mode", () => {
    // The mode where forgetting it does the most damage: a diagnose-only run
    // that arms the latch has authorised a merge, not diagnosed one.
    expect(content).toMatch(
      /a diagnose-only run that arms the latch has not diagnosed\s+anything/i
    );
    expect(content).toMatch(
      /blocked:<conflict\|checks\|changes_requested\|deploy\|pending-auto-fix\|unreviewed>/
    );
  });

  it("scopes the never-terminate-unarmed invariant to a cleared gate", () => {
    // An unqualified invariant contradicts the gate: it would require restoring
    // the very latch the gate exists to withhold.
    expect(content).toMatch(
      /`auto_merge=true` \*\*and the arm gate cleared\*\*/
    );
    expect(content).toMatch(/outside this invariant/i);
  });

  it("extends the sole-gate exception to every vacuity mode", () => {
    // A size-limit skip is the same vacuity wearing a different string. Keying
    // the exception on the rate limit alone leaves the other modes with no
    // sanctioned path at all.
    expect(content).toMatch(
      /Merging past a vacuous review context is permitted/
    );
    expect(content).toMatch(
      /Every vacuity mode qualifies, not just the rate limit/i
    );
    // ...and the exception is now the ONLY route to an unreviewed merge, which
    // is what makes it reachable at last.
    expect(content).toMatch(
      /the \*only\* route by\s+which a PR merges unreviewed/i
    );
    // Merging here must not go through the latch, or the report is lost again.
    expect(content).toMatch(/Do not arm the latch to accomplish this/i);
  });

  it("spends the transient wait before adjudicating a rate limit", () => {
    expect(content).toMatch(
      /A transient vacuity is not adjudicated here until the arm gate's\s+single wait-and-re-request has been spent/i
    );
  });

  it("discriminates a stranded verdict by unresolved threads, not reviewDecision", () => {
    // The same vendor limit produces opposite failures, and the two signals
    // diverge in BOTH directions — neither is a proxy for the other.
    expect(content).toMatch(
      /discriminator between a stranded verdict and a live objection is the\s+unresolved thread count, not `reviewDecision`/i
    );
    expect(content).toMatch(/unresolved threads > 0/);
    expect(content).toMatch(/unresolved threads == 0/);
    expect(content).toMatch(/Never dismiss on `reviewDecision` alone/i);
  });

  it("requires the terminal report to name the mode it actually read", () => {
    // Asserts the REPORT's content, not that a merge happened — the sixth
    // scenario is the one that currently cannot fire at all.
    expect(content).toMatch(/MERGED — NOT REVIEWED/);
    expect(content).toMatch(/Quote the description that was actually read/i);
    expect(content).toMatch(
      /A report that says "rate limited"\s+on a policy skip is a wrong record/i
    );
    expect(content).toMatch(/NOT MERGED — NOT REVIEWED: blocked:unreviewed/);
  });

  it("adds blocked:unreviewed as a reported terminal state, in operator English", () => {
    const terminal = content.slice(content.indexOf("## 4. Terminal states"));
    expect(terminal).toMatch(/\*\*`blocked:unreviewed`\*\*/);
    // A gate outward has to be readable by whoever is standing at it.
    expect(terminal).toMatch(/Merge it yourself or ask\s+for a human review/i);
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
    expect(content).toMatch(/Do not arm auto-merge here/i);
    expect(content).toMatch(/Never run `gh pr merge --auto` in this skill/i);
  });

  it("says why the step is a prohibition, citing the unreachable exception", () => {
    expect(content).toMatch(/That exception could never fire/i);
    expect(content).toMatch(/#3439/);
    expect(content).toMatch(
      /The merge happened on the latch, not on the reasoning/i
    );
  });

  it("keeps the merge strategy, which is a property of the PR not the review", () => {
    // Losing this would break release promotion: squashing flattens the
    // `chore(release)` commits and strips their `[skip ci]` markers.
    expect(content).toMatch(/merge_method=merge/);
    expect(content).toMatch(/never squash/i);
    expect(content).toMatch(/double-bumps its version/);
  });

  it("delegates arming to drive-pr-to-merge, and says the delegation is load-bearing", () => {
    expect(content).toMatch(/Arming is delegated to `drive-pr-to-merge`/i);
    expect(content).toMatch(/the only path that arms auto-merge/i);
    expect(content).toMatch(
      /Reporting submission as complete without invoking it is a failed submit/i
    );
  });

  it("does not advertise arming auto-merge in its own description", () => {
    // A skill whose front matter says it "enables auto-merge" while being
    // forbidden to is the same defect class this ticket is about — a mechanism
    // reporting that it does something it does not.
    //
    // The Codex projection rewrites descriptions to a short trigger phrase, so
    // there is no full sentence there to assert on. What must hold everywhere
    // is the ABSENCE of the old claim; the positive form is asserted where the
    // description survives intact.
    const description = content.slice(0, content.indexOf("\n---", 4));
    expect(description).not.toMatch(/and enables auto-merge/);
    if (!root.includes(".codex-plugin")) {
      expect(description).toMatch(/It never arms auto-merge itself/);
    }
  });
});
