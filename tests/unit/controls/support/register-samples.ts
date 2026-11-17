/**
 * One sample of every object the control register holds, typed so the
 * compiler checks each against `src/controls/register-types.ts`.
 *
 * A full sample is declared `Required<…>` and written as an object literal,
 * so it must carry every key of its type and may carry no other. The suites
 * that hold the published schema to the types compare the schema with these
 * samples: a key added to a type without the schema, or to the schema without
 * the type, fails either the compiler or those suites
 * (CodySwannGT/lisa#4983).
 * @module tests/unit/controls/support/register-samples
 */
import type {
  ControlEvidence,
  ControlParameter,
  ControlProof,
  ControlRegister,
  ControlRegisterEntry,
  EnforcementPoint,
  EvidenceLocator,
  MeasuringMechanism,
  MechanismKind,
  PullRequestExecutor,
} from "../../../../src/controls/register-types.js";

/** One mechanism of every kind, each with every key its type has. */
export const MECHANISMS: {
  readonly [Kind in MechanismKind]: Required<
    Extract<MeasuringMechanism, { readonly kind: Kind }>
  >;
} = {
  command: { kind: "command", argv: ["ruff", "check", "."] },
  task: { kind: "task", task: "lint", command: "npm run lint" },
  "external-check": { kind: "external-check", name: "Review", posted_by: 7 },
  interceptor: { kind: "interceptor" },
  "built-in": { kind: "built-in" },
  none: { kind: "none" },
};

/** A pull-request executor with every key. */
export const EXECUTOR: Required<PullRequestExecutor> = {
  platform: "gitlab",
  path: ".gitlab-ci.yml",
};

/** An enforcement point with every key. */
export const POINT: Required<EnforcementPoint> = {
  moment: "pull-request",
  level: "required",
  location: "hosting-platform",
  measuring_mechanism: MECHANISMS.task,
  executor: EXECUTOR,
};

/** A parameter with every key. */
export const PARAMETER: Required<ControlParameter> = {
  value: 80,
  direction: "floor",
};

/** A proof with every key filled in. */
export const PROOF: Required<ControlProof> = {
  violation: ".lisa/controls/proofs/lint.violation.patch",
  clean: ".lisa/controls/proofs/lint.clean.patch",
  failure_shape: ["Found 1 error"],
  timeout_seconds: 120,
  external_effects: [],
};

/** A place the audit found a check, with every key. */
export const LOCATOR: Required<EvidenceLocator> = {
  path: "api/ruff.toml",
  line: 1,
};

/** What supports an entry, with every key filled in. */
export const EVIDENCE: Required<ControlEvidence> = {
  locators: [LOCATOR],
  questions: ["SI2@api"],
};

/** An entry with every key filled in. */
export const ENTRY: Required<ControlRegisterEntry> = {
  id: "code-style@api",
  gate: "code-style",
  criteria: ["SI7"],
  scope: "api",
  tier: "authoritative",
  enforcement_points: [POINT],
  measuring_mechanism: MECHANISMS.command,
  parameters: { "minimum-coverage": PARAMETER },
  proof: PROOF,
  accountable_party: "Platform team",
  evidence: EVIDENCE,
  status: "unproved",
};

/** A register with every key. */
export const REGISTER: Required<ControlRegister> = {
  schema_version: 1,
  entries: [ENTRY],
};

/** An enforcement point with its optional key left off. */
export const BARE_POINT: EnforcementPoint = {
  moment: "commit",
  level: "optional",
  location: "local-checkout",
};

/** An entry with every optional key left off and every `null` taken. */
export const BARE_ENTRY: ControlRegisterEntry = {
  id: ENTRY.id,
  gate: ENTRY.gate,
  scope: ENTRY.scope,
  tier: ENTRY.tier,
  measuring_mechanism: ENTRY.measuring_mechanism,
  criteria: [],
  enforcement_points: [BARE_POINT],
  parameters: { flag: { value: true }, name: { value: "strict" } },
  proof: {
    violation: null,
    clean: null,
    failure_shape: null,
    timeout_seconds: null,
    external_effects: null,
  },
  accountable_party: null,
};

/**
 * Each object the schema defines by name: a full sample of its type, and the
 * keys its type marks optional.
 */
export const SHAPES: readonly (readonly [string, object, readonly string[]])[] =
  [
    ["entry", ENTRY, ["evidence", "status"]],
    ["evidence", EVIDENCE, []],
    ["locator", LOCATOR, []],
    ["enforcement_point", POINT, ["measuring_mechanism", "executor"]],
    ["executor", EXECUTOR, []],
    ["parameter", PARAMETER, ["direction"]],
    ["proof", PROOF, []],
  ];

/**
 * A register holding one entry.
 * @param entry - The entry
 * @returns The register
 */
export function registerWith(entry: unknown): unknown {
  return { schema_version: 1, entries: [entry] };
}
