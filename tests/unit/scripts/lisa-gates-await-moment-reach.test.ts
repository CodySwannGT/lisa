/**
 * Which moments an `await:` declaration can reach, and what happens when it
 * gets there.
 *
 * #3609 fixed a derivation gap at `pull-request` and left two moments
 * unanswered: nobody had ever asked whether the same gap existed at `push` or
 * at `pre-deploy`. The absence of an answer is what this module removes. The
 * two answers are opposite, and neither is the one the shape of the question
 * suggests.
 *
 * **At `push` the gap cannot exist.** Not because it was looked for and not
 * found — because its precondition is unreachable. `validateMoment` refuses an
 * `await:` at every moment in `NO_STATUS_MOMENTS`, so no valid configuration
 * can put an awaited signal there for a second derivation to disagree about.
 * `commit`, `session-start`, `pre-tool` and `post-tool` are refused for the
 * same reason and are swept here alongside it. This is a precondition
 * satisfied by construction, which is exactly the kind that goes untested and
 * then quietly stops holding, so it is asserted over the WHOLE registry rather
 * than for one representative gate.
 *
 * **At the deploy families a different gap is wide open.** `pre-deploy`,
 * `post-deploy` and `continuous` are not in `NO_STATUS_MOMENTS`, so `validate`
 * ACCEPTS `await:` there and `contextsFor` derives the awaited signal's own
 * name — the same derivation `pull-request` makes. What differs is the other
 * half: at `pull-request` that name is a required status check on the
 * generated base ruleset, so the promise is enforced. At a deploy moment
 * nothing consumes it. `lisa-run-gates.mjs` is the only executor those moments
 * have, and it classifies an awaited gate SKIPPED — "no signal exists locally"
 * — which does not fail the run. A gate declared `required` there therefore
 * reports green having proved nothing, and no surface compares the declaration
 * against anything, so nothing says so.
 *
 * That is why the third block below asserts a defect rather than a guarantee.
 * It is the recorded measurement, not an endorsement: when the gap is closed,
 * this block is what must change, and it names what a fix would have to do.
 *
 * Measured at 4.50.3 over the 41-gate registry: 28 gates are legal at `push`
 * and 0 of them accept `await:`; 39 are legal at `pre-deploy` and all 39
 * accept it. This repository declares nothing at any deploy-family moment, so
 * its own exposure today is zero and the whole of it is latent.
 * @module tests/unit/scripts/lisa-gates-await-moment-reach
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  contextsFor,
  momentFamily,
  REGISTRY,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS = path.join(REPO_ROOT, "all", "copy-overwrite", "scripts");
const RUN_GATES = path.join(SCRIPTS, "lisa-run-gates.mjs");
const LISA_CONFIG = ".lisa.config.json";
const TEMP_PREFIX = "lisa-await-reach-";

/** An external signal name no shipped registry entry can collide with. */
const SIGNAL = "Some External App";

/** The moments that run before there is a pull request to post against. */
const NO_STATUS = [
  "session-start",
  "pre-tool",
  "post-tool",
  "commit",
  "push",
] as const;

/** The deploy moment this repository would gate a production release on. */
const PRE_DEPLOY_PROD = "pre-deploy:production";

/** One moment from each family that takes an `:<environment>` suffix. */
const DEPLOY_FAMILY = [
  PRE_DEPLOY_PROD,
  "post-deploy:production",
  "continuous:staging",
] as const;

/** A deploy-moment gate that is legal at `pre-deploy` and needs no toolchain. */
const DEPLOY_GATE = "runtime-web-vulnerability";

/**
 * Every registry gate a declaration may legally name at one moment.
 * @param moment The moment key, environment suffix and all.
 * @returns Gate ids, in registry order.
 */
function gatesLegalAt(moment: string): string[] {
  const family = momentFamily(moment);
  return Object.entries(REGISTRY)
    .filter(([, definition]) => definition.moments.includes(family))
    .map(([id]) => id);
}

/**
 * The problems `validate` reports for one gate awaiting a signal at one moment.
 * @param id The gate id.
 * @param moment The moment key.
 * @returns The problem strings, empty when the declaration is accepted.
 */
