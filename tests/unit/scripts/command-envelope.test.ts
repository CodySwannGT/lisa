/**
 * Tests for the standard command envelope every capability adapter returns.
 *
 * The envelope exists so "every repo answers the same interface the same way"
 * is checkable rather than aspirational. The two properties worth pinning are
 * the ones that decay first: exit 0 means completed AND verified (so "I could
 * not look" can never read as success), and a declared noop is machine-readable
 * (so it can never be confused with a successful destructive run).
 * @module tests/unit/scripts/command-envelope
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL = "all/copy-overwrite/scripts/lisa-command-envelope.mjs";
const VALIDATOR_REL = "all/copy-overwrite/scripts/lisa-schema-validate.mjs";

const SCHEMA_VERSION = "lisa-command-envelope-v1";
const NOOP_MODE = "declared-noop";

/**
 * Sort strings deterministically without relying on default ordering.
 * @param values - Strings to sort
 * @returns A new, sorted array
 */
const sorted = (values: readonly string[]): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));

/** A minimal, valid envelope used as the base for negative cases. */
const VALID = {
  schemaVersion: SCHEMA_VERSION,
  capability: "reset",
  mode: "real",
  operation: "converge-fixtures",
  environment: "dev",
  contractVersion: "example-state-v1",
  dryRun: false,
  status: "completed",
  correlationId: "run-1",
  summary: { deleted: 3, created: 1, preserved: 12 },
} as const;

describe("lisa-command-envelope", () => {
  let buildEnvelope: (
    fields: Record<string, unknown>
  ) => Record<string, unknown>;
  let validateEnvelope: (envelope: unknown) => {
    valid: boolean;
    errors: string[];
  };
  let exitCodeForStatus: (status: string) => number;
  let redact: (text: string) => string;
  let schema: {
    properties: {
      status: { enum: string[] };
      mode: { enum: string[] };
      summary: { required: string[] };
    };
    required: string[];
  };
  let validateAgainstSchema: (
    document: unknown,
    schema: unknown
  ) => { valid: boolean; errors: string[] };

  beforeAll(async () => {
    const mod = await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    );
    buildEnvelope = mod.buildEnvelope;
    validateEnvelope = mod.validateEnvelope;
    exitCodeForStatus = mod.exitCodeForStatus;
    redact = mod.redact;
    schema = mod.COMMAND_ENVELOPE_SCHEMA;
    const validator = await import(
      pathToFileURL(path.join(REPO_ROOT, VALIDATOR_REL)).href
    );
    validateAgainstSchema = validator.validateAgainstSchema;
  });

  describe("the published schema", () => {
    it("requires every field the standard names", () => {
      expect(sorted(schema.required)).toEqual(
        sorted([
          "capability",
          "contractVersion",
          "correlationId",
          "dryRun",
          "environment",
          "mode",
          "operation",
          "schemaVersion",
          "status",
          "summary",
        ])
      );
    });

    it("requires the three comparable counters in summary", () => {
      expect(sorted(schema.properties.summary.required)).toEqual([
        "created",
        "deleted",
        "preserved",
      ]);
    });

    it("names the noop mode explicitly", () => {
      expect(schema.properties.mode.enum).toContain(NOOP_MODE);
    });
  });

  describe("exit-code semantics", () => {
    it("exits 0 only for outcomes that both completed and verified", () => {
      expect(exitCodeForStatus("completed")).toBe(0);
      expect(exitCodeForStatus("no-op")).toBe(0);
      expect(exitCodeForStatus("not-adopted")).toBe(0);
    });

    it("exits nonzero for denied, invalid, failed and mismatch", () => {
      for (const status of [
        "denied",
        "invalid",
        "failed",
        "verification-mismatch",
      ]) {
        expect(exitCodeForStatus(status)).toBe(1);
      }
    });

    it("never lets 'I could not look' report as success", () => {
      expect(exitCodeForStatus("detection-only")).toBe(1);
    });
  });

  describe("validation", () => {
    it("accepts a well-formed envelope", () => {
      expect(validateEnvelope({ ...VALID }).valid).toBe(true);
    });

    it("rejects an unpinned schema version", () => {
      const result = validateEnvelope({
        ...VALID,
        schemaVersion: "something-else",
      });
      expect(result.valid).toBe(false);
    });

    it("rejects a noop with no reason, owner or capability manifest", () => {
      const result = validateEnvelope({
        ...VALID,
        mode: NOOP_MODE,
        status: "no-op",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("capabilityManifest");
    });

    it("requires a reason on every non-success status", () => {
      const result = validateEnvelope({
        ...VALID,
        status: "denied",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("reason");
    });

    it("rejects a declared noop that claims a completed run", () => {
      const result = validateEnvelope({
        ...VALID,
        mode: NOOP_MODE,
        status: "completed",
        reason: "nothing to do",
        owner: "team",
        capabilityManifest: "docs/capability-matrix.md#x",
      });
      expect(result.valid).toBe(false);
    });

    it("rejects unknown top-level fields so drift is visible", () => {
      const result = validateEnvelope({
        ...VALID,
        stage: "dev",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("stage");
    });
  });

  describe("buildEnvelope", () => {
    it("fills the invariant fields and freezes the result", () => {
      const envelope = buildEnvelope({ ...VALID });
      expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
      expect(Object.isFrozen(envelope)).toBe(true);
    });

    it("defaults the three counters so runs stay comparable", () => {
      const envelope = buildEnvelope({ ...VALID, summary: { deleted: 5 } });
      expect(envelope.summary).toEqual({
        deleted: 5,
        created: 0,
        preserved: 0,
      });
    });

    it("throws rather than emitting an invalid envelope", () => {
      expect(() => buildEnvelope({ capability: "reset" })).toThrow(
        /invalid command envelope/u
      );
    });
  });

  describe("stderr redaction", () => {
    it("masks credentials, addresses and long digit runs", () => {
      const masked = redact(
        "password=hunter2 for tester@example.com card 4111111111111111"
      );
      expect(masked).not.toContain("hunter2");
      expect(masked).not.toContain("tester@example.com");
      expect(masked).not.toContain("4111111111111111");
    });
  });

  describe("the schema validator", () => {
    it("refuses to validate a schema keyword it does not implement", () => {
      const result = validateAgainstSchema(
        {},
        { type: "object", oneOf: [{ type: "object" }] }
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("unsupported keyword");
    });

    it("resolves local $defs references", () => {
      const result = validateAgainstSchema(
        { a: { evidence: "x" } },
        {
          type: "object",
          properties: { a: { $ref: "#/$defs/e" } },
          $defs: {
            e: {
              type: "object",
              required: ["evidence"],
              properties: { evidence: { type: "string", minLength: 1 } },
            },
          },
        }
      );
      expect(result.valid).toBe(true);
    });
  });
});
