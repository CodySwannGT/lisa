/**
 * No package script may guard a build behind a PRESENCE test (#3778).
 *
 * `[ -d dist/configs ] || bun run build` rebuilds only when `dist` is ABSENT.
 * It never rebuilds when `dist` merely exists and is out of date, so an agent
 * rebasing onto a moving `main` inherits an hours-old `dist` and the gate
 * declares it fresh because the directory is there.
 *
 * ## Why this is the worst diagnostic shape available
 *
 * The gate goes red in files the change never touched, and all three natural
 * responses are wrong: adapt the failing test (it is correct and passes alone),
 * retry hoping for a flake (it is deterministic and fails identically forever),
 * or revert the unrelated code (nothing is wrong with it). The failure does not
 * even have a flake's one redeeming property — that a retry sometimes reveals
 * the truth.
 *
 * ## Why a class-level assertion and not five string pins
 *
 * Five pins would pass while a sixth script reintroduced the shape tomorrow.
 * The scan below reads EVERY script and fails on the pattern, so a new site is
 * caught the day it is written rather than the day it bites someone mid-rebase.
 * That is the distinction the issue draws: the instance was known and commented
 * on in `src/strategies/package-lisa.ts`; the class was not.
 * @module tests/unit/scripts/build-predicate-freshness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Scripts that must build before they run anything that reads `dist`. */
const BUILDING_SCRIPTS = [
  "lisa-test-run",
  "pretest",
  "pretest:mutation",
  "check:shell-guard-refusals",
  "postinstall",
] as const;

/**
 * A presence test standing in for a freshness test, guarding a rebuild.
 *
 * Deliberately matches the SHAPE rather than the literal `dist/configs`, so a
 * future site guarding a different artifact is caught too.
 */
const PRESENCE_GUARDED_BUILD =
  /\[\s*-[dfe]\s+[^\]]+\]\s*\|\|\s*(bun run build|tsc|npm run build|yarn build)/;

/** Every script in the repository's own package.json. */
const scripts = (): Record<string, string> =>
  (
    JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

describe("build predicates are unconditional (#3778)", () => {
  it("no script guards a build behind a presence test", () => {
    // The class assertion. A count would hide which one regressed, so the
    // failure names the offending scripts.
    const offenders = Object.entries(scripts())
      .filter(([, body]) => PRESENCE_GUARDED_BUILD.test(body))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });

  describe.each(BUILDING_SCRIPTS)("%s", name => {
    it("still builds — the fix is to stop guarding, not to stop building", () => {
      // The rejection control for the assertion above. Deleting the build
      // entirely would satisfy "no presence-guarded build" while removing the
      // thing that makes `dist` correct, so both halves are pinned.
      expect(scripts()[name] ?? "").toMatch(/bun run build|tsc/);
    });
  });

  it("postinstall still tolerates its own failure", () => {
    // Deliberately NOT unified with the other four. `postinstall` runs on a
    // consumer's machine at install time, where a build failure must not fail
    // the install — a different failure mode from a gate lying about
    // freshness. Someone tidying the five into one shape would break installs.
    expect(scripts().postinstall).toContain("|| true");
  });
});
