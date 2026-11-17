/**
 * Pins the one place Lisa's own lint turns `sonarjs/os-command` off.
 *
 * `lisa admit -- "<command line>"` runs the operator's command line through a
 * shell by design, so the rule is off for that file. The override must stay
 * exactly that narrow: a broader glob, or a second file, would let a real
 * shell-injection path through unreviewed (CodySwannGT/lisa#4929).
 * @module tests/unit/config/eslint-local-os-command-scope
 */
import * as path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

import localConfig from "../../../eslint.config.local.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const RULE = "sonarjs/os-command";

/**
 * Resolves the severity the repository's flat config applies to one file.
 * @param relative - Repository-relative source path
 * @returns The rule's severity entry, or undefined when the rule is not set
 */
async function severityFor(relative: string): Promise<unknown> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const config = (await eslint.calculateConfigForFile(
    path.join(REPO_ROOT, relative)
  )) as { rules?: Record<string, unknown> };
  const entry = config.rules?.[RULE];
  return Array.isArray(entry) ? entry[0] : entry;
}

describe("sonarjs/os-command scope in eslint.config.local.ts", () => {
  it("turns the rule off for exactly one file, the admit command", () => {
    const overrides = localConfig.filter(
      entry => entry.rules !== undefined && RULE in entry.rules
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.files).toEqual(["src/cli/admit-cmd.ts"]);
    expect(overrides[0]?.rules?.[RULE]).toBe("off");
  });

  it(
    "leaves the rule enforced on every other source file",
    async () => {
      expect(await severityFor("src/cli/admit-cmd.ts")).toBe(0);
      expect(await severityFor("src/cli/gh-cli.ts")).toBe(2);
    },
    ioLatencyBudgetMs(120_000)
  );
});
