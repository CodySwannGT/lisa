/**
 * The negative property: no exported code path can report a successful
 * destructive run against a production-resolved environment.
 *
 * Asserting that some copy of the guard behaves correctly is weaker than
 * asserting that no copy misbehaves. The `reset-seed-coverage` rule says
 * production is refused "with no override, escape hatch, or environment
 * variable that changes the answer", so the test that matters is a universal
 * quantifier over the whole exported surface plus a structural check that no
 * escape hatch exists in the shipped source to begin with.
 *
 * Sibling `destructive-production-guard.test.ts` pins the guard's semantics;
 * this file pins unreachability. Split for the 300-line `max-lines` budget.
 * @module tests/unit/scripts/destructive-production-unreachable
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS_REL = "all/copy-overwrite/scripts";
const GUARD_REL = `${SCRIPTS_REL}/lisa-destructive-guard.mjs`;
const ENVELOPE_REL = `${SCRIPTS_REL}/lisa-command-envelope.mjs`;
const STATE_CHECK_REL = `${SCRIPTS_REL}/check-state-classification.mjs`;

/** Environments that must never host a successful destructive run. */
const REFUSED_ENVIRONMENTS = [
  "prod",
  "production",
  "PRODUCTION",
  "prd",
  "live",
  "acme-prod-1",
  "unknown",
  "unresolved",
  "n/a",
] as const;

/** Statuses the envelope contract allows to exit 0. */
const SUCCESS_STATUSES = ["completed", "no-op", "not-adopted"] as const;

/**
 * Override-shaped fields no code path may honour. Each is a plausible escape
 * hatch someone reaches for under deadline pressure; none may change the answer.
 */
const OVERRIDE_FIELDS: readonly Record<string, unknown>[] = [
  {},
  { force: true },
  { allowProduction: true },
  { override: true },
  { confirm: "yes" },
  { i_know_what_i_am_doing: true },
  { productionApproved: true },
  { skipGuard: true },
];

/** Environment variables no code path may consult. */
const OVERRIDE_ENV_KEYS = [
  "LISA_ALLOW_PRODUCTION_RESET",
  "ALLOW_PRODUCTION",
  "FORCE",
  "CI",
  "NODE_ENV",
  "STATE_ENVIRONMENT",
] as const;

/** Pinned envelope schema version. */
const SCHEMA_VERSION = "lisa-command-envelope-v1";

/** Fixture values shared by every candidate envelope below. */
const OPERATION = "converge-fixtures";
const CONTRACT_VERSION = "example-state-v1";
const CORRELATION_ID = "run-1";
const PROD = "prod";

/** Zeroed counters, so a candidate is destructive by capability name alone. */
const NO_COUNTS = Object.freeze({ deleted: 0, created: 0, preserved: 0 });

/** A refusal with a machine-readable code, or null when nothing is refused. */
type Denial = { code: string; message: string } | null;

/** One point in the unreachability matrix. */
type Combo = {
  capability: string;
  environment: string;
  status: string;
  dryRun: boolean;
};

/**
 * Build a candidate envelope for one matrix point.
 *
 * `schemaVersion` must be present. Without it every candidate fails schema
 * validation for an unrelated reason and the matrix passes vacuously — which is
 * exactly what it did until a mutation probe disabled the guard and this test
 * kept passing.
 * @param combo - The matrix point to render
 * @returns An envelope-shaped candidate
 */
function candidateEnvelope(combo: Combo): Record<string, unknown> {
  const declarative =
    combo.status === "no-op"
      ? {
          reason: "nothing to do",
          owner: "platform",
          capabilityManifest: "manifest#reset",
        }
      : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    capability: combo.capability,
    mode: "real",
    operation: OPERATION,
    environment: combo.environment,
    contractVersion: CONTRACT_VERSION,
    dryRun: combo.dryRun,
    status: combo.status,
    correlationId: CORRELATION_ID,
    summary: { ...NO_COUNTS },
    ...declarative,
  };
}

