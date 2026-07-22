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

  it("requires auto-merge to be disarmed or treated as race-prone before fix pushes", () => {
    expect(content).toMatch(/disablePullRequestAutoMerge/);
    expect(content).toMatch(/Do not leave auto-merge armed/i);
    expect(content).toMatch(/required fix, CodeRabbit follow-up/i);
  });

  it("resets verify_commit to the pushed head before re-enabling auto-merge", () => {
    expect(content).toMatch(
      /reset\s+`verify_commit` to the returned\/pushed head/i
    );
    expect(content).toMatch(/wait for that head's checks to start/i);
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
