/**
 * Unit tests for scripts/plugin-routing-validate.mjs (issue #1059, #12).
 *
 * Proves the routing-artifact gate: end-to-end exit codes against committed
 * fixtures, the pure `validateArtifact` schema/anti-pattern gates, the version
 * contract, and `cacheMaxVersion` resolution. Per the Test Isolation house rule,
 * expected values are HARDCODED (assertions never call the function under test
 * to compute an expectation).
 *
 * Shared fixtures/constants/helpers live in ./plugin-routing-validate-helpers.
 *
 * @module tests/unit/scripts/plugin-routing-validate
 */
import { describe, expect, it } from "vitest";
import {
  cacheMaxVersion,
  validateArtifact,
} from "../../../scripts/plugin-routing-validate.mjs";
import type { Artifact } from "./plugin-routing-validate-helpers";
import {
  ABSENT_DIR,
  baseArtifact,
  baseContext,
  CACHE_FLAG,
  DEMO_MKT,
  FIXTURE_CACHE,
  INVALID_DIR,
  multiKind,
  PLUGIN_NAME,
  ROUTING_DIR_FLAG,
  runValidate,
  VALID_DIR,
} from "./plugin-routing-validate-helpers";

/**
 * Validate a base artifact after applying `mutate`, returning the error list.
 *
 * @param mutate - a function that trips a single gate.
 * @returns The validation error messages.
 */
const errsWith = (mutate: (a: Artifact) => void): readonly string[] => {
  const artifact = baseArtifact();
  mutate(artifact);
  return validateArtifact(artifact, baseContext());
};

const has = (errors: readonly string[], substring: string): boolean =>
  errors.some(e => e.includes(substring));

describe("plugin-routing-validate end-to-end", () => {
  it("exits 0 for a valid artifact set", () => {
    const { code, report } = runValidate([
      ROUTING_DIR_FLAG,
      VALID_DIR,
      CACHE_FLAG,
      FIXTURE_CACHE,
      "--json",
    ]);
    expect(code).toBe(0);
    expect(report.summary).toEqual({ scanned: 1, valid: 1, invalid: 0 });
  });

  it("exits 1 and reports the bad outcome for an invalid artifact", () => {
    const { code, report } = runValidate([
      ROUTING_DIR_FLAG,
      INVALID_DIR,
      CACHE_FLAG,
      FIXTURE_CACHE,
      "--json",
    ]);
    expect(code).toBe(1);
    expect(report.summary).toEqual({ scanned: 1, valid: 0, invalid: 1 });
    expect(has(report.results[0]?.errors ?? [], "outcome invalid")).toBe(true);
  });

  it("exits 2 on a usage error (unknown flag / absent dir / missing value)", () => {
    expect(runValidate(["--bogus"]).code).toBe(2);
    expect(runValidate([ROUTING_DIR_FLAG, ABSENT_DIR]).code).toBe(2);
    expect(
      runValidate([ROUTING_DIR_FLAG, CACHE_FLAG, FIXTURE_CACHE]).code
    ).toBe(2);
  });

  it("returns a well-formed empty report when stdout is empty (exit 2 path)", () => {
    // When the script exits with code 2, it writes nothing to stdout.
    // runValidate must return a RoutingReport-shaped object, not bare {}.
    const { code, report } = runValidate(["--bogus"]);
    expect(code).toBe(2);
    expect(report.schemaVersion).toBe(1);
    expect(report.summary).toEqual({ scanned: 0, valid: 0, invalid: 0 });
    expect(report.results).toEqual([]);
  });
});

describe("validateArtifact schema gates", () => {
  it("accepts a fully valid artifact", () => {
    expect(validateArtifact(baseArtifact(), baseContext())).toEqual([]);
  });

  it("rejects a non-object artifact", () => {
    expect(validateArtifact(null, baseContext())).toHaveLength(1);
  });

  it("flags a wrong schemaVersion", () => {
    expect(
      has(
        errsWith(a => (a.schemaVersion = 2)),
        "schemaVersion"
      )
    ).toBe(true);
  });

  it("flags a status outside proposed|approved", () => {
    expect(
      has(
        errsWith(a => (a.status = "draft")),
        "status must be"
      )
    ).toBe(true);
  });

  it("accepts both proposed and approved statuses", () => {
    expect(errsWith(a => (a.status = "approved"))).toEqual([]);
  });

  it("flags a plugin id that is not pluginName@marketplace", () => {
    expect(
      has(
        errsWith(a => (a.plugin = "mismatch@x")),
        "pluginName@marketplace"
      )
    ).toBe(true);
  });

  it("flags a filename that does not match the plugin id", () => {
    const artifact = baseArtifact();
    expect(
      has(
        validateArtifact(artifact, {
          ...baseContext(),
          filename: "other.json",
        }),
        "filename must equal"
      )
    ).toBe(true);
  });

  it("flags empty components", () => {
    expect(
      has(
        errsWith(a => (a.components = [])),
        "components"
      )
    ).toBe(true);
  });

  it("flags a bad component kind / classification / missing id-path", () => {
    const errors = errsWith(a => {
      a.components = [
        { kind: "bogus", classification: "nope", id: "", path: "" },
      ];
    });
    expect(has(errors, "component kind invalid")).toBe(true);
    expect(has(errors, "classification invalid")).toBe(true);
    expect(has(errors, "non-empty id and path")).toBe(true);
  });

  it("flags a paired .md companion that is missing", () => {
    const errors = validateArtifact(baseArtifact(), {
      ...baseContext(),
      mdExists: false,
    });
    expect(has(errors, "paired .md")).toBe(true);
  });
});

