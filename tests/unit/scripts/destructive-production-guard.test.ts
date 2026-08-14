/**
 * Tests for the executable arm of the `reset-seed-coverage` production rule.
 *
 * The rule's `production-fails-closed` assurance — "Production is refused with
 * no override, escape hatch, or environment variable that changes the answer" —
 * shipped as prose only (issue #2491). Prose measured ~0/13 conformance in this
 * codebase, including by the agent that wrote it, so for a destructive,
 * irreversible operation it is the wrong rung.
 *
 * This file pins the guard's semantics. Its sibling
 * `destructive-production-unreachable.test.ts` pins the stronger, negative
 * property: that NO exported code path can report a successful destructive run
 * against a production-resolved environment.
 * @module tests/unit/scripts/destructive-production-guard
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GUARD_REL = "all/copy-overwrite/scripts/lisa-destructive-guard.mjs";

/** Environment identities that must classify as production. */
const PRODUCTION_NAMES = [
  "prod",
  "PROD",
  "production",
  "Production",
  "prd",
  "live",
  "us-east-1/prod",
  "acme-prod-1",
  "prod_blue",
  "preprod",
] as const;

/** Environment identities that must classify as non-production. */
const NON_PRODUCTION_NAMES = [
  "dev",
  "development",
  "test",
  "ci",
  "staging",
  "stg",
  "sandbox",
  "review-app-42",
  "local",
] as const;

/** Values that carry no environment identity and must fail closed. */
const UNRESOLVED_VALUES = [
  "",
  "   ",
  "unknown",
  "UNRESOLVED",
  "undefined",
  "null",
  "n/a",
  "none",
  "-",
  undefined,
  null,
  42,
  {},
] as const;

/** A refusal with a machine-readable code, or null when nothing is refused. */
type Denial = { code: string; message: string } | null;

