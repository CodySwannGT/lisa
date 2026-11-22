/**
 * The smart push gate reaches TypeScript-family hosts through the shipped
 * unit scripts (CodySwannGT/lisa#4611).
 *
 * A seeded host's push test gate runs `test:cov:unit` (or `test:unit`), which
 * delegates to the forced `*:lisa` script. Each Vitest stack's forced script
 * runs through the affected-test selector with `--push-only`, so only a run
 * the push gate asked for is narrowed. CI and a developer's own run get every
 * test. The selector can only narrow a `vitest run`, so the Jest stack (Expo)
 * is left as it was.
 * @module tests/unit/config/push-gate-template-scripts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const VITEST_STACKS = [
  "typescript",
  "cdk",
  "nestjs",
  "npm-package",
  "phaser",
  "harper-fabric",
] as const;
const SELECTOR =
  "node scripts/lisa-affected-tests.mjs --push-only --fetch scripts/fetch-test-access-map.mjs -- lisa-test-run ";

/**
 * The forced scripts of one stack's `package.lisa.json`.
 * @param stack - Stack directory
 * @returns Script name to command
 */
function forcedScripts(stack: string): Readonly<Record<string, string>> {
  const template = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, stack, "package-lisa", "package.lisa.json"),
      "utf8"
    )
  ) as { force?: { scripts?: Record<string, string> } };
  return template.force?.scripts ?? {};
}

describe("shipped unit scripts route through the affected-test selector", () => {
  it.each(
    VITEST_STACKS.flatMap(stack => [
      [stack, "test:cov:unit:lisa"],
      [stack, "test:unit:lisa"],
    ])
  )("%s %s narrows only at push", (stack, script) => {
    const command = forcedScripts(stack)[script] ?? "";
    expect(command).toContain(SELECTOR);
    expect(command).toMatch(/ -- vitest run /u);
  });

  it.each(VITEST_STACKS)(
    "%s keeps the coverage scope marker the pre-push hook reads",
    stack => {
      const command = forcedScripts(stack)["test:cov:unit:lisa"] ?? "";
      const body = command.replace(
        /^node scripts\/lib\/worktree-dependencies\.mjs && /u,
        ""
      );
      expect(body).toMatch(/^LISA_COVERAGE_SCOPE=unit /u);
    }
  );

  it("leaves the Jest stack alone: the selector cannot narrow it", () => {
    const scripts = forcedScripts("expo");
    expect(scripts["test:cov:unit:lisa"]).not.toContain("lisa-affected-tests");
    expect(scripts["test:unit:lisa"]).not.toContain("lisa-affected-tests");
  });
});