function awaitProblems(id: string, moment: string): string[] {
  return validateGates({
    [id]: { [moment]: { level: "required", await: SIGNAL } },
  });
}

describe("an awaited signal is refused wherever nothing could post one", () => {
  it.each(NO_STATUS)(
    "refuses an await at %s for every gate legal there",
    moment => {
      const legal = gatesLegalAt(moment);
      // A moment with nothing legal at it would make the sweep below pass by
      // being empty, which is the shape of a control that stopped measuring.
      expect(legal.length).toBeGreaterThan(0);
      const accepted = legal.filter(
        id => awaitProblems(id, moment).length === 0
      );
      expect(accepted).toEqual([]);
    }
  );

  it("says why, naming the missing pull request rather than the gate", () => {
    // The wording carries the reason. An operator who reads only "invalid"
    // moves the declaration to another local moment and hits the same wall.
    expect(awaitProblems("dead-code", "push").join(" ")).toContain(
      "there is no pull request yet for a signal to post against"
    );
  });

  it("accepts the same declaration at pull-request", () => {
    // The negative control. Without it the sweep above would still pass if
    // `await:` had been refused everywhere, which would prove nothing about
    // where the refusal is targeted.
    expect(awaitProblems("code-review", "pull-request")).toEqual([]);
  });
});

describe("an awaited signal IS accepted at every deploy-family moment", () => {
  it.each(DEPLOY_FAMILY)(
    "accepts an await at %s for every legal gate",
    moment => {
      const legal = gatesLegalAt(moment);
      expect(legal.length).toBeGreaterThan(0);
      const refused = legal.filter(id => awaitProblems(id, moment).length > 0);
      expect(refused).toEqual([]);
    }
  );

  it("derives the awaited signal's own name there, as it does at merge", () => {
    // Both derivations agree, which is why #3609's defect has no counterpart
    // here. The exposure is downstream of the derivation, not inside it.
    const gates = {
      [DEPLOY_GATE]: {
        [PRE_DEPLOY_PROD]: { level: "required", await: SIGNAL },
      },
    };
    expect(
      contextsFor(gates, {
        moment: PRE_DEPLOY_PROD,
        workflowName: "\u{1F50D} Quality Checks",
      })
    ).toEqual([SIGNAL]);
  });
});

describe("a required awaited gate at a deploy moment proves nothing", () => {
  /**
   * Run the shipped runner against a throwaway config in its own directory.
   * @param moment The moment to run.
   * @returns The runner's stdout and exit status.
   */
  const runAt = (moment: string): { out: string; status: number | null } => {
    const dir = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    writeFileSync(
      path.join(dir, LISA_CONFIG),
      JSON.stringify({
        gates: {
          [DEPLOY_GATE]: { [moment]: { level: "required", await: SIGNAL } },
        },
      }),
      "utf8"
    );
    const result = boundedSpawnSync({
      label: `lisa-run-gates.mjs --moment=${moment}`,
      command: process.execPath,
      args: [RUN_GATES, `--moment=${moment}`],
      cwd: dir,
    });
    rmSync(dir, { recursive: true, force: true });
    return { out: `${result.stdout}${result.stderr}`, status: result.status };
  };

  // THIS BLOCK RECORDS A DEFECT, and the assertions are deliberately the
  // wrong-looking way round. A `required` gate that exits 0 without running is
  // the failure mode this whole subsystem exists to prevent; here it is the
  // measured behaviour at a moment no comparison surface watches. Closing the
  // gap — by refusing `await:` at the deploy families, or by giving those
  // moments a consumer for the awaited signal — is what should break these
  // three assertions, and breaking them is the point.
  it("classifies it SKIPPED rather than proved or failed", () => {
    expect(runAt(PRE_DEPLOY_PROD).out).toContain("SKIPPED");
  });

  it("says no signal exists locally, which is the whole gap in one line", () => {
    expect(runAt(PRE_DEPLOY_PROD).out).toContain(
      `awaits "${SIGNAL}"; no signal exists locally`
    );
  });

  it("exits green, so a release gated on this job is not held", () => {
    const { out, status } = runAt(PRE_DEPLOY_PROD);
    expect(status).toBe(0);
    expect(out).toContain("0 proved, 0 failed");
  });
});
