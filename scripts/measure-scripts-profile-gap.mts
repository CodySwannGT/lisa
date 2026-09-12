/**
 * Measure how much weaker the `scripts/` rule profile is than the profile the
 * same file would meet anywhere else, and what that difference costs in
 * findings.
 *
 * WHY THIS EXISTS. `getScriptsFilesOverride()` in `src/configs/eslint/base.ts`
 * relaxes a set of rules for every path matching `scripts/**` or
 * `**\/scripts/**`. Each relaxation is argued in that file and several are
 * plainly right. What nobody could state was the SIZE of the thing: a file
 * written in `scripts/` can carry a defect of a class the wider profile catches
 * and never be told, because in `scripts/` it is not a violation
 * (CodySwannGT/lisa#3773). That is a different failure from a control that did
 * not fire — the control ran, was correct, and its SCOPE excluded the file.
 * The worked example was a `sonarjs/slow-regex` finding that sat unreported in
 * `scripts/` from the day the file was written until the day it was moved into
 * a shipped tree, where a stricter assertion saw it immediately.
 *
 * THIS REPORTS, IT DOES NOT GATE. The exit status is 0 whenever the measurement
 * was made, whatever it found. Aligning the profiles is a policy decision with
 * a large blast radius, and this exists to put a number in front of that
 * decision rather than to take it. The established local shape is
 * `check-engine-floor.mjs`, which prints its strictness backlog and gates on
 * something else entirely.
 *
 * THE DIVERGENT SET IS DERIVED, NEVER LISTED. A hardcoded copy of the
 * override's rule list is a second source of truth that goes stale the first
 * time somebody edits the override. So the set is computed by asking ESLint
 * itself, twice, for the config it resolves for the SAME file extension in two
 * locations — one inside `scripts/`, one outside it — and taking the severity
 * difference. Add a suppression to the override and this measurement grows a
 * row with nobody remembering to update it; delete one and the row disappears.
 *
 * IT ASKS THE REPOSITORY'S OWN CONFIG, not a reconstruction of it. `eslint.
 * config.ts` is imported and used as-is, so `eslint.config.local.ts` — which
 * re-disables one rule for `scripts/**` that a project-local block had silently
 * re-enabled — is part of the answer. A reconstruction assembled from the
 * factory would have missed that, and missing it is the same class of error the
 * measurement is about.
 *
 * WHY THE NODE API RATHER THAN THE `eslint` CLI. Measured on a developer
 * checkout carrying nested worktrees, `npx eslint --format json <90 files>`
 * exhausts an 8 GB heap and returns nothing, because `tsconfig.eslint.json`
 * includes `**\/*.ts` and the typed program grows without bound. The in-process
 * API over the same file set completes. A measurement that cannot run where the
 * code lives is not a measurement, so the slower, working route is the right
 * one; expect several minutes.
 *
 * THE SUBJECT IS THE GIT INDEX, not the disk, for the reason
 * `tests/helpers/shipped-mjs-roster.ts` records at length: untracked scratch
 * files under `scripts/` belong to whoever made them and to no commit, and
 * counting them makes one agent's working tree change another agent's number.
 *
 * IT REFUSES RATHER THAN REPORTING A ZERO IT DID NOT EARN. A config that
 * resolved no rules and an empty subject set both produce "no findings", which
 * is the same shape as a clean tree. Each exits non-zero with the denial first,
 * per `scripts/lib/dependency-tree.mjs`.
 *
 * `--root` exists so the suite can point this at a fixture and prove the
 * derivation follows the config rather than a constant in this file.
 * @module scripts/measure-scripts-profile-gap
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { cannotMeasure } from "./lib/dependency-tree.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** How this measurement names itself in its report and in its refusals. */
const REPORT = "scripts-profile-gap";

/**
 * The outside-`scripts/` probe path whose resolved config is differenced.
 *
 * Both probes are `.mjs` so that the `**\/*.js` / `**\/*.mjs` override applies
 * to each and cancels: what survives the difference is the `scripts/` override
 * alone, not the JavaScript-versus-TypeScript profile. Neither file exists, and
 * neither needs to — ESLint answers for a path.
 */
const PROBE_OUTSIDE = "__scripts-profile-gap-probe__.mjs";

/** The inside-`scripts/` half of {@link PROBE_OUTSIDE}. */
const PROBE_INSIDE = "scripts/__scripts-profile-gap-probe__.mjs";

