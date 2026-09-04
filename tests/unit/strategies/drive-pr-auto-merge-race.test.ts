/**
 * Regression tests for issue #1395: auto-merge must not stay armed while a
 * later fix commit is still being pushed or queued for checks.
 *
 * Extended for issue #1777: shipped-verification must also assert a deploy/
 * release workflow run actually fired for the merge SHA (auto-merge can trigger
 * zero deploy runs when GitHub suppresses the `on: push` event for a bot merge
 * commit), not just merge ancestry.
 *
 * Both source and generated plugin roots — including the sixth Codex root — are
 * asserted so a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-auto-merge-race
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

describe.each(ROOTS)("drive-pr-to-merge auto-merge race guard (%s)", root => {
  const content = readSkill(root, "lisa-drive-pr-to-merge");

  it("checks the live PR head before enabling auto-merge", () => {
    expect(content).toMatch(/headRefOid/);
    expect(content).toMatch(/Never enable\s+auto-merge against a stale head/i);
  });

  it("keeps auto-merge ARMED across fix pushes, and says why that is safe", () => {
    // Reversed from the original #1395 guard, deliberately. That guard required
    // the latch to be DISARMED before a fix push. Disarming is a durable change
    // on GitHub while re-arming is one more step the run has to reach, so a run
    // that ended in between left the PR unable to merge unattended — worse off
    // than if the skill had never touched it, and reported as success.
    //
    // The window a disarm protected is only the gap between deciding to fix and
    // the fix landing; once a commit is pushed, GitHub blocks on required checks
    // that have not reported for the new head. The two merges attributed to that
    // window were fixed forward within minutes, one a docs typo — and are not
    // even distinguishable from a human pressing Merge, since auto-merge is
    // attributed to whoever enabled it.
    expect(content).toMatch(/leave the latch ARMED/i);
    expect(content).toMatch(/Never disable auto-merge/i);
    // The reasoning has to travel with the rule: an agent that finds only the
    // instruction and not the trade-off will re-add the disarm the first time a
    // race is suspected.
    expect(content).toMatch(/required checks against\s+the PR's current head/i);
  });

  // Where the auto_merge=false contract ends and the auto_merge=true path
  // begins. Split on this rather than on the section header: the false-mode
  // block lives INSIDE section 1 and legitimately contains a disarm, so a
  // slice that starts at the header covers both modes and can only pass by
  // having a regex too weak to notice — which is exactly how the first version
  // of this test passed while three stale disarms sat further down the file.
  const TRUE_MODE_ANCHOR =
    "Before enabling auto-merge, capture the live PR head";

  /** Every spelling of "turn the latch off" that appears in this document. */
  const DISARM_FORMS =
    /--disable-auto|disarm|auto-merge\s+must be disabled|re-enable auto-merge/i;

  it("keeps the auto_merge=false disarm, with its fail-closed re-read", () => {
    const falseModeEnd = content.indexOf(TRUE_MODE_ANCHOR);
    const sectionStart = content.indexOf("## 1. Enable auto-merge");
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(falseModeEnd).toBeGreaterThan(sectionStart);

    const falseMode = content.slice(sectionStart, falseModeEnd);

    // This mode must still disarm a pre-existing latch: skipping the enable
    // step is not enough when a prior session already armed the PR, and an
    // auto_merge=false PR must stay open for a human.
    expect(falseMode).toMatch(/disarm any pre-existing auto-merge latch/i);
    expect(falseMode).toMatch(/gh pr merge <pr> --disable-auto/);
    // ...and the fail-closed re-read that proves the disarm actually took.
    expect(falseMode).toMatch(/must print null/);
    expect(falseMode).toMatch(/fail closed/i);
  });

  it("leaves no disarm instruction anywhere on the auto_merge=true path", () => {
    const trueModeStart = content.indexOf(TRUE_MODE_ANCHOR);
    expect(trueModeStart).toBeGreaterThanOrEqual(0);

    // The rationale block necessarily says "disarm" — it exists to explain why
    // the policy changed. Cut it by its own boundaries rather than pattern-
    // matching the prose, so what remains is only INSTRUCTION text. (Filtering
    // the explanation line-by-line is how this test first went red against the
    // very paragraph documenting its own rule.)
    const rationaleStart = content.indexOf(
      "**With `auto_merge=true`, leave the latch ARMED"
    );
    const rationaleEnd = content.indexOf("What still applies on a push");
    expect(rationaleStart).toBeGreaterThan(trueModeStart);
    expect(rationaleEnd).toBeGreaterThan(rationaleStart);

    // THE INVARIANT NARROWED, and this excision is where that is recorded.
    //
    //   before:  auto_merge=true                 => never disarm
    //   after:   auto_merge=true AND not held    => never disarm
    //
    // The hold gate (#3558) lets anyone stop an in-flight run by labelling the
    // PR, and stopping means turning the latch off — on a run that began as
    // auto_merge=true. So section 4's two hold outcomes describe a disarm, and
    // they are DESCRIPTIONS of a terminal state rather than instructions to
    // disarm mid-drive.
    //
    // This is not an accommodation. The defect this test guards is the RACE —
    // disarm, re-arm, repeatedly, while still driving — and a hold does neither
    // half: once, then stop. The compensating assertion below pins exactly that,
    // so the narrowing is guarded rather than merely permitted. Widening this
    // excision any further needs the same treatment: cut by boundary, and prove
    // what you cut is still constrained somewhere else.
    const holdOutcomesStart = content.indexOf("- **`awaiting-human:held`**");
    const holdOutcomesEnd = content.indexOf(
      "- **`CLOSED`**",
      holdOutcomesStart
    );
    expect(holdOutcomesStart).toBeGreaterThan(rationaleEnd);
    expect(holdOutcomesEnd).toBeGreaterThan(holdOutcomesStart);

    const instructions =
      content.slice(trueModeStart, rationaleStart) +
      content.slice(rationaleEnd, holdOutcomesStart) +
      content.slice(holdOutcomesEnd);
    // Guard the guard: bad anchors would slice to nothing and pass vacuously.
    expect(instructions.length).toBeGreaterThan(2000);

    const offenders = instructions
      .split("\n")
      .filter(line => DISARM_FORMS.test(line));

    expect(offenders).toEqual([]);
  });

  it("constrains the one disarm the true path now allows: the hold, once, then stop", () => {
    // COMPENSATING ASSERTION for the excision above. The test either side of it
    // would pass a hold that disarmed and then carried on driving, or disarmed
    // and re-armed on the next iteration — which is the race, reintroduced
    // through the one door this change opened. So the exception is pinned here
    // rather than merely excused there.
    //
    // Both halves are asserted separately because they fail separately: a hold
    // that re-arms is the race outright, while a hold that keeps driving is the
    // slower version that gets there on the next fix-push.
    expect(content).toMatch(/The disarm is once and terminal/);
    expect(content).toMatch(/never re-arm the latch afterwards/);
    expect(content).toMatch(/never\s+resume driving in the same run/);

    // And the reason has to travel with the rule, or the next reader relaxes it
    // back into a pause that polls.
    expect(content).toMatch(
      /A hold that re-armed, or that\s+kept driving afterwards, would be the race that rule names/
    );
  });

  it("refuses merge_method=rebase rather than verifying it wrongly", () => {
    // The REFUSAL itself, not merely a mention of the word. "Never rebase"
    // alone would pass against a document that named rebase and then went on
    // to accept it.
    expect(content).toMatch(/REJECT `merge_method=rebase`/);
    expect(content).toMatch(/merge_method=<merge>/);
    // ...and the old permissive signature is gone, not merely contradicted.
    expect(content).not.toMatch(/merge_method=<merge\|rebase>/);
  });

  it("says WHY rebase cannot be verified, in both its parts", () => {
    // The reasoning travels with the rule, so nobody re-adds `rebase` without
    // meeting the argument. Both halves matter and they fail differently:
    // rewritten SHAs break the ancestry check, and the absent merge commit
    // breaks the parent assertion. A document stating only one would leave the
    // next reader thinking the other case is handled.
    expect(content).toMatch(/rewrites the commits/i);
    expect(content).toMatch(/creates no merge commit/i);
    expect(content).toMatch(
      /merge-parent assertion has nothing to assert against/i
    );
    // And the consequence, which is what makes refusing better than accepting:
    // a successful merge reported as a failure drives a false fix-forward.
    expect(content).toMatch(/false fix-forward/i);
  });

  it("scopes the armed-latch rule to auto_merge=true", () => {
    // An unqualified "never disable auto-merge" contradicts the auto_merge=false
    // contract, which disarms a pre-existing latch on purpose so the PR stays
    // open for a human.
    expect(content).toMatch(/With `auto_merge=true`, leave the latch ARMED/);
    expect(content).toMatch(
      /auto_merge=false` the deliberate disarm above still applies/
    );
  });

  it("never instructs disabling the latch on the happy path", () => {
    // The mutation this file exists to catch, now pointing the other way: a
    // reinstated disarm. `auto_merge=false` is a different thing — that mode
    // deliberately disarms a pre-existing latch and must stay untouched — so
    // this asserts on the section that runs when auto_merge=true.
    const armSection = content.slice(
      content.indexOf("## 1. Enable auto-merge"),
      content.indexOf("## 2.")
    );
    expect(armSection.length).toBeGreaterThan(500);
    expect(armSection).not.toMatch(/disablePullRequestAutoMerge/);
    expect(armSection).not.toMatch(/Do not leave auto-merge armed/i);
  });

  it("resets verify_commit to the pushed head after every push", () => {
    // Retained from the original #1395 guard, minus the "before re-enabling"
    // half — nothing is disabled now, so there is nothing to re-enable. What
    // still matters, and matters MORE without a disarm, is that the
    // shipped-verification in step 3 targets the commit actually pushed: that
    // ancestry check is what catches a raced merge after the fact.
    expect(content).toMatch(
      /reset\s+`verify_commit` to the returned\/pushed head/i
    );
    expect(content).toMatch(/failed drive-to-merge outcome/i);
  });

  it("asserts a deploy/release workflow run fired for the merge SHA, keyed to the merged-into branch", () => {
    expect(content).toMatch(/deploy\/release workflow run|deploy run/i);
    expect(content).toMatch(/is the merge SHA or an including descendant/i);
    expect(content).toMatch(/deploy\.branches/);
    // Vendor-neutral on the workflow name — must not hardcode a single file.
    expect(content).toMatch(/not\s+(?:fixed|hardcode)/i);
  });

  it("names the on:push-suppression root cause and the incident of record", () => {
    expect(content).toMatch(/on: push/);
    expect(content).toMatch(/suppress/i);
    expect(content).toMatch(/1b3f836/);
    expect(content).toMatch(/TUN-186/);
  });

  it("bounds the poll before concluding a deploy run is absent", () => {
    expect(content).toMatch(/before concluding/i);
    expect(content).toMatch(/bounded wait/i);
  });

  it("recovers zero deploy runs via workflow_dispatch then re-verify, else blocks", () => {
    expect(content).toMatch(/gh workflow run/);
    expect(content).toMatch(/workflow_dispatch/);
    expect(content).toMatch(/blocked:deploy/);
    expect(content).toMatch(/silent "done"/);
    expect(content).toMatch(/[Nn]ever report shipped on ancestry alone/);
  });

  it("in report mode classifies the deploy-run absence without dispatching", () => {
    expect(content).toMatch(/dispatching\s+a\s+workflow\s+is\s+an\s+action/i);
    expect(content).toMatch(/diagnose-only/i);
  });

  it("makes a confirmed deploy run part of the MERGED success terminal", () => {
    expect(content).toMatch(
      /deploy(?:\/release)? run for the[\s\S]{0,10}merge SHA[\s\S]{0,160}success/i
    );
  });
});
