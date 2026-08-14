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

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";

describe("Lisa-owned hash ledger", () => {
  it("is regenerated whenever a Lisa-owned template changes", () => {
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
