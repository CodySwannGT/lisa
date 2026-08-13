/**
 * Contract tests for the secrets health checks.
 *
 * The two-store check is the one that earns its keep. A value present in both
 * the provider and a local copy is not a duplicate — it is two live
 * credentials, one of them untracked. Both authenticate, so the difference is
 * invisible from either side, and "tidying up the duplicate" deletes a working
 * credential that no record accounts for.
 * @module tests/unit/secrets/doctor-secrets
 */
import { describe, expect, it } from "vitest";

import {
  checkNaming,
  checkNotes,
  checkRequired,
  checkRotating,
  checkTwoStores,
  collector,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/doctor-secrets.mjs";

/**
 * Build a provider view from plain entries, defaulting note and identifier.
 * @param entries Secret entries by exact name.
 * @returns The provider view the checks consume.
 */
const providerView = (
  entries: Record<string, { value: string; note?: string; id?: string | null }>
): Map<string, object> =>
  new Map(
    Object.entries(entries).map(([k, v]) => [
      k,
      { note: "", id: `id-${k}`, ...v },
    ])
  );

/**
 * Run a body with one environment variable set, restoring what was there.
 *
 * Restores rather than deletes: these tests share one process environment with
 * every other test in the run, so unconditionally deleting a name would quietly
 * clear a value something else had set and depended on.
 * @param name Variable to set for the duration of the body.
 * @param value Value to set it to.
 * @param body What to run while it is set.
 */
const withEnv = (name: string, value: string, body: () => void): void => {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
};

describe("required-name assertion", () => {
  it("passes a name the provider supplies", () => {
    const { findings, report } = collector();
    checkRequired(
      { require: ["A_KEY"] },
      providerView({ A_KEY: { value: "v" } }),
      new Map(),
      report
    );
    expect(findings[0].level).toBe("ok");
  });

  it("errors on a declared name that resolves nowhere", () => {
    // Declaring a name asserts the project needs it; an unresolvable one is a
    // startup error rather than a late surprise.
    const { findings, report } = collector();
    checkRequired({ require: ["ABSENT"] }, new Map(), new Map(), report);
    expect(findings[0].level).toBe("error");
  });

  it("does not call a proxy placeholder resolved", () => {
    // The variable is present and non-empty, which is exactly what makes it
    // dangerous: a presence check passes while any consumer reading the
    // variable itself receives the placeholder instead of a credential.
    withEnv("PROXIED_TOKEN", "proxy-injected", () => {
      const { findings, report } = collector();
      checkRequired(
        { require: ["PROXIED_TOKEN"] },
        new Map(),
        new Map(),
        report
      );
      expect(findings[0].level).toBe("warn");
      expect(findings[0].message).toMatch(/substituted at egress/i);
    });
  });

  it("still resolves a real value that merely looks ordinary", () => {
    withEnv("REAL_TOKEN", "an-actual-value", () => {
      const { findings, report } = collector();
      checkRequired({ require: ["REAL_TOKEN"] }, new Map(), new Map(), report);
      expect(findings[0].level).toBe("ok");
    });
  });

  it("accepts a name satisfied only by the materialized file", () => {
    const { findings, report } = collector();
    checkRequired(
      { require: ["FILE_ONLY"] },
      new Map(),
      new Map([["FILE_ONLY", "v"]]),
      report
    );
    expect(findings[0].level).toBe("ok");
  });
});

describe("naming assertion", () => {
  it("warns on a key that is not UPPER_SNAKE_CASE", () => {
    // Lookup is exact and never fuzzy, so `attio-prod` will simply never
    // resolve for ATTIO_API_KEY.
    const { findings, report } = collector();
    checkNaming(providerView({ "attio-prod": { value: "v" } }), report);
    expect(findings[0].level).toBe("warn");
  });

  it("stays quiet on a conforming key", () => {
    const { findings, report } = collector();
    checkNaming(providerView({ ATTIO_API_KEY: { value: "v" } }), report);
    expect(findings).toHaveLength(0);
  });
});

describe("note assertion", () => {
  it("blocks on an empty note", () => {
    // The contract has always said the note "must exist and be well-formed",
    // enforced statically by doctor. A warning does not enforce anything: a
    // vault full of empty notes reported clean, which is how the notes stayed
    // empty.
    const { findings, report } = collector();
    checkNotes(providerView({ A_KEY: { value: "v", note: "" } }), report);
    expect(findings[0].level).toBe("error");
    expect(findings[0].name).toBe("A_KEY");
  });

  it("blocks on a missing note", () => {
    const { findings, report } = collector();
    checkNotes(providerView({ A_KEY: { value: "v" } }), report);
    expect(findings[0].level).toBe("error");
  });

  it("accepts a note in the documented shape", () => {
    const { findings, report } = collector();
    checkNotes(
      providerView({
        A_KEY: { value: "v", note: "Attio CRM.\nowner: platform-team" },
      }),
      report
    );
    expect(findings).toHaveLength(0);
  });

  it("blocks a note with no plain-language purpose", () => {
    const { findings, report } = collector();
    checkNotes(
      providerView({ A_KEY: { value: "v", note: "owner: platform-team" } }),
      report
    );
    expect(findings[0].level).toBe("error");
    expect(findings[0].message).toMatch(/first line/i);
  });

  it("blocks a malformed tool line", () => {
    const { findings, report } = collector();
    checkNotes(
      providerView({
        A_KEY: { value: "v", note: "A token.\ntool: sonar (for CI)" },
      }),
      report
    );
    expect(findings[0].level).toBe("error");
    expect(findings[0].message).toContain("sonar (for CI)");
  });

  it("warns without blocking on a stray separator in a tool line", () => {
    const { findings, report } = collector();
    checkNotes(
      providerView({ A_KEY: { value: "v", note: "A token.\ntools: sonar," } }),
      report
    );
    expect(findings[0].level).toBe("warn");
  });

  it("attributes every defect to the secret that carries it", () => {
    // Doctor prints one line per finding, and a finding with no name is a
    // report the operator cannot act on.
    const { findings, report } = collector();
    checkNotes(
      providerView({
        A_KEY: { value: "v", note: "" },
        B_KEY: { value: "v", note: "Fine.\nscope:" },
      }),
      report
    );
    expect(
      findings.map(f => f.name).sort((a, b) => a.localeCompare(b))
    ).toEqual(["A_KEY", "B_KEY"]);
  });
});

describe("rotation readiness", () => {
  it("errors when a rotating credential has no bootstrap to write back with", () => {
    // This is the original incident: a job wired into a lane with no write
    // path would rotate the token and fail to persist the replacement.
    const { findings, report } = collector();
    checkRotating(
      { rotating: ["TOKEN"], bootstrap: { key: null } },
      providerView({ TOKEN: { value: "v" } }),
      report
    );
    expect(findings[0].level).toBe("error");
    expect(findings[0].message).toMatch(/strand/i);
  });

  it("errors when there is no provider identifier to write to", () => {
    const { findings, report } = collector();
    checkRotating(
      { rotating: ["TOKEN"], bootstrap: { key: "BOOT" } },
      providerView({ TOKEN: { value: "v", id: null } }),
      report
    );
    expect(findings[0].level).toBe("error");
  });

  it("passes when both a bootstrap and an identifier exist", () => {
    const { findings, report } = collector();
    checkRotating(
      { rotating: ["TOKEN"], bootstrap: { key: "BOOT" } },
      providerView({ TOKEN: { value: "v" } }),
      report
    );
    expect(findings[0].level).toBe("ok");
  });
});

describe("two-store detection", () => {
  it("errors when the two copies differ, naming them two live credentials", () => {
    const { findings, report } = collector();
    checkTwoStores(
      providerView({ APOLLO_API_KEY: { value: "provider-value" } }),
      new Map([["APOLLO_API_KEY", "local-value"]]),
      report
    );
    expect(findings[0].level).toBe("error");
    expect(findings[0].message).toMatch(/TWO LIVE CREDENTIALS/);
    expect(findings[0].message).toMatch(/stop and ask/i);
  });

  it("compares by digest, never exposing either value", () => {
    const { findings, report } = collector();
    checkTwoStores(
      providerView({ K: { value: "provider-secret-value" } }),
      new Map([["K", "local-secret-value"]]),
      report
    );
    expect(findings[0].message).not.toContain("provider-secret-value");
    expect(findings[0].message).not.toContain("local-secret-value");
  });

  it("warns rather than errors when the copies still match", () => {
    // Same value today, but two stores drift — that is the whole reason the
    // single-store rule exists.
    const { findings, report } = collector();
    checkTwoStores(
      providerView({ K: { value: "same" } }),
      new Map([["K", "same"]]),
      report
    );
    expect(findings[0].level).toBe("warn");
  });

  it("says nothing about a secret that lives in only one store", () => {
    const { findings, report } = collector();
    checkTwoStores(
      providerView({ ONLY_PROVIDER: { value: "v" } }),
      new Map([["ONLY_FILE", "v"]]),
      report
    );
    expect(findings).toHaveLength(0);
  });
});
