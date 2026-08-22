/**
 * A declared gate must have something able to RUN it.
 *
 * `validateGates` asks whether a declaration is well-formed — known id, legal
 * moment, legal level — and every one of those questions passed for two gates
 * that nothing anywhere could execute. `conflict-residue` and
 * `version-duplication` sat at `pull-request` in this repository's own
 * `.lisa.config.json` while `quality.yml` contained zero occurrences of either
 * id, so the level in front of them described nothing (CodySwannGT/lisa#2843).
 *
 * The check has to be MOMENT-AWARE or it is wrong on its first run. The commit
 * and push moments have a generic executor — `lisa-run-gates.mjs` resolves
 * whatever a moment declares and runs `$runner $task` — so a declaration there
 * needs a task, not a job. The pull-request moment has no such runner: it has
 * one hand-written block per gate, each carrying a hardcoded `GATE_ID`, and
 * `QUALITY_JOB_GATES` is the record of which ones exist. A check that asked the
 * pull-request question at every moment would flag `artifact-freshness@commit`,
 * a declaration that works.
 *
 * The deploy and continuous families are a THIRD answer, not a failure. No
 * runner exists for them at all, which is its own issue and is not re-reported
 * here — the same separation `gateForSkipJob` already draws between
 * `unmappable` and `inert`.
 * @module tests/unit/config/declared-gate-executors
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROJECT_TYPE_HIERARCHY,
  PROJECT_TYPE_ORDER,
} from "../../../src/core/config.js";
import {
  QUALITY_JOB_GATES,
  REGISTRY,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const REPO_ROOT = process.cwd();

/** The gate #2843 gave an executor to. */
const FIXED_GATE = "conflict-residue";

/** The gate #2843 removed the executor-less declaration of. */
const WITHDRAWN_GATE = "version-duplication";

/** Moments whose executor is the generic hook runner. */
const HOOK_MOMENTS = new Set(["session-start", "pre-tool", "commit", "push"]);

/** The one moment whose executor is a hand-written CI job. */
const CI_MOMENT = "pull-request";

/** How a (gate, moment) declaration resolves. */
type Verdict = "executable" | "orphaned" | "no-runner-for-moment";

/** Something can run it at that moment. */
const EXECUTABLE: Verdict = "executable";

/** The moment has a runner and it does not know this gate. */
const ORPHANED: Verdict = "orphaned";

/** Nothing runs gates at this moment at all — a different defect (#2832). */
const NO_RUNNER: Verdict = "no-runner-for-moment";

/** Every job → gate pairing, as this file reads it. */
const JOB_GATES = QUALITY_JOB_GATES as Record<string, string | undefined>;

/** The gate ids some CI job resolves. */
const CI_EXECUTABLE = new Set(Object.values(JOB_GATES));

/** This repository's own declarations. */
const CONFIG = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, ".lisa.config.json"), "utf-8")
) as { gates?: Record<string, unknown> };

/** This repository's own package scripts. */
const SCRIPTS =
  (
    JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")
    ) as { scripts?: Record<string, string> }
  ).scripts ?? {};

/** Keys inside a gate's block that configure it rather than declare a moment. */
const NON_MOMENT_KEYS = new Set(["run", "task", "needs", "evidence", "awaits"]);

/**
 * The level of one moment entry, which may be a bare string or an object.
 * @param entry - The value under a moment key
 * @returns The declared level
 */
function levelOf(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null) {
    const level = (entry as { level?: unknown }).level;
    if (typeof level === "string") return level;
  }
  return "";
}

/**
 * Every (gate, moment) pair this repository declares as something to RUN.
 *
 * `runner` and the other configuration keys are skipped: the gates block
 * carries configuration alongside declarations, and treating `runner` as a gate
 * id would report an orphan that is not one.
 *
 * `off` is skipped for a sharper reason. It is a declaration NOT to run, and it
 * is the safe way to turn a gate off — the one route that removes the required
 * context at the same time, which `skip_jobs` cannot do. Demanding an executor
 * for it would make this check argue against the mechanism it exists to
 * protect: `test-node-suites` is declared `off` at push in this repository and
 * resolves to `test:node`, a script Lisa's own manifest does not define. That
 * is correct, not orphaned.
 * @returns One entry per declared gate and moment that asks for a run
 */
function declarations(): readonly (readonly [string, string])[] {
  return Object.entries(CONFIG.gates ?? {}).flatMap(([gate, value]) =>
    Object.hasOwn(REGISTRY, gate) ? momentsOf(gate, value) : []
  );
}

/**
 * The moments one gate's block asks to be run at.
 * @param gate - Gate id
 * @param value - The gate's block from the config
 * @returns One entry per moment that asks for a run
 */
function momentsOf(
  gate: string,
  value: unknown
): readonly (readonly [string, string])[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([moment]) => !NON_MOMENT_KEYS.has(moment))
    .filter(([, entry]) => levelOf(entry) !== "off")
    .map(([moment]) => [gate, moment] as const);
}

/**
 * The task a gate resolves to at one moment, honouring a `run:` override.
 * @param gate - Gate id
 * @returns The task name
 */
function taskFor(gate: string): string {
  const declared = (CONFIG.gates ?? {})[gate] as { run?: string } | undefined;
  return declared?.run ?? (REGISTRY[gate]?.task as string);
}

/**
 * Classify one declaration by whether anything can run it.
 * @param gate - Gate id
 * @param moment - Declared moment
 * @returns The verdict for that pair
 */