describe("lisa-destructive-guard", () => {
  let classifyEnvironment: (value: unknown) => string;
  let isDestructive: (fields: Record<string, unknown>) => boolean;
  let destructiveDenial: (fields: Record<string, unknown>) => Denial;
  let assertDestructiveAllowed: (fields: Record<string, unknown>) => {
    allowed: boolean;
    denial: Denial;
  };
  let parseDestructiveArgs: (argv: readonly string[]) => {
    dryRun: boolean;
    requestedStage: string | null;
    idempotencyKey: string | null;
  };
  let DESTRUCTIVE_CAPABILITIES: readonly string[];

  beforeAll(async () => {
    const mod = await import(
      pathToFileURL(path.join(REPO_ROOT, GUARD_REL)).href
    );
    ({
      classifyEnvironment,
      isDestructive,
      destructiveDenial,
      assertDestructiveAllowed,
      parseDestructiveArgs,
      DESTRUCTIVE_CAPABILITIES,
    } = mod);
  });

  describe("classifyEnvironment", () => {
    it.each(PRODUCTION_NAMES)("classifies %s as production", name => {
      expect(classifyEnvironment(name)).toBe("production");
    });

    it.each(NON_PRODUCTION_NAMES)("classifies %s as non-production", name => {
      expect(classifyEnvironment(name)).toBe("non-production");
    });

    it.each(UNRESOLVED_VALUES.map(value => [String(value), value] as const))(
      "classifies %s as unresolved rather than guessing",
      (_label, value) => {
        expect(classifyEnvironment(value)).toBe("unresolved");
      }
    );
  });

  describe("isDestructive", () => {
    it("treats every declared destructive capability as destructive", () => {
      expect(DESTRUCTIVE_CAPABILITIES.length).toBeGreaterThan(0);
      for (const capability of DESTRUCTIVE_CAPABILITIES) {
        expect(
          isDestructive({
            capability,
            summary: { deleted: 0, created: 0, preserved: 0 },
          })
        ).toBe(true);
      }
    });

    it("names reset and seed among them", () => {
      expect(DESTRUCTIVE_CAPABILITIES).toContain("reset");
      expect(DESTRUCTIVE_CAPABILITIES).toContain("seed");
    });

    it.each([
      ["deleted", { deleted: 1, created: 0, preserved: 0 }],
      ["created", { deleted: 0, created: 1, preserved: 0 }],
    ])(
      "treats a read-only capability that reports %s rows as destructive",
      (_label, summary) => {
        expect(isDestructive({ capability: "state-inventory", summary })).toBe(
          true
        );
      }
    );

    it("leaves a genuinely read-only run non-destructive", () => {
      expect(
        isDestructive({
          capability: "state-classification",
          summary: { deleted: 0, created: 0, preserved: 9 },
        })
      ).toBe(false);
    });
  });

  describe("destructiveDenial", () => {
    it("denies a destructive run in a production-resolved environment", () => {
      const denial = destructiveDenial({
        capability: "reset",
        environment: "prod",
        dryRun: false,
        summary: { deleted: 3, created: 0, preserved: 0 },
      });
      expect(denial?.code).toBe("production-forbidden");
    });

    it("denies a destructive DRY RUN in production too — dry-run is not an override", () => {
      const denial = destructiveDenial({
        capability: "reset",
        environment: "production",
        dryRun: true,
        summary: { deleted: 0, created: 0, preserved: 0 },
      });
      expect(denial?.code).toBe("production-forbidden");
    });

    it("denies when the environment could not be resolved", () => {
      const denial = destructiveDenial({
        capability: "reset",
        environment: "unknown",
        dryRun: true,
        summary: { deleted: 0, created: 0, preserved: 0 },
      });
      expect(denial?.code).toBe("unresolved-environment");
    });

    it("allows a read-only capability to run in production", () => {
      expect(
        destructiveDenial({
          capability: "state-classification",
          environment: "prod",
          dryRun: false,
          summary: { deleted: 0, created: 0, preserved: 12 },
        })
      ).toBeNull();
    });

    it("allows a destructive run in a non-production environment", () => {
      expect(
        destructiveDenial({
          capability: "reset",
          environment: "dev",
          dryRun: false,
          summary: { deleted: 3, created: 1, preserved: 8 },
        })
      ).toBeNull();
    });
  });

  describe("assertDestructiveAllowed — the caller-supplied stage is a request", () => {
    const base = {
      capability: "reset",
      dryRun: true,
      summary: { deleted: 0, created: 0, preserved: 0 },
    };

    it("denies when the requested stage disagrees with server-resolved identity", () => {
      const result = assertDestructiveAllowed({
        ...base,
        requestedStage: "staging",
        resolvedEnvironment: "dev",
      });
      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe("stage-mismatch");
    });

    it("denies a production request even when the resolver says otherwise", () => {
      const result = assertDestructiveAllowed({
        ...base,
        requestedStage: "prod",
        resolvedEnvironment: "dev",
      });
      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe("production-requested");
    });

    it("denies an unresolvable server-side identity regardless of the request", () => {
      const result = assertDestructiveAllowed({
        ...base,
        requestedStage: "dev",
        resolvedEnvironment: "",
      });
      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe("unresolved-environment");
    });

    it("allows a matching non-production stage", () => {
      const result = assertDestructiveAllowed({
        ...base,
        requestedStage: "dev",
        resolvedEnvironment: "dev",
      });
      expect(result).toEqual({ allowed: true, denial: null });
    });

    it("allows an omitted stage against a resolved non-production identity", () => {
      const result = assertDestructiveAllowed({
        ...base,
        resolvedEnvironment: "staging",
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe("parseDestructiveArgs — --dry-run is the default, not an opt-in", () => {
    it("defaults to a dry run when nothing is passed", () => {
      expect(parseDestructiveArgs([]).dryRun).toBe(true);
    });

    it("stays a dry run when --dry-run is passed explicitly", () => {
      expect(parseDestructiveArgs(["--dry-run"]).dryRun).toBe(true);
    });

    it.each([["--no-dry-run"], ["--execute"]])(
      "leaves the dry run only for the explicit opt-out %s",
      flag => {
        expect(parseDestructiveArgs([flag]).dryRun).toBe(false);
      }
    );

    it("keeps the dry run when the opt-out is misspelled", () => {
      expect(parseDestructiveArgs(["--no-dryrun", "--force"]).dryRun).toBe(
        true
      );
    });

    it("keeps the dry run when both the flag and its opt-out are passed", () => {
      expect(parseDestructiveArgs(["--execute", "--dry-run"]).dryRun).toBe(
        true
      );
    });

    it.each([
      [["--stage", "dev"], "dev"],
      [["--stage=dev"], "dev"],
      [[], null],
    ] as const)("reads the requested stage from %j", (argv, expected) => {
      expect(parseDestructiveArgs(argv).requestedStage).toBe(expected);
    });

    it.each([
      [["--idempotency-key", "run-7"], "run-7"],
      [["--idempotency-key=run-7"], "run-7"],
      [[], null],
    ] as const)("reads the idempotency key from %j", (argv, expected) => {
      expect(parseDestructiveArgs(argv).idempotencyKey).toBe(expected);
    });
  });
});
