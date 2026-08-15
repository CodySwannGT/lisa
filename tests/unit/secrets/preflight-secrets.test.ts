/**
 * Tests for the session-start secrets preflight.
 *
 * The load-bearing assertions are the ones about `unreachable`. A provider that
 * cannot be asked must never report `ok` — that is the vacuous green this check
 * exists to prevent — and must never report `missing`, which would send an
 * operator to grant a credential that was never absent.
 * @module tests/unit/secrets/preflight-secrets
 */

import { describe, expect, it } from "vitest";

import {
  preflight,
  report,
  requiredNames,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/preflight-secrets.mjs";

/**
 * Build a resolved config shaped like `readConfig` output.
 * @param over - Fields to override on the baseline config
 * @returns A config object accepted by `preflight`
 */
const config = (over = {}) => ({
  provider: "bitwarden",
  surface: "local",
  require: null,
  requiredFloor: [],
  routing: {},
  ...over,
});

/**
 * Build a provider view holding the given names with non-empty values.
 * @param names - Credential names the grant should contain
 * @returns A provider map keyed by credential name
 */
const grant = (...names: string[]) =>
  new Map(names.map(name => [name, { value: `value-of-${name}`, note: "n" }]));

const noFile = () => new Map();

/** Repeated across assertions; hoisted so each literal appears once. */
const GH_TOKEN = "GH_TOKEN";
const TRACKER_GITHUB = 'tracker is "github"';
const NO_PROVIDER = "provider must not be consulted";
const NO_BOOTSTRAP = "Missing access token";

describe("requiredNames", () => {
  it("unions the routing floor with declared extras", () => {
    const names = requiredNames(
      config({
        requiredFloor: [GH_TOKEN],
        routing: { tracker: "github" },
        require: ["ATTIO_API_KEY"],
      })
    );
    expect(names.map(entry => entry.name)).toEqual([
      "ATTIO_API_KEY",
      "GH_TOKEN",
    ]);
  });

  it("explains why each name is required", () => {
    const names = requiredNames(
      config({
        requiredFloor: [GH_TOKEN],
        routing: { tracker: "github" },
        require: ["GH_TOKEN"],
      })
    );
    expect(names[0]?.reasons).toEqual([
      TRACKER_GITHUB,
      "declared in secrets.require",
    ]);
  });

  it("is empty when nothing is routed or declared", () => {
    expect(requiredNames(config())).toEqual([]);
  });
});

describe("preflight", () => {
  it("passes when nothing is required", () => {
    const result = preflight(config(), () => grant(), noFile, {});
    expect(result.verdict).toBe("ok");
  });

  it("passes when a required name is in the provider grant", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => grant(GH_TOKEN),
      noFile,
      {}
    );
    expect(result.verdict).toBe("ok");
    expect(result.missing).toEqual([]);
  });

  it("fails with `missing` when a required name resolves nowhere", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN], routing: { tracker: "github" } }),
      () => grant("SOMETHING_ELSE"),
      noFile,
      {},
      () => false
    );
    expect(result.verdict).toBe("missing");
    expect(result.missing.map(entry => entry.name)).toEqual([GH_TOKEN]);
  });

  it("treats an environment variable as resolving the requirement", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => {
        throw new Error(NO_PROVIDER);
      },
      noFile,
      { [GH_TOKEN]: "ghp_live" }
    );
    expect(result.verdict).toBe("ok");
  });

  it("does not count a blank environment variable as present", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => grant(),
      noFile,
      { [GH_TOKEN]: "   " },
      () => false
    );
    expect(result.verdict).toBe("missing");
  });

  it("accepts a materialized value without calling the provider", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => {
        throw new Error(NO_PROVIDER);
      },
      () => new Map([[GH_TOKEN, "ghp_from_disk"]]),
      {}
    );
    expect(result.verdict).toBe("ok");
  });

  it("reports `unreachable`, never `ok`, when the provider throws", () => {
    // The vacuous-green guard: learning nothing must not read as fine.
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => {
        throw new Error(NO_BOOTSTRAP);
      },
      noFile,
      {},
      () => false
    );
    expect(result.verdict).toBe("unreachable");
    expect(result.verdict).not.toBe("ok");
    expect(result.reason).toBe(NO_BOOTSTRAP);
  });

  it("reports `unreachable`, never `missing`, when the provider throws", () => {
    // Blaming the vault for a fault in this machine's access sends the
    // operator to grant a credential that was never absent.
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => {
        throw new Error("bws: command not found");
      },
      noFile,
      {},
      () => false
    );
    expect(result.verdict).not.toBe("missing");
    expect(result.verdict).toBe("unreachable");
  });

  it("survives an unreadable materialized file and still consults the provider", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => grant(GH_TOKEN),
      () => {
        throw new Error("EACCES");
      },
      {},
      () => false
    );
    expect(result.verdict).toBe("ok");
  });

  it("accepts an alternative substrate instead of the variable", () => {
    // A developer laptop drives every GitHub operation Lisa performs with
    // GH_TOKEN unset, because `gh` authenticates from its own keyring. Failing
    // that session would fire the check when nothing is wrong.
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN], routing: { tracker: "github" } }),
      () => {
        throw new Error(NO_PROVIDER);
      },
      noFile,
      {},
      () => true
    );
    expect(result.verdict).toBe("ok");
  });

  it("falls through to the provider when the substrate probe fails", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => grant(GH_TOKEN),
      noFile,
      {},
      () => false
    );
    expect(result.verdict).toBe("ok");
  });

  it("still reports missing when neither substrate nor provider has it", () => {
    const result = preflight(
      config({ requiredFloor: [GH_TOKEN] }),
      () => grant(),
      noFile,
      {},
      () => false
    );
    expect(result.verdict).toBe("missing");
  });

  it("does not probe a credential that has no alternative substrate", () => {
    let probed = false;
    preflight(
      config({ require: ["ATTIO_API_KEY"] }),
      () => grant("ATTIO_API_KEY"),
      noFile,
      {},
      () => {
        probed = true;
        return true;
      }
    );
    expect(probed).toBe(false);
  });

  it("does not consult the provider when nothing is required", () => {
    let called = false;
    preflight(
      config(),
      () => {
        called = true;
        return grant();
      },
      noFile,
      {}
    );
    expect(called).toBe(false);
  });
});

describe("report", () => {
  it("says nothing when the verdict is ok", () => {
    expect(report({ verdict: "ok", required: [], missing: [] }, config())).toBe(
      ""
    );
  });

  it("tells a missing verdict to extend the vault grant", () => {
    const text = report(
      {
        verdict: "missing",
        required: [],
        missing: [{ name: GH_TOKEN, reasons: [TRACKER_GITHUB] }],
      },
      config()
    );
    expect(text).toContain(GH_TOKEN);
    expect(text).toContain(TRACKER_GITHUB);
    expect(text).toContain("Extend the grant in the vault");
    expect(text).toContain("blocked");
  });

  it("tells an unreachable verdict to fix access, and says nothing is known", () => {
    const text = report(
      {
        verdict: "unreachable",
        required: [],
        missing: [{ name: GH_TOKEN, reasons: ["declared"] }],
        reason: NO_BOOTSTRAP,
      },
      config()
    );
    expect(text).toContain("nothing is");
    expect(text).toContain("not a report that they are fine");
    expect(text).toContain(NO_BOOTSTRAP);
    expect(text).not.toContain("Extend the grant in the vault");
  });
});
