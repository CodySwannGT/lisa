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

  it("engages on a reviewer declared in .lisa.config.json", () => {
    expect(section).toContain("in EITHER place");
    expect(section).toContain("`evidence.reviewer: true`");
    expect(section).toContain("Only a repository that declares neither");
  });

  it("no longer passes every host without required-checks.json", () => {
    expect(section).not.toMatch(
      /`\.github\/required-checks\.json` — or none at all — passes this gate immediately/
    );
  });

  it("decides through the all-stack prover's --arm mode", () => {
    expect(section).toContain(ARM_COMMAND);
    expect(section).toContain("--arm --json [--vacuity-report <path>]");
    expect(section).toContain("Read `arm` and `action`, not the exit code");
  });

  it("keeps the vacuity classifier where it exists", () => {
    expect(section).toContain(
      "node scripts/check-skipped-required-checks.mjs --vacuity --pr=<pr> --json"
    );
    expect(section).toContain("pass its report in");
  });

  it("arms on a substitute as well as on a completed review", () => {
    expect(section).toMatch(/`satisfied`, or\s+`substituted`/);
  });

  it("counts a substitute only as a writer's first-line marker", () => {
    expect(section).toMatch(
      /comment's \*\*first line\*\* and its author has\s+\*\*write access\*\*/
    );
  });

  it("scopes a substitute-based arm to its head across pushes", () => {
    expect(section).toContain(
      'An arm with `basis: "substitute"` is authorised for that head only.'
    );
    expect(section).toMatch(/disarm it \(`gh pr merge <pr> --disable-auto`/);
  });

  it("treats a requested-changes proof as a blocker", () => {
    expect(section).toMatch(
      /`Changes requested` proof phrase proves the reviewer worked/
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
      "This and the arm gate's substitute arm (section 1) are the *only*"
    );
    expect(text).toContain(
      "Both routes write the `MERGED — NOT REVIEWED` line."
    );
  });

  it("never arms in report mode", () => {
    expect(text).toContain(
      "report mode never arms, whatever the arm decision says."
    );
  });
});

describe.each(UPDATE_COPIES)("lisa-update-projects step 14 (%s)", copy => {
  const step14 =
    readFileSync(path.resolve(copy), "utf8")
      .split("\n")
      .find(line => line.startsWith("14. ")) ?? "";

  it("does not arm auto-merge unconditionally at open", () => {
    expect(step14).toContain("Do not arm auto-merge at open.");
    expect(step14).not.toContain("gh pr merge --auto --squash");
  });

  it("arms only through the drive skill's arm gate", () => {
    expect(step14).toContain("`lisa-drive-pr-to-merge`'s arm gate");
    expect(step14).toContain(`${ARM_COMMAND} --arm --json`);
    expect(step14).toContain("`arm: true`");
  });

  it("keeps the canary hold", () => {
    expect(step14).toContain("until the canary decision is `proceed`");
  });

  it("does not let step 17 re-enable auto-merge outside the gate", () => {
    const step17 =
      readFileSync(path.resolve(copy), "utf8")
        .split("\n")
        .find(line => line.startsWith("17. ")) ?? "";

    expect(step17).toContain(
      "auto-merge armed only through the drive skill's arm gate"
    );
    expect(step17).not.toContain("with auto-merge enabled");
  });
});