describe("validateArtifact routing gates", () => {
  it("flags a missing agent key", () => {
    expect(
      has(
        errsWith(a => {
          delete a.routing.copilot;
        }),
        "exactly agy,codex,copilot,cursor"
      )
    ).toBe(true);
  });

  it("flags an outcome outside the locked enum", () => {
    expect(
      has(
        errsWith(a => (a.routing.codex.outcome = "frobnicate")),
        "outcome invalid"
      )
    ).toBe(true);
  });

  it("flags a non-array actions and an empty rationale", () => {
    const errors = errsWith(a => {
      a.routing.cursor.actions = "nope";
      a.routing.cursor.rationale = "";
    });
    expect(has(errors, "actions must be an array")).toBe(true);
    expect(has(errors, "rationale must be a non-empty string")).toBe(true);
  });

  it("flags an @unknown unparseable pin in an action", () => {
    expect(
      has(
        errsWith(
          a => (a.routing.codex.actions = ["emit foo@unknown into codex"])
        ),
        "@unknown pin"
      )
    ).toBe(true);
  });

  it('flags a "not addressed" cop-out action', () => {
    expect(
      has(
        errsWith(
          a => (a.routing.agy.actions = ["component not addressed for agy"])
        ),
        "not addressed"
      )
    ).toBe(true);
  });

  it("flags a reimplement missing the synced-from stamp (semver upstream)", () => {
    expect(
      has(
        errsWith(a => (a.routing.codex.actions = ["scaffold a skill"])),
        "must include the stamp"
      )
    ).toBe(true);
  });

  it("does not require a stamp when upstreamVersion is unknown", () => {
    const errors = validateArtifact(
      (() => {
        const a = baseArtifact();
        a.upstreamVersion = "unknown";
        a.routing.codex.actions = [
          "scaffold a skill (no pin: upstream unknown)",
        ];
        a.routing.agy.actions = ["scaffold a skill (no pin: upstream unknown)"];
        return a;
      })(),
      { ...baseContext(), cacheMax: null }
    );
    expect(has(errors, "must include the stamp")).toBe(false);
  });
});

describe("validateArtifact version contract", () => {
  it('accepts "unknown" only when the cache has no semver', () => {
    const artifact = baseArtifact();
    artifact.upstreamVersion = "unknown";
    expect(
      validateArtifact(artifact, { ...baseContext(), cacheMax: null })
    ).toEqual([]);
  });

  it('flags "unknown" when the cache has a semver', () => {
    const artifact = baseArtifact();
    artifact.upstreamVersion = "unknown";
    expect(
      has(
        validateArtifact(artifact, { ...baseContext(), cacheMax: "1.2.3" }),
        "cache has semver"
      )
    ).toBe(true);
  });

  it("flags a semver upstream that disagrees with the cache max", () => {
    expect(
      has(
        validateArtifact(baseArtifact(), {
          ...baseContext(),
          cacheMax: "9.9.9",
        }),
        "!= cache max"
      )
    ).toBe(true);
  });

  it("flags a semver upstream with no semver in the cache", () => {
    expect(
      has(
        validateArtifact(baseArtifact(), { ...baseContext(), cacheMax: null }),
        "no semver in the cache"
      )
    ).toBe(true);
  });

  it("flags an upstreamVersion that is neither semver nor unknown", () => {
    expect(
      has(
        errsWith(a => (a.upstreamVersion = "v1")),
        'semver or "unknown"'
      )
    ).toBe(true);
  });
});

describe("cacheMaxVersion", () => {
  it("picks the max manifest semver across sibling version dirs", () => {
    expect(cacheMaxVersion(FIXTURE_CACHE, PLUGIN_NAME, DEMO_MKT)).toBe("1.2.3");
  });

  it("falls back to a semver dir name when the manifest has no version", () => {
    expect(cacheMaxVersion(FIXTURE_CACHE, "dir-name-only", DEMO_MKT)).toBe(
      "2.0.0"
    );
  });

  it("returns null when no semver exists anywhere", () => {
    expect(cacheMaxVersion(FIXTURE_CACHE, "no-semver", DEMO_MKT)).toBeNull();
  });

  it("returns null for an absent plugin", () => {
    expect(cacheMaxVersion(FIXTURE_CACHE, "nope", DEMO_MKT)).toBeNull();
  });

  it("returns null for a path-traversal name (defense-in-depth)", () => {
    expect(cacheMaxVersion(FIXTURE_CACHE, "..", DEMO_MKT)).toBeNull();
  });
});

describe("validateArtifact coverage gate (drop nothing)", () => {
  const ctx = { cacheMax: null, filename: undefined, mdExists: true };

  it("flags an agent whose actions omit a component group (codex/agy cover both via keyword)", () => {
    const errors = validateArtifact(multiKind(["handle the mcp only"]), ctx);
    expect(errors).toContain(
      "routing.copilot: no action covers component group command"
    );
    expect(has(errors, "no action covers component group mcp")).toBe(false);
  });

  it("passes when actions cover every group (copilot references by component id)", () => {
    expect(
      validateArtifact(multiKind(["wire up demo-mcp and demo-cmd"]), ctx)
    ).toEqual([]);
  });

  it("exempts already-native and claude-only agents from coverage", () => {
    const a = multiKind([]);
    a.routing.copilot = {
      outcome: "already-native",
      actions: [],
      rationale: "covered by the existing fan-out",
    };
    expect(has(validateArtifact(a, ctx), "routing.copilot: no action")).toBe(
      false
    );
  });
});
