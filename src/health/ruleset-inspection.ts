/** Structured, bounded GitHub ruleset collection and canonical comparison. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns, max-lines -- structured collection and normalization stay colocated */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectType } from "../core/config.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import type { HealthFinding } from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import { projectPathKind } from "./read-only-fs.js";

const GH_TIMEOUT_MS = 15_000;
const MAX_GH_OUTPUT_BYTES = 256 * 1024;
const MAX_RULESETS = 32;
const ACTIONS_INTEGRATION_ID = 15_368;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/u;
const RULESET_CHECK = "github.rulesets";
const WARN = "warn";

/**
 * Return a sorted copy without mutating caller-owned input.
 * @param items - Caller-owned items
 * @param compare - Stable comparator
 */
function sortedCopy<T>(
  items: readonly T[],
  compare: (left: T, right: T) => number
): readonly T[] {
  const copy = [...items];
  // eslint-disable-next-line functional/immutable-data -- only the detached copy is sorted
  return copy.sort(compare);
}

/** Material ruleset fields health compares. */
export interface HealthRuleset {
  readonly name: string;
  readonly target: unknown;
  readonly enforcement: unknown;
  readonly conditions: unknown;
  readonly rules: unknown;
}

/**
 * Injectable structured ruleset reader. Implementations must honor `signal`
 * and release any owned handles before settling.
 */
export type RulesetReader = (
  owner: string,
  repo: string,
  projectRoot: string,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<readonly HealthRuleset[]>;

/** Ruleset comparison result containing names only. */
export interface RulesetDrift {
  readonly missing: readonly string[];
  readonly drifted: readonly string[];
}

/**
 * Run one fixed-argv bounded gh JSON read.
 * @param argv
 * @param cwd
 * @param timeoutMs
 * @param signal
 */
function readGhJson(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed gh executable
      "gh",
      [...argv],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_GH_OUTPUT_BYTES,
        signal,
        killSignal: "SIGKILL",
        timeout: Math.max(1, Math.min(timeoutMs, GH_TIMEOUT_MS)),
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

/**
 * Validate and project one detailed GitHub ruleset response.
 * @param candidate
 */
function projectRuleset(candidate: unknown): HealthRuleset {
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("Ruleset detail was not an object");
  }
  const name = Reflect.get(candidate, "name");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Ruleset detail omitted its name");
  }
  return {
    name,
    target: Reflect.get(candidate, "target"),
    enforcement: Reflect.get(candidate, "enforcement"),
    conditions: Reflect.get(candidate, "conditions"),
    rules: Reflect.get(candidate, "rules"),
  };
}

/**
 * Default fixed-argv detailed GitHub ruleset reader.
 * @param owner
 * @param repo
 * @param projectRoot
 * @param timeoutMs
 * @param signal
 */
export const readGithubRulesets: RulesetReader = async (
  owner,
  repo,
  projectRoot,
  timeoutMs,
  signal
) => {
  const listed = await readGhJson(
    ["api", "-X", "GET", `repos/${owner}/${repo}/rulesets`],
    projectRoot,
    timeoutMs,
    signal
  );
  if (!Array.isArray(listed) || listed.length > MAX_RULESETS) {
    throw new Error("Ruleset list exceeded its bounded contract");
  }
  const details = await Promise.all(
    listed.map(async entry => {
      if (entry === null || typeof entry !== "object") {
        throw new Error("Ruleset list entry was not an object");
      }
      const id = Reflect.get(entry, "id");
      if (!Number.isSafeInteger(id)) {
        throw new Error("Ruleset list entry omitted its id");
      }
      return projectRuleset(
        await readGhJson(
          ["api", "-X", "GET", `repos/${owner}/${repo}/rulesets/${String(id)}`],
          projectRoot,
          timeoutMs,
          signal
        )
      );
    })
  );
  return sortedCopy(details, (left, right) =>
    left.name.localeCompare(right.name)
  );
};

/**
 * Read configured required-check opt-outs without exposing their values.
 * @param config
 */
function droppedChecks(
  config: Readonly<Record<string, unknown>>
): ReadonlySet<string> {
  const github = config.github;
  const rulesets =
    github !== null && typeof github === "object" && !Array.isArray(github)
      ? Reflect.get(github, "rulesets")
      : undefined;
  const dropped =
    rulesets !== null &&
    typeof rulesets === "object" &&
    !Array.isArray(rulesets)
      ? Reflect.get(rulesets, "dropRequiredChecks")
      : undefined;
  return new Set(
    Array.isArray(dropped)
      ? dropped.filter(item => typeof item === "string")
      : []
  );
}

/**
 * Apply workflow and configured required-check normalization used by apply.
 * @param rules
 * @param hasWorkflows
 * @param dropped
 */
function normalizeExpectedRules(
  rules: unknown,
  hasWorkflows: boolean,
  dropped: ReadonlySet<string>
): unknown {
  if (!Array.isArray(rules)) return rules;
  return rules.flatMap(rule => {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Reflect.get(rule, "type") !== "required_status_checks"
    ) {
      return [rule];
    }
    const parameters = Reflect.get(rule, "parameters");
    if (parameters === null || typeof parameters !== "object") return [rule];
    const checks = Reflect.get(parameters, "required_status_checks");
    if (!Array.isArray(checks)) return [rule];
    const retained = checks.filter(check => {
      if (check === null || typeof check !== "object") return true;
      const integration = Reflect.get(check, "integration_id");
      const context = Reflect.get(check, "context");
      return (
        (hasWorkflows || integration !== ACTIONS_INTEGRATION_ID) &&
        (typeof context !== "string" || !dropped.has(context))
      );
    });
    if (retained.length === 0) return [];
    return [
      {
        ...rule,
        parameters: { ...parameters, required_status_checks: retained },
      },
    ];
  });
}

