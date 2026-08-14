/**
 * Refresh must be able to say which side is ahead — and be wrong in neither
 * direction.
 *
 * Both arms are asserted deliberately. A suite that only proves "a stronger host
 * copy survives" is satisfied by a classifier that never overwrites anything,
 * which is a different broken tool: drift would accumulate forever and released
 * security fixes would stop reaching the fleet, which is the defect #2436 was
 * built to fix. A suite that only proves "a stale copy is replaced" is satisfied
 * by the byte comparison that caused this ticket. Only both together pin the
 * behaviour.
 * @module tests/unit/core/lisa-owned-provenance
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  classifyHostCopy,
  describePreserved,
  mayRefreshLisaOwned,
} from "../../../src/core/lisa-owned-provenance.js";
import type { HashLedger } from "../../../src/core/lisa-owned-provenance.js";

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";
const HOST_AHEAD = "host-ahead";
const GIT_CONFIG_KEY = "git-config-key";

/** A guard declaring the vectors upstream currently closes. */
const LISA_GUARD = Buffer.from(
  "#!/usr/bin/env bash\n# lisa-guard-capabilities: no-verify-abbrev, husky-env\necho lisa\n"
);

/** The same guard with one extra vector closed downstream. */
const HARDENED_GUARD = Buffer.from(
  "#!/usr/bin/env bash\n# lisa-guard-capabilities: no-verify-abbrev, husky-env, git-config-key\necho hardened\n"
);

/**
 * Build a ledger asserting that Lisa really shipped these exact bytes.
 * @param entries - Destination path to the contents Lisa published there
 * @returns A hash ledger for injection
 */
function ledgerOf(entries: Record<string, readonly Buffer[]>): HashLedger {
  return Object.fromEntries(
    Object.entries(entries).map(([destination, contents]) => [
      destination,
      contents.map(content =>
        createHash("sha256").update(content).digest("hex")
      ),
    ])
  );
}

describe("classifyHostCopy: which copy is ahead", () => {
  it("overwrites a host copy whose bytes are a known past Lisa release", () => {
    const oldRelease = Buffer.from("#!/usr/bin/env bash\n# old lisa\n");
    const verdict = classifyHostCopy(
      GUARD,
      oldRelease,
      LISA_GUARD,
      ledgerOf({ [GUARD]: [oldRelease, LISA_GUARD] })
    );

    expect(verdict).toEqual({ kind: "provably-stale" });
    expect(mayRefreshLisaOwned(verdict)).toBe(true);
  });

  it("preserves a host copy whose bytes match no Lisa release", () => {
    const verdict = classifyHostCopy(
      GUARD,
      Buffer.from("#!/usr/bin/env bash\n# hand-hardened, undeclared\n"),
      LISA_GUARD,
      ledgerOf({ [GUARD]: [LISA_GUARD] })
    );

    expect(verdict).toEqual({ kind: "host-modified" });
    expect(mayRefreshLisaOwned(verdict)).toBe(false);
  });

  it("preserves a host copy declaring a capability Lisa lacks", () => {
    const verdict = classifyHostCopy(
      GUARD,
      HARDENED_GUARD,
      LISA_GUARD,
      ledgerOf({ [GUARD]: [LISA_GUARD] })
    );

    expect(verdict).toEqual({
      kind: HOST_AHEAD,
      extraCapabilities: [GIT_CONFIG_KEY],
    });
    expect(mayRefreshLisaOwned(verdict)).toBe(false);
  });

  it("preserves a host copy hardening a different vector than Lisa did", () => {
    // Neither set contains the other. A strict-superset test would call this
    // "not ahead" and overwrite, deleting the host's vector — the exact case
    // that ruled out a single monotonic version number.
    const lisaOther = Buffer.from(
      "# lisa-guard-capabilities: no-verify-abbrev, config-env\n"
    );
    const hostOther = Buffer.from(
      "# lisa-guard-capabilities: no-verify-abbrev, git-config-key\n"
    );

    const verdict = classifyHostCopy(GUARD, hostOther, lisaOther, {});

    expect(verdict).toEqual({
      kind: HOST_AHEAD,
      extraCapabilities: [GIT_CONFIG_KEY],
    });
  });

  it("resumes overwriting once Lisa declares everything the host declared", () => {
    // The release valve. Without it a host-modified file is preserved forever
    // and genuine drift never gets fixed.
    const absorbed = Buffer.from(
      "#!/usr/bin/env bash\n# lisa-guard-capabilities: no-verify-abbrev, husky-env, git-config-key\necho upstream\n"
    );

    const verdict = classifyHostCopy(GUARD, HARDENED_GUARD, absorbed, {});

    expect(verdict).toEqual({ kind: "absorbed-upstream" });
    expect(mayRefreshLisaOwned(verdict)).toBe(true);
  });

  it("reports identical copies without consulting the ledger", () => {
    const verdict = classifyHostCopy(GUARD, LISA_GUARD, LISA_GUARD, {});

    expect(verdict).toEqual({ kind: "identical" });
    expect(mayRefreshLisaOwned(verdict)).toBe(true);
  });

  it("leaves an artifact with no ledger entry behaving as it did before", () => {
    const verdict = classifyHostCopy(
      "scripts/lisa-hooks/not-yet-enrolled.sh",
      Buffer.from("host\n"),
      Buffer.from("lisa\n"),
      ledgerOf({ [GUARD]: [LISA_GUARD] })
    );

    expect(verdict).toEqual({ kind: "unenrolled" });
    expect(mayRefreshLisaOwned(verdict)).toBe(true);
  });

  it("matches ledger entries for a Windows-separated destination path", () => {
    const oldRelease = Buffer.from("# old\n");
    const verdict = classifyHostCopy(
      "scripts\\lisa-hooks\\block-no-verify.sh",
      oldRelease,
      LISA_GUARD,
      ledgerOf({ [GUARD]: [oldRelease] })
    );

    expect(verdict).toEqual({ kind: "provably-stale" });
  });

  it("ignores a capability marker outside the header window", () => {
    // A guard that greps for the marker string, or a fixture quoting one, must
    // not thereby be read as declaring it.
    const body = Buffer.concat([
      Buffer.from(`#!/usr/bin/env bash\n${"# padding\n".repeat(600)}`),
      Buffer.from("# lisa-guard-capabilities: smuggled-in\n"),
    ]);

    const verdict = classifyHostCopy(GUARD, body, LISA_GUARD, {});

    expect(verdict).toEqual({ kind: "unenrolled" });
  });
});

describe("describePreserved: what the operator is told", () => {
  it("names the capabilities that would have been lost", () => {
    const message = describePreserved(GUARD, {
      kind: HOST_AHEAD,
      extraCapabilities: ["git-config-key", "hookspath-allowlist"],
    });

    expect(message).toContain(GUARD);
    expect(message).toContain(GIT_CONFIG_KEY);
    expect(message).toContain("hookspath-allowlist");
    expect(message).toContain("Kept yours");
  });

  it("tells an operator of an undeclared edit how to end the standoff", () => {
    const message = describePreserved(GUARD, { kind: "host-modified" });

    expect(message).toContain(GUARD);
    expect(message).toContain("lisa-guard-capabilities:");
    expect(message).toContain("Kept yours");
  });
});
