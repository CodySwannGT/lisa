/**
 * The two arms of the whole-list mutation gate, as one roster.
 *
 * `mutation-gate-bite` runs the committed gate twice — intact, and with a set
 * of guards' suites withheld — and requires the first to pass and the second to
 * fail. The set of withheld guards used to be a `const` inside that file, which
 * was fine while that file was the only thing that ran the arms.
 *
 * It no longer is. `mutation-sigterm-control` runs the WEAKENED arm on a hosted
 * runner to measure what kills it (CodySwannGT/lisa#2991), and a second copy of
 * the roster is precisely the staleness the bite test's own docstring records
 * happening twice: a guard is added to `stryker.conf.json`'s mutate list, one
 * copy of the roster learns about it and the other does not, and the two arms
 * silently stop being the same experiment. So the roster lives here and both
 * callers read it.
 * @module tests/helpers/mutation-gate-arms
 */
import {
  suitesByGuard,
  suitesReachingGuards,
} from "../../vitest.config.mutation";

/**
 * The guards whose suites are withheld to weaken the gate.
 *
 * This used to name one file, `tests/unit/scripts/lisa-gates.test.ts`, chosen
 * because withholding it took the whole gate from 32.14 to 28.72 against a
 * floor of 32. That 3.42-point margin was the widest available at the time and
 * it still was not enough: the comment beside it said an *ordinary* improvement
 * could not lift the weakened run back over the line, and then a large one did.
 * Raising `lisa-work-item.mjs` from 6.10 to ~54 took the intact gate to ~54, and
 * the weakened run — the one required to FAIL — scored 50.31 and passed. The
 * bite test stopped biting, silently, as a side effect of the suite improving.
 *
 * So the weakening is no longer a filename. It is a RULE: withhold every suite
 * that reaches a named guard. Three things follow, and the third is the point.
 *
 * It models the real failure. `vitest.config.mutation.ts` exists because a guard
 * whose suites drop out of the run reports its mutants as uncovered and
 * contributes nothing but denominator. Withholding a guard's suites IS that
 * event, staged deliberately.
 *
 * It is self-maintaining. A suite added for either guard joins the withheld set
 * on its own, so the margin grows with that guard's coverage instead of being
 * eroded by it — which is exactly how the single-filename version went stale.
 *
 * And the first two named guards are the two largest contributors of kills
 * (`lisa-work-item.mjs` 1,157 and `lisa-gates.mjs` 469 of 2,523), so the margin
 * is the widest obtainable rather than merely sufficient.
 *
 * `lisa-mutation.mjs` — the diff-only gate script itself — joined the mutate
 * list and this set in the same change, and the second half is not optional. A
 * new, well-covered target raises BOTH runs: its kills land in the intact run
 * and, unless its suites are withheld, in the weakened one too. That is exactly
 * the erosion recorded above, arriving from the other direction. Withholding a
 * guard's suites can only ever REMOVE kills, so every guard added here moves the
 * weakened score down and the margin up; adding a mutate target WITHOUT adding
 * it here is the move that needs justifying.
 *
 * `lisa-worktree-guard.mjs` joined for the first reason: it was enrolled in the
 * mutate list and this roster in the same change (CodySwannGT/lisa#3914). It is
 * the smallest contributor here — 81 kills of its own 334 valid mutants — and
 * that is worth stating rather than hiding, because it is the number that
 * decides whether it belongs. It is not zero, which is the disqualifying case
 * the bite test's contribution check exists to catch; a guard whose suites kill
 * nothing can be withheld without changing either score, and "removing nothing
 * changes nothing" proves nothing about the gate. 81 is a real, if small,
 * widening of the margin. Its own score is 24.25 because 196 of those mutants
 * are reported uncovered: ten of its thirteen cases drive the guard as a CLI
 * through `spawnSync`, and an assertion made in a child process cannot kill a
 * mutant activated in the parent. That is the same silent-green shape
 * `lisa-destructive-guard.mjs` had before #2844, arriving through a subprocess
 * boundary instead of a runtime `import()`, and it is why enrolling this guard
 * had to be its own change with its own measurement.
 *
 * Its effect on the aggregate is bounded rather than run, and deliberately so.
 * An aggregate is a weighted average, so enrolling a target can only pull it
 * toward that target's own score by the target's weight: 334 of the list's
 * ~12,166 valid mutants, under 3%. Against the ENFORCED floor — `thresholds`
 * `break` 32, not the `declared` 60 recorded in `_thresholdsDivergence` — the
 * new aggregate falls below 32 only if it was already below ~32.2, and the last
 * measured whole-list run was 59.03. The predicted drop is about 0.9 points.
 * That is why this change did not spend hours re-running 12,173 mutants to
 * learn a number arithmetic already bounds 25 points clear of the bar.
 *
 * `lisa-destructive-guard.mjs` joined for the second reason rather than the
 * first. It was not added to the mutate list — it was already there, scoring
 * 19.61 because two of its three suites reached it through a runtime `import()`
 * the module graph cannot see. Converting them to static imports took it to
 * 96.08 (#2844), which is ~117 additional kills landing in BOTH runs: exactly
 * the erosion recorded above, arriving from a raised target instead of a new
 * one. Withholding its suites keeps those kills out of the weakened run.
 *
 * ## Why it is here rather than in the bite test
 *
 * It was a `const` inside `mutation-gate-bite` while that file was the only
 * thing that ran the arms. `mutation-sigterm-control` now runs the weakened arm
 * on a hosted runner to measure what kills it (CodySwannGT/lisa#2991), and a
 * second copy of the roster is the same staleness recorded above arriving a
 * third time: a guard joins `stryker.conf.json`'s mutate list, one copy learns
 * about it and the other does not, and the two callers silently stop running
 * the same experiment.
 */
export const WITHHELD_GUARDS: readonly string[] = [
  "all/copy-overwrite/scripts/lisa-work-item.mjs",
  "all/copy-overwrite/scripts/lisa-gates.mjs",
  "typescript/copy-overwrite/scripts/lisa-mutation.mjs",
  "all/copy-overwrite/scripts/lisa-destructive-guard.mjs",
  "all/copy-overwrite/scripts/lisa-worktree-guard.mjs",
];

/**
 * Every suite the intact arm is allowed to run.
 * @returns Repo-relative suite paths
 */
export const intactSuites = (): readonly string[] => suitesReachingGuards();

/**
 * The suites reaching {@link WITHHELD_GUARDS}, which the weakened arm drops.
 * @returns Repo-relative suite paths, as a set for membership tests
 */
export const withheldSuites = (): ReadonlySet<string> => {
  const byGuard = suitesByGuard();
  return new Set(WITHHELD_GUARDS.flatMap(guard => byGuard.get(guard) ?? []));
};

/**
 * Every suite the WEAKENED arm is allowed to run.
 * @returns The intact list with {@link withheldSuites} removed
 */
export const weakenedSuites = (): readonly string[] => {
  const withheld = withheldSuites();
  return intactSuites().filter(suite => !withheld.has(suite));
};
