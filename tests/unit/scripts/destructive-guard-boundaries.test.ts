/**
 * The destructive guard's edges: normalization, identity-free values, the
 * denial text an operator reads, and argument parsing.
 *
 * Every case here was written against a specific mutant that survived once the
 * two behavioural suites were brought into the mutation gate (issue #2844).
 * That is the point of the gate: with all three suites joined the guard scored
 * 84.97, and the residue was not noise — it was a list of properties nothing
 * asserted. A denial whose message is empty still refuses, so no behavioural
 * test noticed that the reason could be deleted; a value with no alphanumeric
 * content could classify as non-production and every existing case still
 * passed.
 *
 * Reached by static `import`, like its siblings, so it joins the gate.
 * @module tests/unit/scripts/destructive-guard-boundaries
 */
import { describe, expect, it } from "vitest";

import {
  assertDestructiveAllowed,
  classifyEnvironment,
  destructiveDenial,
  isDestructive,
  parseDestructiveArgs,
} from "../../../all/copy-overwrite/scripts/lisa-destructive-guard.mjs";

/** A destructive request reporting no work, so only the name makes it so. */
const RESET = Object.freeze({
  capability: "reset",
  dryRun: true,
  summary: { deleted: 0, created: 0, preserved: 0 },
});

describe("classifyEnvironment: a value with no identity in it", () => {
  it.each(["???", "!!!", "***", "///", "..."])(
    "treats %s as unresolved rather than non-production",
    value => {
      // No alphanumeric segment survives the split, so there is nothing to
      // classify. Falling through to "non-production" would make punctuation
      // the cheapest way to run a destructive operation anywhere.
      expect(classifyEnvironment(value)).toBe("unresolved");
    }
  );

  it("still classifies a value that has one real segment among the noise", () => {
    expect(classifyEnvironment("...prod...")).toBe("production");
    expect(classifyEnvironment("...dev...")).toBe("non-production");
  });
});

describe("normalize: surrounding whitespace is not an identity", () => {
  it("accepts a padded stage that matches the resolved environment", () => {
    // Without the trim, " dev " and "dev" disagree and an honest caller is
    // refused. An over-refusing guard gets switched off, which is the failure
    // mode the segment-matching comment already warns about.
    expect(
      assertDestructiveAllowed({
        ...RESET,
        requestedStage: " dev ",
        resolvedEnvironment: "dev",
      })
    ).toEqual({ allowed: true, denial: null });
  });

  it("renders a stage that carries no text as empty in the mismatch message", () => {
    const result = assertDestructiveAllowed({
      ...RESET,
      requestedStage: 42,
      resolvedEnvironment: "dev",
    });
    expect(result.allowed).toBe(false);
    expect(result.denial?.code).toBe("stage-mismatch");
    expect(result.denial?.message).toContain('requested ""');
  });
});

describe("assertDestructiveAllowed: what it must NOT refuse", () => {
  it("returns the permitted decision untouched for a read-only capability in production", () => {
    // The early return is the whole reason a read-only capability can run in
    // production at all. Losing it turns the guard into a blanket production
    // ban, and the first person to hit it removes the guard.
    expect(
      assertDestructiveAllowed({
        capability: "state-classification",
        dryRun: false,
        summary: { deleted: 0, created: 0, preserved: 5 },
        resolvedEnvironment: "prod",
      })
    ).toEqual({ allowed: true, denial: null });
  });

  it("treats an explicitly null requested stage as no request at all", () => {
    expect(
      assertDestructiveAllowed({
        ...RESET,
        requestedStage: null,
        resolvedEnvironment: "dev",
      })
    ).toEqual({ allowed: true, denial: null });
  });
});

describe("every denial says why, in words an operator can act on", () => {
  it("names the contract and the environment when production is refused", () => {
    const denial = destructiveDenial({ ...RESET, environment: "acme-prod-1" });
    expect(denial?.code).toBe("production-forbidden");
    expect(denial?.message).toContain("acme-prod-1");
    expect(denial?.message).toMatch(/production/u);
  });

  it("says the read failed, and that failing closed is the point", () => {
    const denial = destructiveDenial({ ...RESET, environment: "unknown" });
    expect(denial?.code).toBe("unresolved-environment");
    expect(denial?.message).toMatch(/fails closed/u);
  });

  it("says a requested stage is not an authorization", () => {
    const result = assertDestructiveAllowed({
      ...RESET,
      requestedStage: "prod",
      resolvedEnvironment: "dev",
    });
    expect(result.denial?.code).toBe("production-requested");
    expect(result.denial?.message).toMatch(/never authorizes/u);
  });

  it("names both sides of a stage mismatch", () => {
    const result = assertDestructiveAllowed({
      ...RESET,
      requestedStage: "staging",
      resolvedEnvironment: "dev",
    });
    expect(result.denial?.code).toBe("stage-mismatch");
    expect(result.denial?.message).toContain("staging");
    expect(result.denial?.message).toContain("dev");
  });
});

describe("isDestructive: zero is not a mutation", () => {
  it("leaves a run reporting zero created rows non-destructive", () => {
    expect(
      isDestructive({ capability: "export", summary: { created: 0 } })
    ).toBe(false);
  });

  it("leaves a run reporting zero deleted rows non-destructive", () => {
    expect(
      isDestructive({ capability: "export", summary: { deleted: 0 } })
    ).toBe(false);
  });
});

describe("parseDestructiveArgs: reading an option that is not there", () => {
  it("returns null for an absent flag even when other arguments are present", () => {
    // The absent case has to be probed with a non-empty argv. With `[]` a
    // broken index test reads `argv[0]`, which is undefined, and coerces to
    // the same null the correct code returns.
    const parsed = parseDestructiveArgs(["--execute", "--verbose"]);
    expect(parsed.requestedStage).toBeNull();
    expect(parsed.idempotencyKey).toBeNull();
  });

  it("reads a flag that is not the first argument", () => {
    expect(
      parseDestructiveArgs(["--dry-run", "--stage", "dev"]).requestedStage
    ).toBe("dev");
    expect(
      parseDestructiveArgs(["--dry-run", "--idempotency-key", "run-9"])
        .idempotencyKey
    ).toBe("run-9");
  });

  it("defaults to a dry run when handed nothing at all", () => {
    // An adapter that forgets to pass argv enumerates rather than mutates.
    expect(parseDestructiveArgs(undefined)).toEqual({
      dryRun: true,
      requestedStage: null,
      idempotencyKey: null,
    });
  });
});
