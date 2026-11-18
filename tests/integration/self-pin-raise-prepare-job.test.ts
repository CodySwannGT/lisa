/**
 * The release's unprivileged half of the self-pin raise (CodySwannGT/lisa#4951).
 *
 * `prepare_self_pin_raise` runs dependency code — the install, the build and
 * the checks — so it must start only when a release is really on npm, hold no
 * secret, install with lifecycle scripts off, resolve exactly the published
 * release, and hand over nothing but package.json and bun.lock. The privileged
 * push half is held to its contract in `self-pin-drift-gate-wiring.test.ts`.
 * @module tests/integration/self-pin-raise-prepare-job
 */
import { describe, expect, it } from "vitest";

import {
  checkouts,
  type DeployJob,
  installs,
  PREPARE_JOB,
  PUSH_JOB,
  raiseJob,
  runs,
  secretReferences,
  secretReferencesIn,
  stepIndex,
} from "./support/self-pin-raise-jobs.js";

/** The flag that marks the target step: the bounded packument wait. */
const AWAIT_LISTED = "--await-listed";

/** The raise script's invocation in its own step. */
const RAISE_RUN = 'scripts/raise-self-dependency-pin.mjs --version "$VERSION"';

/** The package script every caller of the self-pin check goes through. */
const SCRIPT_TASK = "check:self-pin";

describe("the release raises the self-pin the check guards (#4951)", () => {
  it("waits until npm lists the target before raising to it", () => {
    const target = stepIndex(PREPARE_JOB, AWAIT_LISTED);
    const step = runs(PREPARE_JOB)[target] ?? "";
    const raise = stepIndex(PREPARE_JOB, RAISE_RUN);

    expect(target).toBeGreaterThanOrEqual(0);
    expect(raise).toBeGreaterThan(target);
    expect(step).toContain(
      'node scripts/check-self-dependency-pin.mjs --await-listed "$version"'
    );
    expect(step.indexOf(AWAIT_LISTED)).toBeGreaterThan(
      step.indexOf("check-npm-publish-landed.mjs")
    );
  });

  it("raises to the requested release, or to the newest installable one when none was requested", () => {
    const step = runs(PREPARE_JOB)[stepIndex(PREPARE_JOB, AWAIT_LISTED)] ?? "";
    const env =
      raiseJob(PREPARE_JOB).steps?.[stepIndex(PREPARE_JOB, AWAIT_LISTED)]?.env;

    expect(env?.REQUESTED).toBe("${{ inputs.version }}");
    expect(step).toContain('if [ -n "$REQUESTED" ]; then');
    expect(step).toContain(
      'version="$(node scripts/check-self-dependency-pin.mjs --newest-installable)"'
    );
    expect(raiseJob(PREPARE_JOB).outputs?.version).toBe(
      "${{ steps.target.outputs.version }}"
    );
  });

  it("installs main's locked dependencies before the raise script needs semver", () => {
    const install = runs(PREPARE_JOB).findIndex(
      run => run.trim() === "bun install --ignore-scripts --frozen-lockfile"
    );
    const raise = stepIndex(PREPARE_JOB, RAISE_RUN);

    expect(install).toBeGreaterThanOrEqual(0);
    expect(raise).toBeGreaterThan(install);
  });

  it("waits for npm, raises, then proves the lockfile, check, types and audit", () => {
    const landed = stepIndex(
      PREPARE_JOB,
      "scripts/check-npm-publish-landed.mjs"
    );
    const raise = stepIndex(PREPARE_JOB, RAISE_RUN);
    const prove = stepIndex(PREPARE_JOB, `bun run ${SCRIPT_TASK}`);
    const proof = runs(PREPARE_JOB)[prove] ?? "";

    expect(landed).toBeGreaterThanOrEqual(0);
    expect(raise).toBeGreaterThan(landed);
    expect(prove).toBeGreaterThan(raise);
    expect(proof).toContain("bun install --ignore-scripts --frozen-lockfile");
    // The raise step fails on the script's status, not a pipe's.
    expect(runs(PREPARE_JOB)[raise]).not.toMatch(
      /raise-self-dependency-pin\.mjs[^\n]*(?<!\|)\|(?!\|)/
    );
    expect(runs(PREPARE_JOB)[raise]).toContain("|| status=$?");
    // A refused raise (unprovable, below-floor) says why in the run summary.
    expect(runs(PREPARE_JOB)[raise]).toContain(
      "echo \"::error::$(grep -m 1 '^raise-self-dependency-pin: '"
    );
    expect(proof).toContain("bun run typecheck");
    expect(proof).toContain("bun run security:audit");
  });

  it.each([
    [PREPARE_JOB, "bun install --ignore-scripts\n"],
    [PUSH_JOB, "timeout 300 bun install --lockfile-only --ignore-scripts"],
  ])(
    "%s resolves exactly the published release, then commits the caret range",
    (job, resolve) => {
      const step = runs(job).find(run => run.includes(resolve)) ?? "";
      const exact = step.indexOf(
        'verify-self-pin-raise.mjs spec --form exact --version "$VERSION"'
      );
      const caret = step.indexOf(
        'verify-self-pin-raise.mjs spec --form caret --version "$VERSION"'
      );

      expect(exact).toBeGreaterThanOrEqual(0);
      expect(step.indexOf(resolve)).toBeGreaterThan(exact);
      expect(caret).toBeGreaterThan(step.indexOf(resolve));
    }
  );

  it("never runs a lifecycle script during an install, wrapped or not", () => {
    expect(installs(PREPARE_JOB).length).toBeGreaterThan(0);
    installs(PREPARE_JOB).forEach(line =>
      expect(line).toContain("--ignore-scripts")
    );
  });

  it("counts a wrapped install when it looks for lifecycle scripts", () => {
    expect(installs(PUSH_JOB)).toEqual([
      "timeout 300 bun install --lockfile-only --ignore-scripts",
    ]);
  });

  it("recognizes a secret in dot and indexed form alike", () => {
    const job = (value: string): DeployJob => ({ steps: [{ run: value }] });

    expect(secretReferencesIn(job("echo ${{ secrets.KEY }}"))).toEqual(["0"]);
    expect(secretReferencesIn(job("echo ${{ secrets['KEY'] }}"))).toEqual([
      "0",
    ]);
    expect(
      secretReferencesIn({ env: { K: "${{ secrets[ 'KEY' ] }}" } })
    ).toEqual(["job:env"]);
    expect(secretReferencesIn(job("echo bun.lock secretsfile"))).toEqual([]);
  });

  it("holds no secret and persists no credential while dependency code runs", () => {
    expect(secretReferences(PREPARE_JOB)).toEqual([]);
    expect(checkouts(PREPARE_JOB)).not.toHaveLength(0);
    checkouts(PREPARE_JOB).forEach(step => {
      expect(step.with?.["persist-credentials"]).toBe(false);
      expect(step.with?.["ssh-key"]).toBeUndefined();
    });
  });

  it("refuses to hand over anything but package.json and bun.lock", () => {
    const guard = stepIndex(PREPARE_JOB, "git status --porcelain");
    const upload = (raiseJob(PREPARE_JOB).steps ?? []).findIndex(step =>
      (step.uses ?? "").startsWith("actions/upload-artifact@")
    );

    expect(guard).toBeGreaterThan(
      stepIndex(PREPARE_JOB, `bun run ${SCRIPT_TASK}`)
    );
    expect(upload).toBeGreaterThan(guard);
    expect(
      String(raiseJob(PREPARE_JOB).steps?.[upload]?.with?.path)
        .trim()
        .split(/\s+/)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual(["bun.lock", "package.json"]);
  });
});