/** Extensions ESLint has an opinion about in this tree. */
const LINTABLE: readonly string[] = [".mjs", ".mts", ".ts", ".js"];

/** Severity names, indexed by the numeric form ESLint resolves rules to. */
const SEVERITY: readonly string[] = ["off", "warn", "error"];

/** One rule whose severity differs between the two probe locations. */
export type Divergence = {
  readonly rule: string;
  readonly outside: string;
  readonly inside: string;
};

/** The two-directional difference between the probes, and what was compared. */
export type Divergences = {
  readonly compared: number;
  readonly weaker: readonly Divergence[];
  readonly stricter: readonly Divergence[];
};

/**
 * Normalise one rule entry to its severity name.
 * @param entry - A rule value: a severity, or `[severity, ...options]`.
 * @returns `"off"`, `"warn"`, or `"error"`.
 */
export function severityOf(entry: unknown): string {
  const head = Array.isArray(entry) ? entry[0] : entry;
  if (typeof head === "number") return SEVERITY[head] ?? "off";
  return typeof head === "string" && SEVERITY.includes(head) ? head : "off";
}

/**
 * The rules whose severity differs between two resolved configs.
 *
 * Reported in BOTH directions on purpose. "`scripts/` is weaker" is the claim
 * under examination, and a measurement that could only ever confirm it would be
 * worth nothing. This repository has at least one rule the `scripts/` profile
 * promotes ABOVE the surrounding code, and a report unable to show that is a
 * report nobody should trust about the other direction either.
 * @param outside - Rules resolved for a path outside `scripts/`.
 * @param inside - Rules resolved for the same extension inside `scripts/`.
 * @returns The difference, each side sorted by rule name.
 */
export function divergentRules(
  outside: Readonly<Record<string, unknown>>,
  inside: Readonly<Record<string, unknown>>
): Divergences {
  const names = [...new Set([...Object.keys(outside), ...Object.keys(inside)])];
  const rows = names
    .map(rule => ({
      rule,
      outside: severityOf(outside[rule]),
      inside: severityOf(inside[rule]),
    }))
    .filter(row => row.outside !== row.inside)
    .sort((left, right) => (left.rule < right.rule ? -1 : 1));
  const shift = (row: Divergence): number =>
    SEVERITY.indexOf(row.inside) - SEVERITY.indexOf(row.outside);
  return {
    compared: names.length,
    weaker: rows.filter(row => shift(row) < 0),
    stricter: rows.filter(row => shift(row) > 0),
  };
}

/**
 * The lintable files git tracks under `scripts/`, that also exist on disk.
 *
 * A path staged for deletion is still listed by `git ls-files`, and handing
 * ESLint a path with no file behind it turns a clean tree into an error about
 * the harness.
 * @param root - Repository root.
 * @returns Repo-relative paths.
 */
