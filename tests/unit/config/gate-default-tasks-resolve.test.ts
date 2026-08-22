/**
 * Every registry default task either resolves on every npm stack, or says why
 * it does not — and where a prover ships under another name, names it.
 *
 * The registry's default-task vocabulary and the script vocabulary Lisa ships
 * into a consumer's `package.json` were two different languages, and nothing
 * compared them. Measured 2026-08-21 across all seven npm stacks, resolving
 * each stack the way `PackageLisaStrategy` does (parent template, then child):
 * of 35 default tasks, **11 resolved on every stack, 1 resolved on a single
 * stack, and 23 resolved on none**. A gate whose default names a script no
 * template installs fails as `Missing script` in the consumer's CI, not here.
 *
 * Seven of those 23 have had a working prover the whole time under the
 * vendor's name — `test:cov`, `knip:check`, `sg:scan`, `lighthouse:check`,
 * `maestro:test`, `k6:load`, `security:zap`.
 *
 * Renaming the defaults to those would be the obvious fix and is the wrong
 * one: `task` names the CONCERN and never the vendor (`test:e2e`, not
 * `test:playwright`), which is what keeps a tool swap out of this registry and
 * out of branch protection. So the gap is recorded instead of erased, and this
 * suite is what stops the record going stale.
 *
 * The sibling suite `gate-task-shipped-to-templates.test.ts` proves the same
 * property for the ONE gate `lisa doctor` declares unprompted, and proves it
 * harder — it pins the exact command and the file that command invokes.
 * Neither subsumes the other: a roster check that only compares names would
 * pass on a script pointing at a file Lisa never installs, which is exactly
 * what that suite exists to catch.
 * @module tests/unit/config/gate-default-tasks-resolve
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

/** Shortest `declareOnly` that can actually tell an operator what to do. */
const USABLE_REASON_LENGTH = 30;

/**
 * Every stack whose projects run package scripts.
 *
 * `rails` is excluded for the reason the sibling suite records: it has no
 * parent, ships no `package-lisa` template, and does not run its gates through
 * a package script.
 */
const NPM_STACKS = PROJECT_TYPE_ORDER.filter(
  type => type === "typescript" || PROJECT_TYPE_HIERARCHY[type] === "typescript"
);

/** One `package.lisa.json` template's script-bearing sections. */
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
 * The scripts a project of this stack ends up with, parent before child —
 * the chain `PackageLisaStrategy` walks.
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

const SCRIPTS_BY_STACK = new Map(
  NPM_STACKS.map(stack => [stack, resolvedScripts(stack)])
);

/**
 * Which npm stacks ship a script by this name.
 * @param script - Package-script name
 * @returns The stacks that resolve it
 */
function stacksShipping(script: string): string[] {
  return NPM_STACKS.filter(
    stack => SCRIPTS_BY_STACK.get(stack)?.[script] !== undefined
  );
}

/** One gate, flattened to what this suite asks about it. */
interface GateTasks {
  readonly id: string;
  readonly tasks: readonly string[];
  readonly declareOnly: string | undefined;
  readonly shippedAs: string | undefined;
}

const GATES: readonly GateTasks[] = Object.entries(REGISTRY).map(
  ([id, gate]) => ({
    id,
    tasks: [gate.task, ...Object.values(gate.taskAt ?? {})].filter(
      (task): task is string => typeof task === "string"
    ),
    declareOnly: gate.declareOnly,
    shippedAs: gate.shippedAs,
  })
);

const UNIVERSAL = GATES.filter(gate => gate.declareOnly === undefined);
const EXCEPTED = GATES.filter(gate => gate.declareOnly !== undefined);
const ALIASED = GATES.filter(gate => gate.shippedAs !== undefined);

describe("the registry's default tasks and the shipped scripts are one vocabulary", () => {
  it("finds stacks and gates to check at all", () => {
    // The absent-case rule. Every assertion below is derived from these lists,
    // so a discovery bug — a renamed template directory, a moved registry —
    // would make them pass by comparing nothing to nothing.
    expect(NPM_STACKS.length).toBeGreaterThanOrEqual(5);
    expect(NPM_STACKS).toContain("typescript");
    expect(GATES.length).toBeGreaterThanOrEqual(30);
    expect(UNIVERSAL.length).toBeGreaterThanOrEqual(5);
    expect(EXCEPTED.length).toBeGreaterThanOrEqual(5);
    expect(ALIASED.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every gate a default task or a documented exception", () => {
    const silent = GATES.filter(
      gate => gate.tasks.length === 0 && gate.declareOnly === undefined
    ).map(gate => gate.id);

    expect(silent).toEqual([]);
  });

  it.each(UNIVERSAL.map(gate => [gate.id, gate] as const))(
    "%s claims no exception, so every npm stack must ship its task",
    (_id: string, gate: GateTasks) => {
      const unresolved = gate.tasks.flatMap(task => {
        const have = new Set(stacksShipping(task));
        return NPM_STACKS.filter(stack => !have.has(stack)).map(
          stack => `${stack} has no script "${task}"`
        );
      });

      expect(
        unresolved,
        `${gate.id} does not resolve: ${unresolved.join("; ")}. ` +
          `Ship the script, or add declareOnly saying why not (plus shippedAs, ` +
          `if a template already ships a prover under another name).`
      ).toEqual([]);
    }
  );

  it.each(EXCEPTED.map(gate => [gate.id, gate] as const))(
    "%s's exception is still true, and retires itself when it stops being",
    (_id: string, gate: GateTasks) => {
      // The half that matters over time. Without it a `declareOnly` written
      // today outlives the day its prover starts shipping, and the registry
      // goes on apologising for a gate that works.
      const everywhere =
        gate.tasks.length > 0 &&
        gate.tasks.every(
          task => stacksShipping(task).length === NPM_STACKS.length
        );

      expect(
        everywhere,
        `${gate.id} now resolves on every npm stack — delete its declareOnly.`
      ).toBe(false);
    }
  );

  it.each(EXCEPTED.map(gate => [gate.id, gate.declareOnly] as const))(
    "%s explains its exception in a usable sentence",
    (_id: string, reason: string | undefined) => {
      // A one-word excuse is not a reason. Whoever reads this has to learn
      // what to point `run:` at.
      expect((reason ?? "").length).toBeGreaterThan(USABLE_REASON_LENGTH);
    }
  );

  it.each(ALIASED.map(gate => [gate.id, gate] as const))(
    "%s names a shipped prover that is genuinely shipped",
    (_id: string, gate: GateTasks) => {
      // `shippedAs` is the field an operator acts on, so a typo in it sends
      // them at a script that does not exist — the same defect as the default,
      // one level down.
      const shipped = stacksShipping(gate.shippedAs ?? "");

      expect(
        shipped,
        `${gate.id} points at "${gate.shippedAs}", which no npm stack ships.`
      ).not.toEqual([]);
    }
  );

  it.each(ALIASED.map(gate => [gate.id, gate] as const))(
    "%s does not quietly ship its concern name too",
    (_id: string, gate: GateTasks) => {
      // If the concern-named script starts shipping everywhere, `shippedAs`
      // has become a historical note and the gate belongs in UNIVERSAL. The
      // previous assertion would still pass, so this is the one that notices.
      const concernNamed = gate.tasks.filter(
        task => stacksShipping(task).length === NPM_STACKS.length
      );

      expect(
        concernNamed,
        `${gate.id} now ships under its own name — drop shippedAs and declareOnly.`
      ).toEqual([]);
    }
  );
});
