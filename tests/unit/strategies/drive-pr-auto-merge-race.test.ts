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

  it("keeps the deliberate false-mode disarm scoped before the true-mode section, matching its real command form", () => {
    // The false-mode disarm literally runs `gh pr merge <pr> --disable-auto`
    // followed by a null reread — assert the actual invocation is present, not
    // just descriptive prose that could drift from the real command.
    const falseModeStart = content.indexOf("With `auto_merge=false`, also");
    const trueModeStart = content.indexOf(
      "With `auto_merge=true`, leave the latch ARMED"
    );
    expect(falseModeStart).toBeGreaterThan(-1);
    expect(trueModeStart).toBeGreaterThan(falseModeStart);

    const falseModeBlock = content.slice(falseModeStart, trueModeStart);
    expect(falseModeBlock).toMatch(/gh pr merge <pr> --disable-auto/);
    expect(falseModeBlock).toMatch(/must print null/);
  });

  it("leaves no disarm instruction — prose or command — in ANY auto_merge=true fix path", () => {
    // The first version of this change only rewrote section 1 and left three
    // later passages (failing checks, review threads, pending auto-fix) still
    // telling the agent to disarm — a policy that contradicted itself, and a
    // disarm that would still have happened. Scoping the check to section 1
    // is what missed it, so this walks everything from the true-mode rule
    // onward instead. The offender patterns also cover the actual CLI form
    // (`--disable-auto`) used by the false-mode disarm above, not just prose
    // paraphrases of it, so a regression that copies the real command into a
    // fix path is caught too.
    const trueModeStart = content.indexOf(
      "With `auto_merge=true`, leave the latch ARMED"
    );
    expect(trueModeStart).toBeGreaterThan(-1);

    const trueModeAndBeyond = content.slice(trueModeStart);
    expect(trueModeAndBeyond.length).toBeGreaterThan(1000);

    const offenders = trueModeAndBeyond
      .split("\n")
      .filter(line =>
        /disarm auto-merge|auto-merge\s+must be disabled|re-enable auto-merge|--disable-auto|disablePullRequestAutoMerge/i.test(
          line
        )
      );

    expect(offenders).toEqual([]);
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

  it("falls back to tree comparison instead of SHA ancestry for merge_method=rebase", () => {
    // GitHub's rebase-and-merge replays every commit onto the base with a new
    // committer and a new SHA, so the pre-merge PR head is never an ancestor
    // of the base branch even when the merge fully shipped. The SHA-ancestry
    // check (and the merge-commit-parent check) above both assume a preserved
    // SHA or a two-parent merge commit, neither of which rebase produces, so a
    // real rebase-mode ship would otherwise be misread as unshipped.
    expect(content).toMatch(
      /`merge_method=rebase`\s+is not SHA-ancestry-safe/i
    );
    expect(content).toMatch(
      /rebase-and-merge replays each commit onto the base with a new committer/i
    );
    expect(content).toMatch(/\^\{tree\}/);
    expect(content).toMatch(/skip both of those checks and compare trees/i);
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