export function trackedScripts(root: string): readonly string[] {
  const listed = execFileSync("git", ["ls-files", "scripts"], {
    cwd: root,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .split("\n")
    .map(line => line.trim())
    .filter(line => LINTABLE.includes(path.extname(line)))
    .filter(line => existsSync(path.join(root, line)));
}

/** A finding tally, by rule and by file. */
export type Tally = {
  readonly byRule: ReadonlyMap<string, number>;
  readonly touched: ReadonlySet<string>;
  readonly total: number;
};

/**
 * Count findings attributable to a restored rule set.
 *
 * Only messages whose rule is in {@link restored} are counted. Anything else
 * ESLint reports is the tree's existing state under the profile as it stands,
 * which is not what this measures.
 * @param root - Repository root.
 * @param results - ESLint results over the subject files.
 * @param restored - The rule ids that were re-armed.
 * @returns The tally.
 */
export function tally(
  root: string,
  results: readonly ESLint.LintResult[],
  restored: ReadonlySet<string>
): Tally {
  const byRule = new Map<string, number>();
  const touched = new Set<string>();
  for (const result of results) {
    for (const message of result.messages) {
      const id = message.ruleId ?? "";
      if (!restored.has(id)) continue;
      byRule.set(id, (byRule.get(id) ?? 0) + 1);
      touched.add(path.relative(root, result.filePath));
    }
  }
  let total = 0;
  for (const count of byRule.values()) total += count;
  return { byRule, touched, total };
}

/**
 * Build the refusal for a measurement that could not be made.
 * @param because - Why the measurement did not happen.
 * @param remedy - What the reader should do.
 * @returns The four-clause refusal text.
 */
function refusal(because: string, remedy: string): string {
  return cannotMeasure({
    gate: REPORT,
    denial: "that the scripts profile costs nothing",
    because,
    remedy,
  });
}

/**
 * Print the report and return an exit status.
 * @param root - Repository root.
 * @returns `0` when the measurement was made, `1` when it was not.
 */
export async function main(root: string): Promise<number> {
  const { default: config } = (await import(
    path.join(root, "eslint.config.ts")
  )) as { default: unknown };
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: config as ESLint.Options["overrideConfig"],
  });

  const outside = await eslint.calculateConfigForFile(
    path.join(root, PROBE_OUTSIDE)
  );
  const inside = await eslint.calculateConfigForFile(
    path.join(root, PROBE_INSIDE)
  );
  const { weaker, stricter, compared } = divergentRules(
    (outside?.rules ?? {}) as Record<string, unknown>,
    (inside?.rules ?? {}) as Record<string, unknown>
  );
  if (compared === 0) {
    console.error(
      refusal(
        "both probe paths resolved to zero rules, which is the same shape as " +
          "two identical profiles and is not evidence of one.",
        "Check that the ESLint config loads at all before reading this report."
      )
    );
    return 1;
  }

  const subject = trackedScripts(root);
  if (subject.length === 0) {
    console.error(
      refusal(
        "the git index lists no lintable file under `scripts/`, so a finding " +
          "count of zero would be an empty subject rather than a clean tree.",
        "Run this from a checkout whose index carries the `scripts/` tree."
      )
    );
    return 1;
  }

  console.log(
    `${REPORT}: ${compared} rule(s) resolved for both probes. ` +
      `${weaker.length} are WEAKER inside scripts/, ${stricter.length} ` +
      `STRICTER. Subject: ${subject.length} tracked lintable file(s).`
  );
  for (const row of stricter) {
    console.log(`  stricter  ${row.rule}: ${row.outside} → ${row.inside}`);
  }
  if (weaker.length === 0) {
    console.log(
      "✅ No rule is weaker inside scripts/ than outside it — the two " +
        "profiles carry the same bar."
    );
    return 0;
  }

  const restored = new Set(weaker.map(row => row.rule));
  const armed = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      ...(config as readonly unknown[]),
      {
        files: ["**/*"],
        rules: Object.fromEntries(weaker.map(row => [row.rule, row.outside])),
      },
    ] as ESLint.Options["overrideConfig"],
  });
  const found = tally(root, await armed.lintFiles([...subject]), restored);

  console.log("");
  console.log(
    `Measured backlog (NOT gated): restoring all ${weaker.length} weaker ` +
      `rule(s) reports ${found.total} finding(s) across ` +
      `${found.touched.size} of ${subject.length} file(s).`
  );
  const rows = [...weaker].sort(
    (left, right) =>
      (found.byRule.get(right.rule) ?? 0) - (found.byRule.get(left.rule) ?? 0)
  );
  for (const row of rows) {
    const count = found.byRule.get(row.rule) ?? 0;
    console.log(
      `  ${count}\t${row.rule} (${row.inside} here, ${row.outside} elsewhere)`
    );
  }
  console.log("");
  console.log(
    "A rule reporting 0 is a suppression this tree does not currently need. " +
      "A rule reporting more than 0"
  );
  console.log(
    "is a class of finding that exists in `scripts/` and is not reported " +
      "there. Neither is a failure; see"
  );
  console.log(
    "CodySwannGT/lisa#3773 for the decision these numbers exist to inform."
  );
  return 0;
}

/**
 * Resolve the root from `--root <dir>`, defaulting to the repository.
 * @param argv - Arguments after the script name.
 * @returns The absolute root.
 */
export function rootFrom(argv: readonly string[]): string {
  const flag = argv.indexOf("--root");
  if (flag === -1) return DEFAULT_ROOT;
  const value = argv[flag + 1];
  if (value === undefined) {
    console.error(`${REPORT}: --root requires a value`);
    process.exit(2);
  }
  return path.resolve(value);
}

if (invokedAsScript(import.meta.url)) {
  process.exit(await main(rootFrom(process.argv.slice(2))));
}