/**
 * Read expected material rulesets after the same per-project normalization as apply.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered project types
 * @param config - Safe project config
 * @returns Expected rulesets sorted by name
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- normalization mirrors the apply contract explicitly
export async function expectedRulesets(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>
): Promise<readonly HealthRuleset[]> {
  const hasWorkflows =
    (await projectPathKind(projectRoot, path.join(".github", "workflows"))) ===
    "directory";
  const dropped = droppedChecks(config);
  const byName = new Map<string, HealthRuleset>();
  for (const type of ["all", ...types]) {
    const directory = path.join(lisaRoot, type, "github-rulesets");
    try {
      for (const file of await listFilesRecursive(directory)) {
        const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
        const projected = projectRuleset(parsed);
        const normalized = {
          ...projected,
          rules: normalizeExpectedRules(projected.rules, hasWorkflows, dropped),
        };
        if (!Array.isArray(normalized.rules) || normalized.rules.length > 0) {
          // eslint-disable-next-line functional/immutable-data -- most-specific stack wins in the bounded plan
          byName.set(normalized.name, normalized);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

/**
 * Canonicalize semantically unordered JSON objects and arrays.
 * @param value
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}

/**
 * Remove read-only defaults GitHub may add to otherwise equivalent rules.
 * This projection is applied symmetrically so authored non-default values
 * remain material.
 * @param value
 */
function withoutGithubDefaults(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGithubDefaults);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        key === "required_reviewers" && Array.isArray(item) && item.length === 0
          ? []
          : [[key, withoutGithubDefaults(item)]]
      )
    );
  }
  return value;
}

/**
 * Compare expected and observed material ruleset documents.
 * @param expected
 * @param actual
 */
export function compareRulesets(
  expected: readonly HealthRuleset[],
  actual: readonly HealthRuleset[]
): RulesetDrift {
  const observed = new Map(actual.map(item => [item.name, item]));
  const missing = expected
    .filter(item => !observed.has(item.name))
    .map(item => item.name);
  const drifted = expected.flatMap(item => {
    const present = observed.get(item.name);
    if (present === undefined) return [];
    const expectedMaterial = canonical(
      withoutGithubDefaults({
        target: item.target,
        enforcement: item.enforcement,
        conditions: item.conditions,
        rules: item.rules,
      })
    );
    const actualMaterial = canonical(
      withoutGithubDefaults({
        target: present.target,
        enforcement: present.enforcement,
        conditions: present.conditions,
        rules: present.rules,
      })
    );
    if (JSON.stringify(expectedMaterial) !== JSON.stringify(actualMaterial)) {
      return [item.name];
    }
    return [];
  });
  return {
    missing: sortedCopy(missing, (left, right) => left.localeCompare(right)),
    drifted: sortedCopy(drifted, (left, right) => left.localeCompare(right)),
  };
}

/**
 * Extract a safe GitHub target without reporting configured values.
 * @param config
 */
function githubTarget(
  config: Readonly<Record<string, unknown>>
): { readonly owner: string; readonly repo: string } | undefined {
  const github = config.github;
  if (github === null || typeof github !== "object" || Array.isArray(github)) {
    return undefined;
  }
  const owner = Reflect.get(github, "org");
  const repo = Reflect.get(github, "repo");
  return typeof owner === "string" &&
    typeof repo === "string" &&
    REPOSITORY_PART.test(owner) &&
    REPOSITORY_PART.test(repo)
    ? { owner, repo }
    : undefined;
}

/**
 * Collect and compare detailed material GitHub ruleset state.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Safely detected project types
 * @param config - Safe project config
 * @param reader - Structured remote ruleset reader
 * @param timeoutMs - Remaining shared deadline
 * @param signal - Shared cancellation signal
 * @returns GitHub ruleset finding
 */
export async function rulesetFinding(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>,
  reader: RulesetReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HealthFinding> {
  const target = githubTarget(config);
  if (target === undefined) {
    return deterministicFinding(
      "github.rulesets",
      "warn",
      "GitHub rulesets are unavailable without a configured repository."
    );
  }
  const actual = await reader(
    target.owner,
    target.repo,
    projectRoot,
    timeoutMs,
    signal
  ).catch(() => undefined);
  if (actual === undefined) {
    return deterministicFinding(
      RULESET_CHECK,
      WARN,
      "GitHub rulesets could not be observed within the deterministic deadline."
    );
  }
  const expected = await expectedRulesets(lisaRoot, projectRoot, types, config);
  const drift = compareRulesets(expected, actual);
  const names = [
    ...drift.missing.map(name => `${name} missing`),
    ...drift.drifted.map(name => `${name} drifted`),
  ];
  return names.length === 0
    ? deterministicFinding(
        RULESET_CHECK,
        "pass",
        "Required GitHub rulesets are active and materially current."
      )
    : deterministicFinding(
        RULESET_CHECK,
        "fail",
        namedReason("GitHub ruleset drift", names)
      );
}
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns, max-lines -- restore repository defaults */
