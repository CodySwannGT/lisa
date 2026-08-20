/**
 * `test:cov:unit` must belong to the same test runner as `test:cov`.
 *
 * The pre-push hook picks `test:cov:unit` when the project has it, so that the
 * coverage step and the integration step stop collecting the same tree twice
 * (#2827). That selection is only safe if the two scripts are the same tool.
 *
 * They very nearly were not. `test:cov:unit` was introduced on the `typescript`
 * template, and `package.lisa.json` templates deep-merge parent into child, so
 * every child stack inherited it — including `expo`, whose own `test:cov` is
 * Jest. Nothing invoked `test:cov:unit` at the time, so the mismatch was inert.
 * The moment the hook started choosing it, an Expo project's coverage gate
 * would have shelled out to vitest. This guard is what makes adding a stack, or
 * re-pinning `test:cov` on one, fail loudly instead of quietly handing that
 * stack the wrong binary.
 *
 * The complement claim — that the two scripts do not overlap — is proved
 * behaviourally by tests/integration/push-collects-integration-tree-once.
 * @module tests/unit/config/coverage-unit-script-runner-parity
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { PROJECT_TYPE_HIERARCHY } from "../../../src/core/config.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 *
 */
interface Section {
  readonly scripts?: Record<string, string>;
}

/**
 *
 */
interface Template {
  readonly force?: Section;
  readonly defaults?: Section;
}

/**
 * Read one stack's `package.lisa.json`, or null when it ships none.
 * @param type - Project type directory name, or "all" for the root template
 * @returns The parsed template, or null
 */
function readTemplate(type: string): Template | null {
  const file =
    type === "all"
      ? path.join(REPO_ROOT, "package.lisa.json")
      : path.join(REPO_ROOT, type, "package-lisa", "package.lisa.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Template;
}

/**
 * A stack and its ancestors, parent before child. Ancestry comes from the
 * shipped hierarchy rather than a copy of it, so adding a stack cannot quietly
 * escape this guard.
 * @param type - Project type
 * @returns The chain, oldest ancestor first
 */
function ancestry(type: string): readonly string[] {
  const parent = PROJECT_TYPE_HIERARCHY[type];
  return parent === undefined ? [type] : [...ancestry(parent), type];
}

/**
 * The scripts a project of this type actually ends up with — defaults first,
 * then force, each deep-merged parent into child the way `apply` does it.
 * @param type - Project type
 * @returns Resolved script map
 */
function resolveScripts(type: string): Record<string, string> {
  return ["all", ...ancestry(type)].reduce<Record<string, string>>(
    (resolved, layer) => {
      const template = readTemplate(layer);
      return template === null
        ? resolved
        : {
            ...resolved,
            ...template.defaults?.scripts,
            ...template.force?.scripts,
          };
    },
    {}
  );
}

/**
 * The test-runner binary a script invokes.
 * @param command - The script body
 * @returns "jest", "vitest", or the leading word when neither
 */
function runnerOf(command: string): string {
  if (/\bjest\b/.test(command)) return "jest";
  if (/\bvitest\b/.test(command)) return "vitest";
  return command.split(/\s+/)[0] ?? "";
}

const TYPES = Object.keys(PROJECT_TYPE_HIERARCHY);

describe.each(TYPES)("%s stack coverage scripts", type => {
  it("resolves test:cov:unit to the same runner as test:cov", () => {
    const scripts = resolveScripts(type);
    const cov = scripts["test:cov"];
    const covUnit = scripts["test:cov:unit"];
    if (cov === undefined) {
      // A stack with no coverage script has nothing for the hook to pick.
      expect(covUnit).toBeUndefined();
      return;
    }
    expect(
      covUnit,
      `${type} pins test:cov but no test:cov:unit, so its pushes still collect the integration tree twice`
    ).toBeDefined();
    expect(runnerOf(covUnit ?? ""), `${type}: ${covUnit} vs ${cov}`).toBe(
      runnerOf(cov)
    );
  });
});
