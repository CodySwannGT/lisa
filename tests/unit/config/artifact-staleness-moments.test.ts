/**
 * The two moments that stale a generated artifact, and what now sees each one.
 *
 * CodySwannGT/lisa#3876 counted three stalls on one branch in one session and
 * called them three moments. Measured, they are TWO mechanisms — the ticket's
 * moments 2 and 3 are the same merge mechanism firing twice against a moving
 * base — plus a third the ticket does not name, which
 * `tests/unit/scripts/run-artifact-checks.test.ts` and #2852 cover:
 *
 * | mechanism | what stales the artifact | what sees it |
 * | --- | --- | --- |
 * | formatter | `lint-staged` rewrites staged bytes DURING the commit, after the artifact was generated from the pre-format bytes | the `commit` gate — and, since this change, with the diagnosis at the bottom instead of buried |
 * | merge | a merge moves tracked files the artifact derives from | `.husky/post-merge`, added here; nothing before it |
 * | tracked-set ordering | regenerating BEFORE `git add` reads the pre-change tracked set (#2852) | the `commit` gate |
 *
 * ## Why a merge needed its own hook
 *
 * `git merge` does not run `pre-commit`. Measured against a throwaway
 * repository with all five hooks installed and echoing their own name:
 *
 * ```
 * plain commit  → pre-commit, prepare-commit-msg, commit-msg, post-commit
 * git merge     → prepare-commit-msg, commit-msg, post-merge
 * ```
 *
 * `pre-commit` is the hook that runs the gate registry at `commit`, so a
 * project declaring `artifact-freshness` there had that gate skipped by exactly
 * the event most likely to stale an artifact. `post-merge` is the one hook git
 * does run at that moment, and nothing in Lisa had ever used it.
 *
 * ## A merge does not ALWAYS stale them
 *
 * Measured across three merges on this repository: a 97-file merge staled
 * nothing, an 84-file merge staled nothing, and a smaller one staled both the
 * ledger and the manifest because it landed in the files they derive from. So
 * the hook RUNS the declared prover rather than warning on the fact of a merge
 * — a hook that cried staleness after every merge would be ignored within a
 * day, which is the failure mode the ticket's own note warns about.
 * @module tests/unit/config/artifact-staleness-moments
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { undeclaredChecks } from "../../../scripts/check-generated-artifact-merge-coverage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The aggregate whose ordering this change inverted. */
const AGGREGATE = "check:artifacts";

/** The runner the aggregate now delegates to. */
const RUNNER = "scripts/run-artifact-checks.mjs";

/** This repository's own post-merge hook. */
const ROOT_HOOK = ".husky/post-merge";

/** The template every TypeScript-stack host receives it through. */
const TEMPLATE_HOOK = "typescript/copy-contents/.husky/post-merge";

/** The gate the hook resolves a prover from, rather than naming one. */
const GATE_ID = "artifact-freshness";

/** How many sub-checks the aggregate is expected to name. */
const SUB_CHECK_COUNT = 6;

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its contents
 */
const read = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

/**
 * This repository's `package.json`, as text.
 * @returns Its contents
 */
const packageJson = (): string => read("package.json");

/**
 * The scripts block.
 * @returns Every script, keyed by name
 */
const scripts = (): Record<string, string> =>
  (JSON.parse(packageJson()) as { scripts: Record<string, string> }).scripts;

describe("the aggregate delegates without blinding its own guard", () => {
  it("runs the ordering-aware runner", () => {
    expect(scripts()[AGGREGATE]).toContain(`node ${RUNNER}`);
  });

  it("still lists every sub-check name in the script body", () => {
    // LOAD-BEARING, and the reason the names are arguments rather than a list
    // inside the runner. `undeclaredChecks` reads this script body with
    // /\bcheck:[a-z0-9-]+/gu and fails when a name appears that no artifact
    // declares. Move the list into the runner and that regex matches nothing:
    // the guard passes, having examined an empty set, and a seventh sub-check
    // could join the aggregate unannounced.
    const referenced = [
      ...new Set(
        [...scripts()[AGGREGATE].matchAll(/\bcheck:[a-z0-9-]+/gu)].map(
          match => match[0]
        )
      ),
    ].filter(name => name !== AGGREGATE);

    expect(
      referenced.length,
      "the guard reads these names out of the script body; an empty set is a guard examining nothing"
    ).toBe(SUB_CHECK_COUNT);
  });

  it("leaves that guard finding no undeclared check", () => {
    expect(undeclaredChecks(packageJson())).toEqual([]);
  });
});

describe("a merge has somewhere to be caught", () => {
  it("ships a post-merge hook, in this repository and in the template", () => {
    // The gap, stated as an assertion. `git merge` runs post-merge and NOT
    // pre-commit, so before this file existed the gate declared at `commit`
    // could not see a merge at all.
    expect(read(ROOT_HOOK)).toContain(GATE_ID);
    expect(read(TEMPLATE_HOOK)).toContain(GATE_ID);
  });

  it("asks the registry for the prover instead of naming one", () => {
    // Which files are generated is project-specific — `artifact-freshness`
    // ships `declareOnly` for that reason. A hook hard-coding `check:artifacts`
    // would run Lisa's own prover in projects that have neither the script nor
    // the artifacts.
    for (const hook of [ROOT_HOOK, TEMPLATE_HOOK]) {
      expect(read(hook), hook).toContain("lisa-gates.mjs");
      expect(read(hook), hook).toContain("list --moment=");
      expect(
        read(hook),
        `${hook} must not hard-code one project's prover`
      ).not.toContain("bun run check:artifacts");
    }
  });

  it("reports and never blocks, because there is nothing left to block", () => {
    // The merge commit already exists when this runs, and git ignores the
    // hook's exit code. A non-zero exit would be a refusal that refuses
    // nothing, which reads to a operator like enforcement that is not there.
    for (const hook of [ROOT_HOOK, TEMPLATE_HOOK]) {
      expect(read(hook), hook).toContain("exit 0");
      expect(read(hook), hook).not.toMatch(/^exit 1$/mu);
    }
  });

  it("resolves this repository's own registry before its published self", () => {
    // Lisa carries node_modules/@codyswann/lisa — its own last release — so a
    // resolver preferring that would report about code that is not the code in
    // this working tree. `.husky/pre-push` diverges from its template for the
    // same reason, and this pins the divergence as deliberate.
    const root = read(ROOT_HOOK);
    const template = read(TEMPLATE_HOOK);

    // The ASSIGNMENT, not the prose. Both files explain the divergence in a
    // comment that names the path, and a bare substring test would read that
    // explanation as the thing it forbids.
    const assignsPackagedRegistry =
      /^LISA_GATES="node_modules\/@codyswann\/lisa\//mu;

    expect(root).not.toMatch(assignsPackagedRegistry);
    expect(template).toMatch(assignsPackagedRegistry);
    // Everything OTHER than the resolver must stay identical, or the two
    // drift into different hooks wearing one name.
    expect(root).toContain("WHY IT REPORTS AND NEVER BLOCKS");
    expect(template).toContain("WHY IT REPORTS AND NEVER BLOCKS");
  });
});
