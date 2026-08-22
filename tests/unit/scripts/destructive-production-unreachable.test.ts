/**
 * The negative property: no exported code path can report a successful
 * destructive run against a production-resolved environment.
 *
 * Asserting that some copy of the guard behaves correctly is weaker than
 * asserting that no copy misbehaves. The `reset-seed-coverage` rule says
 * production is refused "with no override, escape hatch, or environment
 * variable that changes the answer", so the test that matters is a universal
 * quantifier over the whole exported surface. The companion structural check —
 * that no escape hatch exists in the shipped source to begin with — is in
 * `destructive-guard-source-shape.test.ts`.
 *
 * Sibling `destructive-production-guard.test.ts` pins the guard's semantics;
 * this file pins unreachability. Split for the 300-line `max-lines` budget.
 *
 * Both halves of that pair reach the guard by a STATIC `import` declaration,
 * which is what puts them inside the mutation gate's derived include list. The
 * structural half — the assertions over the guard's own bytes and over which
 * tree ships the state-classification check — moved to
 * `destructive-guard-source-shape.test.ts` when this file was converted,
 * because a file cannot be both mutated and byte-asserted in the same run: the
 * instrumented copy Stryker builds in its sandbox carries a `process.env` read
 * that the shipped source does not (issue #2844).
 * @module tests/unit/scripts/destructive-production-unreachable
 */
import { describe, expect, it } from "vitest";

import {
  buildEnvelope,
  validateEnvelope,
} from "../../../all/copy-overwrite/scripts/lisa-command-envelope.mjs";
import {
  assertDestructiveAllowed,
  DESTRUCTIVE_CAPABILITIES,
  destructiveDenial,
} from "../../../all/copy-overwrite/scripts/lisa-destructive-guard.mjs";

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
  it("cannot build a success envelope for any destructive capability in any refused environment", () => {
    const combos: Combo[] = DESTRUCTIVE_CAPABILITIES.flatMap(capability =>
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
      .filter(combo => validateEnvelope(candidateEnvelope(combo)).valid)
      .map(
        combo =>
          `${combo.capability}/${combo.environment}/${combo.status}/dryRun=${combo.dryRun}`
      );
    expect(accepted).toEqual([]);
  });

  it("throws rather than returning an envelope when one is built directly", () => {
    expect(() =>
      buildEnvelope({
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
    const built = buildEnvelope({
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
    const result = validateEnvelope({
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
    const result = validateEnvelope({
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
        destructiveDenial({ ...base, environment }) === null
          ? `destructiveDenial/${label}`
          : null,
        assertDestructiveAllowed({
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
        const denial = destructiveDenial({
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
});
