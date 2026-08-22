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
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LISA_OWNED_HASH_LEDGER } from "../../../src/core/lisa-owned-hash-ledger.js";
import { isLisaOwnedTemplate } from "../../../src/core/lisa-owned-templates.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

// The first case shells out to a script that walks git history, so its cost is
// the machine's rather than the code's. Added to the roster on evidence, not on
// suspicion: it timed out at 60s inside a full `test:unit` run, then passed in
// isolation at 47.2s under the SAME conditions moments later — 68 sibling vitest
// processes, 1-minute load average 314 on 18 cores, node spawn latency 136.7ms
// against a quiet 18ms. 6.2s quiet-equivalent, which is where the margin guard
// judges it (CodySwannGT/lisa#2822).
useIoLatencyBudget();

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";

describe("Lisa-owned hash ledger", () => {
  it("records the bytes of every Lisa-owned template shipped right now", () => {
    // Asserted as coverage of the current artifacts, not as byte-equality with a
    // fresh regeneration. The stricter form looks safer and is not: the history
    // walk depends on clone depth and merge topology, so it failed in CI on a
    // correct ledger once `autoupdate` merged main in and the walk saw commits
    // the author's run never did.
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/generate-lisa-owned-hash-ledger.mjs", "--check"],
        { cwd: path.resolve("."), stdio: "pipe" }
      )
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