describe("destructive operations are unreachable in production", () => {
  let guard: {
    DESTRUCTIVE_CAPABILITIES: readonly string[];
    destructiveDenial: (fields: Record<string, unknown>) => Denial;
    assertDestructiveAllowed: (fields: Record<string, unknown>) => {
      allowed: boolean;
      denial: Denial;
    };
  };
  let envelope: {
    buildEnvelope: (fields: Record<string, unknown>) => Record<string, unknown>;
    validateEnvelope: (value: unknown) => {
      valid: boolean;
      errors: string[];
    };
  };
  let guardSource: string;

  beforeAll(async () => {
    guard = await import(pathToFileURL(path.join(REPO_ROOT, GUARD_REL)).href);
    envelope = await import(
      pathToFileURL(path.join(REPO_ROOT, ENVELOPE_REL)).href
    );
    guardSource = fs.readFileSync(path.join(REPO_ROOT, GUARD_REL), "utf8");
  });

  it("cannot build a success envelope for any destructive capability in any refused environment", () => {
    const combos: Combo[] = guard.DESTRUCTIVE_CAPABILITIES.flatMap(capability =>
      REFUSED_ENVIRONMENTS.flatMap(environment =>
        SUCCESS_STATUSES.flatMap(status =>
          [true, false].map(dryRun => ({
            capability,
            environment,
            status,
            dryRun,
          }))
        )
      )
    );
    // Guards the guard: an empty or tiny matrix would also produce an empty
    // `accepted` list and read as a pass.
    expect(combos.length).toBeGreaterThan(100);

    const accepted = combos
      .filter(
        combo => envelope.validateEnvelope(candidateEnvelope(combo)).valid
      )
      .map(
        combo =>
          `${combo.capability}/${combo.environment}/${combo.status}/dryRun=${combo.dryRun}`
      );
    expect(accepted).toEqual([]);
  });

  it("throws rather than returning an envelope when one is built directly", () => {
    expect(() =>
      envelope.buildEnvelope({
        capability: "reset",
        mode: "real",
        operation: OPERATION,
        environment: PROD,
        contractVersion: CONTRACT_VERSION,
        dryRun: false,
        status: "completed",
        correlationId: CORRELATION_ID,
        summary: { deleted: 4, created: 0, preserved: 0 },
      })
    ).toThrow(/production/iu);
  });

  it("still permits REPORTING the refusal, so a denial is auditable", () => {
    const built = envelope.buildEnvelope({
      capability: "reset",
      mode: "real",
      operation: OPERATION,
      environment: PROD,
      contractVersion: CONTRACT_VERSION,
      dryRun: true,
      status: "denied",
      reason: "production is refused by the reset-seed contract",
      correlationId: CORRELATION_ID,
      summary: { ...NO_COUNTS },
    });
    expect(built["status"]).toBe("denied");
  });

  it("does not fire on a read-only capability reporting no mutations", () => {
    const result = envelope.validateEnvelope({
      schemaVersion: SCHEMA_VERSION,
      capability: "state-classification",
      mode: "real",
      operation: "classify",
      environment: PROD,
      contractVersion: CONTRACT_VERSION,
      dryRun: false,
      status: "completed",
      correlationId: CORRELATION_ID,
      summary: { deleted: 0, created: 0, preserved: 12 },
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("refuses a mutation reported in production even from a read-only capability name", () => {
    const result = envelope.validateEnvelope({
      schemaVersion: SCHEMA_VERSION,
      capability: "state-inventory",
      mode: "real",
      operation: "enumerate",
      environment: PROD,
      contractVersion: CONTRACT_VERSION,
      dryRun: false,
      status: "completed",
      correlationId: CORRELATION_ID,
      summary: { deleted: 1, created: 0, preserved: 12 },
    });
    expect(result.valid).toBe(false);
  });

  it("honours no override field on any exported decision function", () => {
    const cases = OVERRIDE_FIELDS.flatMap(extra =>
      REFUSED_ENVIRONMENTS.map(environment => ({ extra, environment }))
    );
    const honoured = cases.flatMap(({ extra, environment }) => {
      const base = {
        capability: "reset",
        dryRun: true,
        summary: { ...NO_COUNTS },
        ...extra,
      };
      const label = `${environment}/${JSON.stringify(extra)}`;
      return [
        guard.destructiveDenial({ ...base, environment }) === null
          ? `destructiveDenial/${label}`
          : null,
        guard.assertDestructiveAllowed({
          ...base,
          resolvedEnvironment: environment,
        }).allowed
          ? `assertDestructiveAllowed/${label}`
          : null,
      ].filter(Boolean);
    });
    expect(honoured).toEqual([]);
  });

  it("honours no environment variable", () => {
    const honoured: string[] = [];
    const restore = OVERRIDE_ENV_KEYS.map(
      key => [key, process.env[key]] as const
    );
    try {
      for (const key of OVERRIDE_ENV_KEYS) {
        process.env[key] = "1";
      }
      for (const environment of REFUSED_ENVIRONMENTS) {
        const denial = guard.destructiveDenial({
          capability: "reset",
          environment,
          dryRun: false,
          summary: { deleted: 0, created: 0, preserved: 0 },
        });
        if (denial === null) honoured.push(environment);
      }
    } finally {
      for (const [key, value] of restore) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    expect(honoured).toEqual([]);
  });

  it("reads no environment variable in the shipped guard source", () => {
    expect(guardSource).not.toMatch(/process\s*\.\s*env/u);
  });

  it("exposes no exported escape hatch in the shipped guard source", () => {
    expect(guardSource).not.toMatch(
      /export\s+(?:const|function)\s+\w*(?:force|override|allowProduction|bypass|disable)/iu
    );
  });
});

describe("the state-classification gate still reaches typescript and expo adopters", () => {
  it("ships from the stack-agnostic tree", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, STATE_CHECK_REL))).toBe(true);
  });

  it.each(["typescript", "expo"])(
    "is not shadowed by a %s copy that would suppress the shared one",
    stack => {
      expect(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            stack,
            "copy-overwrite/scripts/check-state-classification.mjs"
          )
        )
      ).toBe(false);
    }
  );

  it.each(["all", "typescript", "expo"])(
    "is not listed for deletion by the %s stack",
    stack => {
      const file = path.join(REPO_ROOT, stack, "deletions.json");
      const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}";
      expect(raw).not.toContain("scripts/check-state-classification.mjs");
    }
  );
});
