/**
 * Pins the ban on every route to the process environment, and the one module
 * Lisa's own source may read it from.
 *
 * The shipped `no-restricted-syntax` ban exists so configuration flows through
 * one place. Banning only `process.env` left `import { env } from
 * "node:process"` (and renames, namespace imports and destructuring) as a quiet
 * way round it (CodySwannGT/lisa#4929). The selectors close each route; Lisa's
 * own source reads the environment only in `src/utils/process-environment.ts`.
 * @module tests/unit/config/eslint-local-process-environment-scope
 */
import * as path from "node:path";

import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

import localConfig from "../../../eslint.config.local.js";
import { processEnvironmentBans } from "../../../src/configs/eslint/process-environment-bans.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const RULE = "no-restricted-syntax";
const ACCESSOR = "src/utils/process-environment.ts";

/**
 * Lints one snippet under the ban alone.
 * @param code - Module source
 * @returns The number of ban violations
 */
function violations(code: string): number {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(code, [
    {
      languageOptions: { ecmaVersion: "latest", sourceType: "module" },
      rules: { [RULE]: ["error", ...processEnvironmentBans("banned")] },
    },
  ]).length;
}

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

describe("processEnvironmentBans", () => {
  it.each([
    ["process.env", "export const a = process.env.HOME;"],
    ["a named env import", 'import { env } from "node:process";'],
    ["a renamed env import", 'import { env as e } from "node:process";'],
    ["the scheme-less module", 'import { env } from "process";'],
    ["a namespace import", 'import * as p from "node:process";'],
    ["a renamed default import", 'import p from "node:process";'],
    ["destructuring", "const { env } = process;"],
  ])("rejects %s", (_route, code) => {
    expect(violations(code)).toBe(1);
  });

  it.each([
    ["other process members", 'import { argv, cwd } from "node:process";'],
    ["the default import named process", 'import process from "node:process";'],
    ["other process properties", "export const a = process.argv;"],
    ["other modules' env exports", 'import { env } from "./config.js";'],
  ])("allows %s", (_route, code) => {
    expect(violations(code)).toBe(0);
  });
});

describe("process environment scope in eslint.config.local.ts", () => {
  it("turns the ban off only for the accessor and the shared test fixtures", () => {
    const off = localConfig
      .filter(entry => entry.rules?.[RULE] === "off")
      .map(entry => entry.files);
    expect(off).toEqual([
      [ACCESSOR],
      ["tests/**/support/**", "tests/support/**"],
    ]);
  });

  it(
    "enforces the ban on every other source file",
    async () => {
      expect(await severityFor(ACCESSOR)).toBe(0);
      expect(await severityFor("src/core/admission.ts")).toBe(2);
      expect(await severityFor("src/configs/vitest/base.ts")).toBe(2);
      expect(await severityFor("tests/helpers/template-toolchain.ts")).toBe(2);
    },
    ioLatencyBudgetMs(120_000)
  );
});
