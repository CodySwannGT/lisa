/**
 * The ledger has to stay in step with the guards it vouches for.
 *
 * It is what lets refresh prove a host's copy is behind rather than assume it.
 * A guard edited without regenerating the ledger loses that proof for its own
 * newest bytes, and the failure is silent and in the safe direction — refresh
 * simply stops delivering that guard — which is exactly the shape of bug that
 * goes unnoticed for months. So it is gated here, the same way the upstream
 * evidence manifest is.
 * @module tests/unit/scripts/lisa-owned-hash-ledger
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LISA_OWNED_HASH_LEDGER } from "../../../src/core/lisa-owned-hash-ledger.js";
import { isLisaOwnedTemplate } from "../../../src/core/lisa-owned-templates.js";
import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// The first case shells out to a script that walks git history, so its cost is
// the machine's rather than the code's. Added to the roster on evidence, not on
// suspicion: it timed out at 60s inside a full `test:unit` run, then passed in
// isolation at 47.2s under the SAME conditions moments later — 68 sibling vitest
// processes, 1-minute load average 314 on 18 cores, node spawn latency 136.7ms
// against a quiet 18ms. 6.2s quiet-equivalent, which is where the margin guard
// judges it (CodySwannGT/lisa#2822).
useIoLatencyBudget();

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";

/**
 * Quiet-box liveness bound for the history walk — the ceiling, and it needs it.
 *
 * Measured on this repository, 18 cores, `ps aux | grep -c '[v]itest'` = 1 and
 * a 1-minute load average of 65, with the median of nine `node -e ""` spawns at
 * 56.7ms against the 18ms quiet figure (a 3.15x machine): three runs of
 * `generate-lisa-owned-hash-ledger.mjs --check` cost 42.7s / 57.0s / 71.2s.
 * Divided by the measured slowdown that is a 13.6-22.6s QUIET-equivalent child,
 * so the 15s default would kill a healthy run outright.
 *
 * The 8x clamp puts its worst case at 300,000ms. That was `testTimeout` when
 * this was written, and it no longer is — CodySwannGT/lisa#2892 re-measured the
 * flat per-case budget down to 120,000ms, which this base's worst case now
 * exceeds. What keeps the guarantee here is the `useIoLatencyBudget()` call
 * above: it replaces the flat budget with `IO_LATENCY_TEST_TIMEOUT_MS x the
 * same measured slowdown`, so the case has 60,000ms of quiet-box budget against
 * this child's 37,500ms and the child dies first at EVERY slowdown, the flat
 * number having dropped out of both sides. Spawning this walk from a suite that
 * does not scale its case budget would race that 120,000ms instead, from a
 * slowdown of 3.2x up — see `caseBudgetFailure` in the budget helper for
 * the relation, and CodySwannGT/lisa#3202 for what a stale citation of the
 * moved number costs. The walk's cost tracks clone depth and merge topology
 * rather than spawn latency, which is why it sits this close to its own bound;
 * treat a kill here as a signal to reduce the walk.
 */
const LEDGER_CHECK_BASE_MS = 37_500;

describe("Lisa-owned hash ledger", () => {
  it("records the bytes of every Lisa-owned template shipped right now", () => {
    // Asserted as coverage of the current artifacts, not as byte-equality with a
    // fresh regeneration. The stricter form looks safer and is not: the history
    // walk depends on clone depth and merge topology, so it failed in CI on a
    // correct ledger once `autoupdate` merged main in and the walk saw commits
    // the author's run never did.
    expect(() =>
      boundedExecFileSync({
        label: "generate-lisa-owned-hash-ledger.mjs --check",
        command: process.execPath,
        args: ["scripts/generate-lisa-owned-hash-ledger.mjs", "--check"],
        baseMs: LEDGER_CHECK_BASE_MS,
        cwd: path.resolve("."),
        stdio: "pipe",
      })
    ).not.toThrow();
  });

  it("vouches for the bytes Lisa ships right now", () => {
    // Without the current release in the ledger, a host running today's guard
    // would be classified as host-modified the moment the next release lands,
    // and would stop receiving refreshes for good.
    const shipped = createHash("sha256")
      .update(readFileSync(path.resolve("all/copy-overwrite", GUARD)))
      .digest("hex");

    expect(LISA_OWNED_HASH_LEDGER[GUARD]).toContain(shipped);
  });

  it("retains the earlier releases a lagging project may still be running", () => {
    // Append-only is the point: a host that has not upgraded in months holds
    // bytes from a release nobody remembers, and dropping that hash would
    // freeze its guard permanently.
    expect(LISA_OWNED_HASH_LEDGER[GUARD]?.length ?? 0).toBeGreaterThan(1);
  });

  it("enrols only the paths refresh actually acts on", () => {
    // The ledger's scope is inherited from the `lisa-` predicate that decides
    // which files refresh at all. Recording anything else would add a
    // regeneration gate to templates whose contents it can never influence.
    for (const destination of Object.keys(LISA_OWNED_HASH_LEDGER)) {
      expect(isLisaOwnedTemplate(destination)).toBe(true);
    }
  });

  it("records well-formed digests under forward-slash keys", () => {
    for (const [destination, hashes] of Object.entries(
      LISA_OWNED_HASH_LEDGER
    )) {
      expect(destination).not.toContain("\\");
      for (const hash of hashes) expect(hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
