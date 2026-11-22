/**
 * `.lisa.config.json` builders for the suites that prove a declared threshold
 * may tighten and never loosen (CodySwannGT/lisa#4985).
 *
 * A declared threshold is a parameter of one part of one gate, written
 * `{ value, direction }` where `direction` is `floor` or `ceiling`. The suites
 * compare two versions of the file, so everything here returns the file's text
 * rather than an object: that is what the comparison is handed by git.
 * @module tests/helpers/declared-thresholds
 */

/** The file the declaration lives in. */
export const LISA_CONFIG_FILE = ".lisa.config.json";

/** The gate most cases declare. */
export const COVERAGE_GATE = "coverage-adequacy";

/** The parameter most cases declare. */
export const COVERAGE_FLOOR = "minimum-coverage";

/** One part of a gate, as it is written in the file. */
export interface DeclaredPart {
  /** The folder the part covers; `.` is the whole repository. */
  readonly scope: string;
  /** What checks it, one item per argument. */
  readonly command: readonly string[];
  /**
   * The part's named settings. Untyped on purpose: the suites also write the
   * shapes a hand edit can leave behind.
   */
  readonly parameters?: unknown;
}

/**
 * One part of a gate.
 * @param scope - The folder the part covers
 * @param parameters - Its named settings; left out when not given
 * @returns The part
 */
export function part(scope: string, parameters?: unknown): DeclaredPart {
  const command = ["python", "-m", "pytest", "--cov"];
  return parameters === undefined
    ? { scope, command }
    : { scope, command, parameters };
}

/**
 * A gate that is required on a pull request and proved by its parts.
 * @param parts - The gate's parts
 * @returns The gate
 */
export function gateOf(
  ...parts: readonly DeclaredPart[]
): Readonly<Record<string, unknown>> {
  return { "pull-request": "required", parts };
}

/**
 * The text of a `.lisa.config.json` with a `gates` block.
 * @param gates - The `gates` block
 * @param rest - Other top-level keys of the file
 * @returns The file content
 */
export function configText(
  gates: Readonly<Record<string, unknown>>,
  rest: Readonly<Record<string, unknown>> = {}
): string {
  return `${JSON.stringify({ ...rest, gates }, null, 2)}\n`;
}

/**
 * A file that declares one parameter on one part of the coverage gate.
 * @param parameter - The parameter as written, for example
 *   `{ value: 60, direction: "floor" }`
 * @param scope - The folder the part covers
 * @returns The file content
 */
export function coverageConfig(parameter: unknown, scope = "api"): string {
  return configText({
    [COVERAGE_GATE]: gateOf(part(scope, { [COVERAGE_FLOOR]: parameter })),
  });
}

/**
 * A file that declares the coverage floor at a value.
 * @param value - The floor
 * @param scope - The folder the part covers
 * @returns The file content
 */
export function floorAt(value: number, scope = "api"): string {
  return coverageConfig({ value, direction: "floor" }, scope);
}

/**
 * The name the comparison gives one declared threshold, which is also the
 * `key` of the exception entry that covers it.
 * @param gate - The gate id
 * @param scope - The part's folder
 * @param name - The parameter name
 * @returns The key
 */
export function thresholdKey(
  gate: string = COVERAGE_GATE,
  scope = "api",
  name: string = COVERAGE_FLOOR
): string {
  return `gates.${gate}.parts[${scope}].parameters.${name}`;
}
