/** Immutable wrapper-authoritative scratch registries for every managed route. */
import { env } from "node:process";

/** JSON-array environment contract for operator-added direct-child prefixes. */
export const SCRATCH_PREFIXES_ENV = "LISA_TEST_SCRATCH_PREFIXES";

/** Environment assertion for the immutable route suite label. */
export const SCRATCH_SUITE_ENV = "LISA_TEST_SCRATCH_SUITE";

/** Maximum number of registered prefixes accepted from configuration. */
const MAX_REGISTERED_PREFIXES = 64;

/** Maximum bytes in one registered prefix or suite label. */
const MAX_LABEL_BYTES = 128;

/** Every generated route profile understood by the public wrapper. */
export type ScratchRouteProfileName =
  | "lisa"
  | "typescript"
  | "nestjs"
  | "cdk"
  | "harper-fabric"
  | "phaser";

/** Frozen suite attribution decided before any scratch root exists. */
export interface ScratchRouteProfile {
  readonly name: ScratchRouteProfileName;
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
}

/** Wrapper-owned base registry; operator additions may only widen prefixes. */
const ROUTE_PROFILES: Readonly<
  Record<ScratchRouteProfileName, Omit<ScratchRouteProfile, "name">>
> = Object.freeze({
  lisa: Object.freeze({
    suiteLabel: "lisa",
    registeredPrefixes: Object.freeze([
      "changelog-",
      "derived-",
      "e2e-",
      "failure-signatures-",
      "invoked-",
      "lisa-",
      "maestro-",
      "node-",
      "review-",
      "skipreq-",
      "state-",
      "vacuity-",
      "wiki-",
    ]),
  }),
  typescript: Object.freeze({
    suiteLabel: "typescript",
    registeredPrefixes: [],
  }),
  nestjs: Object.freeze({ suiteLabel: "nestjs", registeredPrefixes: [] }),
  cdk: Object.freeze({
    suiteLabel: "cdk",
    registeredPrefixes: Object.freeze(["cdk", "cdk.out"]),
  }),
  "harper-fabric": Object.freeze({
    suiteLabel: "harper-fabric",
    registeredPrefixes: [],
  }),
  phaser: Object.freeze({ suiteLabel: "phaser", registeredPrefixes: [] }),
});

/**
 * Whether a label contains a control code unsafe for markers/diagnostics.
 * @param label - Candidate label
 * @returns True when a control code is present
 */
function containsControlCode(label: string): boolean {
  return [...label].some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/**
 * Demand one bounded direct basename.
 * @param value - Candidate value
 * @param context - Public diagnostic context
 * @returns Validated direct label
 */
function validateLabel(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    Buffer.byteLength(value, "utf8") > MAX_LABEL_BYTES ||
    containsControlCode(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${context} contains an invalid direct label`);
  }
  return value;
}

/**
 * Decode one operator prefix registry.
 * @param raw - Serialized registry
 * @returns Unvalidated decoded value
 */
function parseOperatorPrefixes(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${SCRATCH_PREFIXES_ENV} must be a JSON array of prefixes`);
  }
}

/**
 * Parse and canonicalize operator prefix additions exactly once.
 * @param environment - Inherited operator configuration
 * @returns Validated operator-added prefixes
 */
function operatorPrefixes(environment: NodeJS.ProcessEnv): readonly string[] {
  const raw = environment[SCRATCH_PREFIXES_ENV];
  if (raw === undefined || raw === "") return [];
  const parsed = parseOperatorPrefixes(raw);
  if (!Array.isArray(parsed) || parsed.length > MAX_REGISTERED_PREFIXES) {
    throw new Error(
      `${SCRATCH_PREFIXES_ENV} must contain at most ${String(MAX_REGISTERED_PREFIXES)} prefixes`
    );
  }
  return parsed.map(value => validateLabel(value, SCRATCH_PREFIXES_ENV));
}

/**
 * Resolve a generated route plus bounded operator additions before allocation.
 * @param name - Exact managed route name
 * @param environment - Inherited operator configuration
 * @returns Deeply frozen immutable registry
 */
export function resolveScratchRouteProfile(
  name: string,
  environment: NodeJS.ProcessEnv = env
): ScratchRouteProfile {
  if (!Object.hasOwn(ROUTE_PROFILES, name)) {
    throw new Error(
      `Unknown lisa-test-run scratch profile: ${name || "<missing>"}`
    );
  }
  const routeName = name as ScratchRouteProfileName;
  const base = ROUTE_PROFILES[routeName];
  const assertedSuite = environment[SCRATCH_SUITE_ENV];
  if (
    assertedSuite !== undefined &&
    validateLabel(assertedSuite, SCRATCH_SUITE_ENV) !== base.suiteLabel
  ) {
    throw new Error(
      `${SCRATCH_SUITE_ENV} conflicts with wrapper profile ${routeName}`
    );
  }
  const prefixes = [
    ...new Set([...base.registeredPrefixes, ...operatorPrefixes(environment)]),
  ].sort((left, right) => (left === right ? 0 : left < right ? -1 : 1));
  if (prefixes.length > MAX_REGISTERED_PREFIXES) {
    throw new Error(
      `${SCRATCH_PREFIXES_ENV} exceeds the ${String(MAX_REGISTERED_PREFIXES)} prefix limit after composition`
    );
  }
  return Object.freeze({
    name: routeName,
    suiteLabel: base.suiteLabel,
    registeredPrefixes: Object.freeze(prefixes),
  });
}

/**
 * Assert dynamic Vitest env agrees with the frozen wrapper lease exactly.
 * @param profile - Frozen wrapper-authoritative profile
 * @param environment - Dynamic Vitest environment to compare
 */
export function assertScratchRouteProfile(
  profile: Pick<ScratchRouteProfile, "suiteLabel" | "registeredPrefixes">,
  environment: NodeJS.ProcessEnv = env
): void {
  const observedSuite = validateLabel(
    environment[SCRATCH_SUITE_ENV],
    SCRATCH_SUITE_ENV
  );
  const observedPrefixes = operatorPrefixes(environment);
  const canonical = [...new Set(observedPrefixes)].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1
  );
  if (
    observedSuite !== profile.suiteLabel ||
    canonical.length !== profile.registeredPrefixes.length ||
    canonical.some(
      (prefix, index) => prefix !== profile.registeredPrefixes[index]
    )
  ) {
    throw new Error(
      `Vitest scratch configuration conflicts with the immutable wrapper profile: ` +
        `expected ${profile.suiteLabel}/${JSON.stringify(profile.registeredPrefixes)}, ` +
        `received ${observedSuite}/${JSON.stringify(canonical)}`
    );
  }
}
