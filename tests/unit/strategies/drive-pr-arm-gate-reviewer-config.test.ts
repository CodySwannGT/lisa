/**
 * Text contract for CodySwannGT/lisa#4653: the arm gate engages on a reviewer
 * gate declared in `.lisa.config.json`, not only on
 * `.github/required-checks.json`.
 *
 * Keyed to that file alone, the gate passed by construction on every Rails
 * host, because Lisa seeds it only on TypeScript-family hosts. The executable
 * half — the arm decision itself — is pinned in
 * `tests/unit/scripts/arm-gate-reviewer-config.test.ts`; this file pins the
 * instructions that route the merge driver and the update flow through it.
 *
 * Source and every generated plugin root are asserted, so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-arm-gate-reviewer-config
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

const UPDATE_COPIES = [
  ".claude/skills/lisa-update-projects/SKILL.md",
  ".agents/skills/lisa-update-projects/SKILL.md",
  ".claude-pr/.claude/skills/lisa-update-projects/SKILL.md",
] as const;

const ARM_COMMAND =
  "node scripts/check-third-party-review-evidence.mjs --sha <head-sha> --repo <owner>/<repo>";

/**
 * The arm-gate section of one drive skill copy.
 * @param root - A plugin skills root
 * @returns The section between the arm-gate heading and the next `###`
 */
const armGateSection = (root: string): string => {
  const text = readFileSync(
    path.resolve(root, "lisa-drive-pr-to-merge", "SKILL.md"),
    "utf8"
  );
  const start = text.indexOf("### The arm gate");
  const end = text.indexOf("\n### ", start + 1);
  return text.slice(start, end);
};

describe.each(ROOTS)("drive-pr-to-merge arm gate scope (%s)", root => {
  const section = armGateSection(root);

  it("no longer passes every host without required-checks.json", () => {
    expect(section).not.toMatch(
      /`\.github\/required-checks\.json` — or none at all — passes this gate immediately/
    );
  });

  it("decides through the all-stack prover's --arm mode", () => {
    expect(section).toContain(ARM_COMMAND);
    expect(section).toContain("--arm --json [--vacuity-report <path>]");
  });

  it("keeps the vacuity classifier where it exists", () => {
    expect(section).toContain(
      "node scripts/check-skipped-required-checks.mjs --vacuity --pr=<pr> --json"
    );
  });
});

describe.each(ROOTS)("drive-pr-to-merge unreviewed routes agree (%s)", root => {
  const text = readFileSync(
    path.resolve(root, "lisa-drive-pr-to-merge", "SKILL.md"),
    "utf8"
  );

  it("names the substitute arm alongside step (d), and keeps the report line", () => {
    expect(text).toContain(
      "Both routes write the `MERGED — NOT REVIEWED` line."
    );
  });
});

describe.each(UPDATE_COPIES)("lisa-update-projects step 14 (%s)", copy => {
  const step14 =
    readFileSync(path.resolve(copy), "utf8")
      .split("\n")
      .find(line => line.startsWith("14. ")) ?? "";

  it("does not arm auto-merge unconditionally at open", () => {
    expect(step14).not.toContain("gh pr merge --auto --squash");
  });

  it("arms only through the drive skill's arm gate", () => {
    expect(step14).toContain("`lisa-drive-pr-to-merge`'s arm gate");
    expect(step14).toContain(`${ARM_COMMAND} --arm --json`);
  });
});
