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
  deployJob,
  guardPasses,
  installs,
  PREPARE_JOB,
  PUSH_JOB,
  runs,
  secretReferences,
  secretReferencesIn,
  stepIndex,
} from "./support/self-pin-raise-jobs.js";

/** The package script every caller of the self-pin check goes through. */
const SCRIPT_TASK = "check:self-pin";

describe("the release raises the self-pin the check guards (#4951)", () => {
  describe("prepares only when a release is on npm, on main", () => {
    /**
     * Whether prepare_self_pin_raise starts for one combination of outcomes.
     * @param overrides - The outcomes that differ from a clean main release.
     * @param overrides.environment - The deploy environment.
     * @param overrides.release - The release job's result.
     * @param overrides.version - The version the release cut.
     * @param overrides.publish - The publish job's result.
     * @param overrides.reconciled - reconcile_release's verdict.
     * @returns Whether the guard passes.
     */
    function prepares(
      overrides: {
        environment?: string;
        release?: string;
        version?: string;
        publish?: string;
        reconciled?: string;
      } = {}
    ): boolean {
      const outcome = {
        environment: "main",
        release: "success",
        version: "7.0.0",
        publish: "success",
        reconciled: "",
        ...overrides,
      };
      return guardPasses(deployJob(PREPARE_JOB).if ?? "", {
        needs: {
          determine_environment: {
            outputs: { environment: outcome.environment },
          },
          release: {
            result: outcome.release,
            outputs: { version: outcome.version },
          },
          publish_npm: { result: outcome.publish },
          reconcile_release: { outputs: { verdict: outcome.reconciled } },
        },
      });
    }

    it("waits on every job whose outcome it reads", () => {
      expect(deployJob(PREPARE_JOB).needs).toEqual(
        expect.arrayContaining([
          "determine_environment",
          "release",
          "publish_npm",
          "reconcile_release",
        ])
      );
    });

    it("prepares after a successful publish on main", () => {
      expect(prepares()).toBe(true);
    });

    it("does not prepare off main, even after a successful publish", () => {
      expect(prepares({ environment: "staging" })).toBe(false);
      expect(prepares({ environment: "dev" })).toBe(false);
    });

    it("does not prepare when the publish failed and nothing proved it landed", () => {
      expect(prepares({ publish: "failure" })).toBe(false);
      expect(prepares({ publish: "cancelled" })).toBe(false);
      expect(prepares({ publish: "skipped" })).toBe(false);
      expect(prepares({ publish: "failure", reconciled: "missing" })).toBe(
        false
      );
      expect(prepares({ publish: "failure", reconciled: "unprovable" })).toBe(
        false
      );
    });

    it("prepares when reconcile_release proved a failed-looking publish landed", () => {
      expect(prepares({ publish: "failure", reconciled: "published" })).toBe(
        true
      );
      expect(prepares({ publish: "cancelled", reconciled: "published" })).toBe(
        true
      );
    });

    it("does not prepare off main or without a release, even when reconciled", () => {
      expect(
        prepares({
          environment: "staging",
          publish: "failure",
          reconciled: "published",
        })
      ).toBe(false);
      expect(prepares({ release: "failure" })).toBe(false);
      expect(prepares({ version: "" })).toBe(false);
    });

    it("lets reconcile_release hand its verdict on", () => {
      const reconcile = deployJob("reconcile_release") as DeployJob & {
        readonly outputs?: Record<string, string>;
      };

      expect(reconcile.outputs?.verdict).toBe(
        "${{ steps.landed.outputs.verdict }}"
      );
    });
  });

  it("installs main's locked dependencies before the raise script needs semver", () => {
    const install = runs(PREPARE_JOB).findIndex(
      run => run.trim() === "bun install --ignore-scripts --frozen-lockfile"
    );
    const raise = stepIndex(
      PREPARE_JOB,
      'scripts/raise-self-dependency-pin.mjs --version "$VERSION"'
    );

    expect(install).toBeGreaterThanOrEqual(0);
    expect(raise).toBeGreaterThan(install);
  });

  it("waits for npm, raises, then proves the lockfile, check, types and audit", () => {
    const landed = stepIndex(
      PREPARE_JOB,
      "scripts/check-npm-publish-landed.mjs"
    );
    const raise = stepIndex(
      PREPARE_JOB,
      'scripts/raise-self-dependency-pin.mjs --version "$VERSION"'
    );
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
    const upload = (deployJob(PREPARE_JOB).steps ?? []).findIndex(step =>
      (step.uses ?? "").startsWith("actions/upload-artifact@")
    );

    expect(guard).toBeGreaterThan(
      stepIndex(PREPARE_JOB, `bun run ${SCRIPT_TASK}`)
    );
    expect(upload).toBeGreaterThan(guard);
    expect(
      String(deployJob(PREPARE_JOB).steps?.[upload]?.with?.path)
        .trim()
        .split(/\s+/)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual(["bun.lock", "package.json"]);
  });
});