function classify(gate: string, moment: string): Verdict {
  if (HOOK_MOMENTS.has(moment)) {
    return SCRIPTS[taskFor(gate)] === undefined ? ORPHANED : EXECUTABLE;
  }
  if (moment === CI_MOMENT) {
    return CI_EXECUTABLE.has(gate) ? EXECUTABLE : ORPHANED;
  }
  return NO_RUNNER;
}

/** Every stack whose projects run package scripts, as the sibling suite reads it. */
const NPM_STACKS = PROJECT_TYPE_ORDER.filter(
  type => type === "typescript" || PROJECT_TYPE_HIERARCHY[type] === "typescript"
);

/**
 * The scripts a project of this stack ends up with, parent before child.
 * @param stack - Project type being applied
 * @returns Script name to command
 */
function resolvedScripts(stack: string): Record<string, string> {
  const parent = PROJECT_TYPE_HIERARCHY[stack];
  const scripts: Record<string, string> = {};
  for (const type of parent === undefined ? [stack] : [parent, stack]) {
    const file = path.join(
      REPO_ROOT,
      type,
      "package-lisa",
      "package.lisa.json"
    );
    if (!fs.existsSync(file)) continue;
    const loaded = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      force?: { scripts?: Record<string, string> };
      defaults?: { scripts?: Record<string, string> };
    };
    Object.assign(scripts, loaded.defaults?.scripts ?? {});
    Object.assign(scripts, loaded.force?.scripts ?? {});
  }
  return scripts;
}

describe("every declaration in this repository has an executor", () => {
  it("finds declarations to judge, so a passing suite is not a vacuous one", () => {
    // The whole file is a sweep over a derived list. An empty list would make
    // every assertion below pass while proving nothing — the failure mode this
    // campaign exists to remove.
    expect(declarations().length).toBeGreaterThan(10);
    expect(declarations().map(([gate]) => gate)).toContain(FIXED_GATE);
  });

  it("leaves no pull-request declaration pointing at nothing", () => {
    const orphans = declarations()
      .filter(([, moment]) => moment === CI_MOMENT)
      .filter(([gate, moment]) => classify(gate, moment) === ORPHANED)
      .map(([gate]) => gate);
    expect(
      orphans,
      `declared at pull-request with no job in QUALITY_JOB_GATES: ${orphans.join(", ")}`
    ).toEqual([]);
  });

  it("leaves no commit or push declaration pointing at nothing", () => {
    const orphans = declarations()
      .filter(([, moment]) => HOOK_MOMENTS.has(moment))
      .filter(([gate, moment]) => classify(gate, moment) === ORPHANED)
      .map(([gate, moment]) => `${gate}@${moment} needs ${taskFor(gate)}`);
    expect(orphans).toEqual([]);
  });

  it("separates a moment family with no runner from a declaration with no executor", () => {
    // A moment-unaware version of this check rediscovers "no runner exists for
    // the deploy families" and files it as an orphan, which is a different
    // issue. The verdict is distinct so that it can be reported as itself.
    expect(classify(FIXED_GATE, "pre-deploy")).toBe(NO_RUNNER);
    expect(classify(FIXED_GATE, "continuous:development")).toBe(NO_RUNNER);
    // And the classifier is not simply answering "executable" to everything:
    // a gate legal at pull-request with no job is still an orphan.
    expect(classify(WITHDRAWN_GATE, CI_MOMENT)).toBe(ORPHANED);
    expect(classify(FIXED_GATE, CI_MOMENT)).toBe(EXECUTABLE);
  });

  it("does not demand an executor for a gate declared off", () => {
    // `off` is the one route that removes the required context along with the
    // job, which is why it is the safe alternative to `skip_jobs`. A check that
    // insisted on an executor for it would push operators back onto the unsafe
    // one. Named rather than implied: this repository declares
    // `test-node-suites` off at push and has no `test:node` script.
    const gates = CONFIG.gates ?? {};
    const off = Object.entries(gates).filter(
      ([, value]) =>
        typeof value === "object" &&
        value !== null &&
        Object.values(value as Record<string, unknown>).some(
          entry => levelOf(entry) === "off"
        )
    );
    expect(off.length).toBeGreaterThan(0);
    for (const [gate] of off) {
      expect(declarations().filter(([id]) => id === gate)).toEqual([]);
    }
  });

  it("does not declare the gate whose only executor cannot fail", () => {
    // `version-duplication`'s executor is advisory by design — its own header
    // says it reports and exits 0 until the strict flip lands. A declaration
    // backed by a guaranteed-zero exit reads as governed in `lisa doctor` while
    // proving nothing, so the declaration is withdrawn until the executor can
    // fail AND ships as a template. The gate itself stays in the registry.
    expect(Object.hasOwn(CONFIG.gates ?? {}, WITHDRAWN_GATE)).toBe(false);
    expect(Object.hasOwn(REGISTRY, WITHDRAWN_GATE)).toBe(true);
  });
});

describe("the conflict-residue gate's task ships with Lisa", () => {
  it("names the job that resolves it", () => {
    expect(JOB_GATES["conflict_markers"]).toBe(FIXED_GATE);
  });

  it.each(NPM_STACKS)("%s can run the task the gate names", (stack: string) => {
    // A job wired to a gate whose default task no consumer has is the defect
    // this repository already measured on `check:work-item`: doctor recommends
    // the gate, CI runs `npm run <task>`, and the answer is `Missing script`.
    const task = REGISTRY[FIXED_GATE].task as string;
    expect(resolvedScripts(stack)[task], `${stack} cannot run ${task}`).toBe(
      "node scripts/check-conflict-markers.mjs"
    );
  });

  it("ships the prover the task invokes, so the command is not a dead path", () => {
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "all/copy-overwrite/scripts/check-conflict-markers.mjs"
        )
      )
    ).toBe(true);
  });
});
