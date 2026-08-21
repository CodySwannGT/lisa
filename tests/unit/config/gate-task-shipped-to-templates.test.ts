/**
 * The task behind a gate Lisa RECOMMENDS must ship with Lisa.
 *
 * `lisa doctor` declares `gates.traceability: {"pull-request": "required"}` in
 * any project that has not made a decision about it. That gate resolves to the
 * package script `check:work-item`. Measured 2026-08-20: the script existed in
 * Lisa's own `package.json` and in **no** `package.lisa.json` — so a project
 * that took doctor's advice ran `npm run check:work-item` in CI and got
 * `Missing script`. A green pipeline went red because the operator used the
 * tool whose whole purpose is telling them what to fix.
 *
 * The failure mode is asymmetric, which is why it survived: a repo that already
 * defines the script sees nothing wrong and never reports it. Only a repo
 * lacking it discovers the defect, and it discovers it as a red build during an
 * upgrade.
 *
 * These assertions derive the task name from the shipped registry rather than
 * hardcoding it, so renaming the gate's task without shipping the new name
 * fails here instead of in a consumer's CI.
 * @module tests/unit/config/gate-task-shipped-to-templates
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROJECT_TYPE_HIERARCHY,
  PROJECT_TYPE_ORDER,
} from "../../../src/core/config.js";
import { REGISTRY } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const REPO_ROOT = process.cwd();

/** The gate `lisa doctor` declares on a project's behalf. */
const GATE_ID = "traceability";

/**
 * Every stack whose projects run package scripts.
 *
 * `rails` is excluded deliberately: it has no parent in the hierarchy, ships no
 * `package-lisa` template, and does not run its gates through a package script.
 * The doctor-side guard is what protects a Rails host — it declines to
 * recommend a gate whose task it cannot see resolve.
 */
const NPM_STACKS = PROJECT_TYPE_ORDER.filter(
  type => type === "typescript" || PROJECT_TYPE_HIERARCHY[type] === "typescript"
);

/** One `package.lisa.json` template's `force.scripts` block. */
interface TemplateScripts {
  readonly force?: { readonly scripts?: Record<string, string> };
  readonly defaults?: { readonly scripts?: Record<string, string> };
}

/**
 * Read one stack's `package.lisa.json`, or `null` when it ships none.
 * @param stack - Project type whose template to read
 * @returns The parsed template, or null
 */
function template(stack: string): TemplateScripts | null {
  const file = path.join(REPO_ROOT, stack, "package-lisa", "package.lisa.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as TemplateScripts;
}

/**
 * The scripts a project of this stack ends up with, following the same
 * parent-before-child chain `PackageLisaStrategy` walks.
 *
 * `force` and `defaults` are both consulted because either one puts a runnable
 * script in the host's `package.json`; which section a task belongs in is a
 * governance question, not a "does it resolve" question.
 * @param stack - Project type being applied
 * @returns Script name to command, child overriding parent
 */
function resolvedScripts(stack: string): Record<string, string> {
  const parent = PROJECT_TYPE_HIERARCHY[stack];
  const chain = parent === undefined ? [stack] : [parent, stack];
  const scripts: Record<string, string> = {};
  for (const type of chain) {
    const loaded = template(type);
    if (loaded === null) continue;
    Object.assign(scripts, loaded.defaults?.scripts ?? {});
    Object.assign(scripts, loaded.force?.scripts ?? {});
  }
  return scripts;
}

/** Every task the traceability gate can resolve to, by moment. */
const TASKS: readonly string[] = [
  REGISTRY[GATE_ID].task,
  ...Object.values(REGISTRY[GATE_ID].taskAt ?? {}),
];

describe("the traceability gate's task ships to every npm stack", () => {
  it("covers more than one stack, so a passing suite is not a vacuous one", () => {
    expect(NPM_STACKS.length).toBeGreaterThan(1);
    expect(NPM_STACKS).toContain("typescript");
    expect(TASKS).toContain("check:work-item");
  });

  it.each(NPM_STACKS)(
    "%s resolves every task the gate can name",
    (stack: string) => {
      const scripts = resolvedScripts(stack);
      const missing = TASKS.filter(task => scripts[task] === undefined);
      expect(missing, `${stack} cannot run: ${missing.join(", ")}`).toEqual([]);
    }
  );

  it.each(NPM_STACKS)(
    "%s points the pull-request task at the shipped validator",
    (stack: string) => {
      expect(resolvedScripts(stack)[REGISTRY[GATE_ID].task]).toBe(
        "node scripts/lisa-work-item.mjs validate-pr"
      );
    }
  );

  it("ships the validator the task invokes, so the command is not a dead path", () => {
    // A script line naming a file Lisa never installs would satisfy the
    // assertions above and still fail in a consumer with MODULE_NOT_FOUND.
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-work-item.mjs")
      )
    ).toBe(true);
  });
});
