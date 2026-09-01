/**
 * Fixture suite executed by a child vitest to prove the run root is removed.
 *
 * Not named `*.test.ts` on purpose: two of its three arms are designed to FAIL,
 * so the repository's own run must never collect it. The parent cases in
 * `tests/unit/config/scratch-run-root-teardown.test.ts` point a throwaway
 * vitest config at it, wire the real scratch setup file, and assert on what is
 * left in the namespace after the child has exited.
 *
 * ## Why a child process is the only honest instrument
 *
 * The mechanism under test is `process.once("exit", ...)` in
 * `src/configs/vitest/scratch-setup.ts`, and a handler that removes THIS
 * process's run root cannot be observed from inside this process — by the time
 * it runs there is nothing left to assert with. The globalSetup `teardown`
 * sweep cannot stand in for it either: `isReclaimable` returns false for a root
 * whose recorded pid is still alive, and during teardown this process is by
 * definition still alive, so the sweep deliberately spares exactly the root
 * this is about (CodySwannGT/lisa#2950).
 *
 * ## The arms
 *
 * `LISA_SCRATCH_TEARDOWN_ARM` selects one. All three must leave nothing behind,
 * because the criterion is "including when tests failed or timed out" — a
 * clause that was previously untested in both of its halves.
 *
 * Every arm creates a real scratch directory with a file in it first, so a
 * passing assertion means the whole tree went rather than that there was
 * nothing to remove.
 * @module tests/helpers/__fixtures__/scratch-teardown-case
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { SCRATCH_OWNER_FILE } from "../../../src/configs/vitest/scratch-owner.js";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  parseScratchSupervisionLease,
} from "../../../src/configs/vitest/scratch-supervision.js";

/** Which failure shape this child should end in. */
const ARM = process.env["LISA_SCRATCH_TEARDOWN_ARM"] ?? "pass";

/**
 * Leave a real directory, with real bytes in it, inside the run root.
 *
 * Without this the arms would pass over an empty root, which proves the root
 * was never used rather than that it was removed in its entirety.
 */
const leaveResidue = (): void => {
  const scratch = mkdtempSync(path.join(tmpdir(), "teardown-residue-"));
  writeFileSync(path.join(scratch, "residue.txt"), "left behind", "utf8");
};

/**
 * Make the suite root fail its identity check, from inside the run.
 *
 * `removeSupervisedWorkerScope` validates the suite root OUTSIDE its own
 * try/catch, so removing the owner marker makes both teardown handlers throw.
 * Unguarded, that throw becomes an uncaught exception in the `exit` listener
 * and rewrites this child's status -- which is exactly what the parent case
 * measures.
 */
const breakSuiteRoot = (): void => {
  const raw = process.env[SCRATCH_SUPERVISION_LEASE_ENV];
  if (raw === undefined || raw === "") return;
  const lease = parseScratchSupervisionLease(raw);
  rmSync(
    path.join(
      lease.namespace.canonicalPath,
      lease.suiteRootBasename,
      SCRATCH_OWNER_FILE
    ),
    { force: true }
  );
};

describe("scratch teardown fixture", () => {
  it("creates scratch space and then ends the way its arm says", async () => {
    leaveResidue();
    if (ARM === "suite-root-broken") {
      breakSuiteRoot();
      expect(ARM).toBe("suite-root-broken");
      return;
    }
    if (ARM === "fail") {
      expect(ARM, "the failing arm fails deliberately").toBe("pass");
      return;
    }
    if (ARM === "timeout") {
      await new Promise(() => {
        // Never resolves. The per-case budget below ends it, which is the
        // "timed out" half of the criterion — a shape that reaches the exit
        // handler by a different route than an ordinary failure.
      });
      return;
    }
    expect(ARM).toBe("pass");
  }, 500);
});
