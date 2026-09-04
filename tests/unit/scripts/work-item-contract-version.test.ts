/**
 * The version handshake that lets the traceability gate's two halves tell how
 * far apart they are.
 *
 * `quality.yml` / `quality-rails.yml` travel by git ref at `@main` and are live
 * in every consumer on their next run; `scripts/lisa-work-item.mjs` travels on
 * the `lisa apply` channel and is live only where somebody applied.
 * `scripts/two-channel-couplings.json` registers that skew for this exact pair,
 * twice — and reasons only about the script being ABSENT, which is the benign
 * case: an absent script skips and posts no context.
 *
 * The harmful case is present-and-old, and before this handshake the workflow's
 * only staleness signal was probing for the `verify-level` subcommand. That is a
 * single hardcoded floor at #2721: below it a copy is caught, above it a copy is
 * indistinguishable from current no matter how old. Measured on the real files,
 * a copy from 2026-08-18 — a major behind, running trailer logic that had
 * already been superseded — satisfied that probe in silence while sitting behind
 * a REQUIRED check (#3477).
 *
 * A capability probe can only ever answer "older than the one thing I know to
 * ask for". These cases pin the thing that answers "how old" instead.
 */
import { describe, expect, it } from "vitest";

import { WORK_ITEM_CONTRACT_VERSION } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  cleanupFixtures,
  cli,
  createFixture,
} from "../../support/work-item-cli.js";

const SUBCOMMAND = "contract-version";

describe("work-item gate contract version", () => {
  it("is a three-part semantic version", () => {
    expect(WORK_ITEM_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("is major 1, which the shipped workflows expect", () => {
    expect(WORK_ITEM_CONTRACT_VERSION.split(".")[0]).toBe("1");
  });

  it("the contract-version subcommand prints exactly the exported constant", () => {
    const fixture = createFixture();
    const outcome = cli(fixture, [SUBCOMMAND]);
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.stdout).toBe(WORK_ITEM_CONTRACT_VERSION);
    cleanupFixtures();
  });

  /**
   * The property that makes it usable as a staleness probe at all. Every other
   * subcommand resolves the tracker contract and refuses without one, so a
   * handshake built on any of them would report "unknown" in exactly the
   * projects whose vintage most needs reporting — a half-onboarded repo, or one
   * whose config the stale script itself cannot parse.
   */
  it("answers with no tracker configured", () => {
    const fixture = createFixture({});
    const outcome = cli(fixture, [SUBCOMMAND]);
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.stdout).toBe(WORK_ITEM_CONTRACT_VERSION);
    cleanupFixtures();
  });

  /**
   * The workflow distinguishes "this copy predates the handshake" from "this
   * copy is broken" by grepping the validator's own usage text, which is what an
   * unknown subcommand produces. That is the same signature the #2721 probe
   * relies on, so the subcommand must appear in the usage line — otherwise a
   * current copy advertises a command it accepts nowhere a reader can see it.
   */
  it("is advertised in the usage text the workflow greps for", () => {
    const fixture = createFixture();
    const outcome = cli(fixture, ["definitely-not-a-subcommand"]);
    expect(outcome.stderr).toContain("Usage: lisa-work-item.mjs");
    expect(outcome.stderr).toContain(SUBCOMMAND);
    cleanupFixtures();
  });

  /**
   * `verify-level` is not replaced by the handshake, it is complemented by it.
   * The workflow still needs the level to decide whether a missing tracker
   * credential is a problem, and a copy old enough to lack `contract-version`
   * may still answer this one.
   */
  it("does not disturb the verify-level probe beside it", () => {
    const fixture = createFixture();
    const outcome = cli(fixture, ["verify-level"]);
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.stdout.trim().length).toBeGreaterThan(0);
    cleanupFixtures();
  });
});
