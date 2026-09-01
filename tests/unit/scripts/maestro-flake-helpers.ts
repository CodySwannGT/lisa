/**
 * Shared fixtures and types for the Maestro flake-classifier suites.
 *
 * The classifier is a zero-dependency `.mjs` shipped into installed Expo repos,
 * so the tests load it the same way CI does — by URL, from the template path —
 * rather than importing a TypeScript source that would not exist downstream.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL = "expo/copy-overwrite/scripts/classify-maestro-failures.mjs";

/** Selector the reference sign-in preamble gates on before anything else. */
export const LANDING_SCREEN = "landing:screen";
/** Verdict for a failure that belongs to the flow's own subject. */
export const PRODUCT = "product";
/** Verdict for a failure that killed the flow before it tested anything. */
export const PREAMBLE = "preamble";
/** Verdict for a failure the DEVICE caused — the harness fell over. */
export const DEVICE = "device";
/** Platform arm used throughout the fixtures. */
export const ANDROID = "android";
/** Absolute path of the sign-in subflow in the in-memory fixture tree. */
export const SIGN_IN_PATH = "/m/subflows/sign-in.yaml";
/** Flow named by the known-intermittent fixture entry. */
export const FLAKY_FLOW = "saved-insight-save-and-unsave.yaml";

/** One `id:`/`text:` selector paired with the ceiling of its own gate. */
export interface Gate {
  readonly kind: string;
  readonly selector: string;
  readonly timeoutMs: number | null;
}

/** A parsed `<testcase>` row. */
export interface TestCaseRow {
  readonly file: string;
  readonly status: string;
  readonly durationSec: number;
  readonly message: string | null;
  readonly failed: boolean;
}

/** One text file read out of a run's `--debug-output` tree. */
export interface DebugArtifact {
  readonly path: string;
  readonly text: string;
}

/** The flow-name tokens a debug artifact may carry to belong to one flow. */
export interface FlowKeys {
  readonly flow: string;
  readonly keys: readonly string[];
}

/** Why a failure was attributed to the device rather than to the product. */
export interface DeviceSignal {
  readonly signal: string;
  readonly marker: string;
  readonly count: number;
  readonly baseline: number | null;
  readonly artifact: string;
}

/** Measured-rate annotation attached to a failure of a registered flow. */
export interface IntermittentAnnotation {
  readonly ratePercent: number;
  readonly failures: number;
  readonly runs: number;
  readonly measuredAt: string;
  readonly method: string;
  readonly ticket: string | null;
}

/** One classified failure. */
export interface Classification {
  readonly flow: string;
  readonly durationSec: number;
  readonly message: string;
  readonly kind: string;
  readonly gate: string | null;
  readonly subflow: string | null;
  readonly gateCeilingSec: number | null;
  readonly elapsedAtGateSec: number | null;
  readonly intermittent: IntermittentAnnotation | null;
  readonly device: DeviceSignal | null;
}

/** One rejected registry entry and the reason it earned no annotation. */
export interface RegistryDefect {
  readonly flow: string;
  readonly reason: string;
}

/** Outcome of validating the known-intermittent registry. */
export interface RegistryVerdict {
  readonly entries: readonly { readonly flow: string }[];
  readonly defects: readonly RegistryDefect[];
}

/** Reads a flow's source, or returns null when it is not on disk. */
export type Reader = (target: string) => string | null;

/** Options `classify` accepts. */
export interface ClassifyOptions {
  readonly maestroRoot: string;
  readonly readFile: Reader;
  readonly projectRoot?: string;
  readonly signInMarkers?: readonly string[];
  readonly knownIntermittent?: readonly unknown[];
  readonly platform?: string;
  readonly debugArtifacts?: readonly DebugArtifact[];
  readonly deviceFaultMarkers?: readonly string[];
  readonly deviceInstabilityMarkers?: readonly string[];
}

/** One device marker seen in the run but attributable to no single flow. */
export interface RunDeviceEvidence {
  readonly marker: string;
  readonly count: number;
  readonly artifact: string;
}

/** Everything one report's classification produced. */
export interface RunClassification {
  readonly failures: Classification[];
  readonly deviceRunEvidence: RunDeviceEvidence[];
}

/** The exported surface of the classifier module. */
export interface ClassifierModule {
  readonly extractGates: (source: string) => Gate[];
  readonly extractRunFlowTargets: (
    source: string,
    flowPath: string
  ) => string[];
  readonly resolveSubflows: (flowPath: string, readFile: Reader) => string[];
  readonly isPreambleSubflow: (
    flowPath: string,
    readFile: Reader,
    markers?: readonly string[]
  ) => boolean;
  readonly messageNamesSelector: (
    message: string | null,
    gate: { kind: string; selector: string }
  ) => boolean;
  readonly parseReport: (xml: string) => TestCaseRow[];
  readonly classify: (
    xml: string,
    options: ClassifyOptions
  ) => Classification[];
  readonly classifyRun: (
    xml: string,
    options: ClassifyOptions
  ) => RunClassification;
  readonly validateIntermittentRegistry: (entries: unknown) => RegistryVerdict;
  readonly flowArtifactKeys: (
    reportedFile: string,
    source: string | null
  ) => string[];
  readonly attributeArtifact: (
    artifactPath: string,
    flowKeys: readonly FlowKeys[]
  ) => string | null;
  readonly renderMarkdown: (result: {
    report: string;
    failures: readonly Classification[];
    defects: readonly RegistryDefect[];
    deviceRunEvidence?: readonly RunDeviceEvidence[];
  }) => string;
  readonly DEFAULT_SIGN_IN_MARKERS: readonly string[];
  readonly DEFAULT_DEVICE_FAULT_MARKERS: readonly string[];
  readonly DEFAULT_DEVICE_INSTABILITY_MARKERS: readonly string[];
}

/**
 * Load the shipped classifier from its template path.
 * @returns The classifier module
 */
export async function loadClassifier(): Promise<ClassifierModule> {
  const url = pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href;
  return (await import(url)) as unknown as ClassifierModule;
}

/**
 * Build a `readFile` over an in-memory `{ "/abs/path": source }` map.
 * @param files - Absolute path to source
 * @returns A reader over that map
 */
export function reader(files: Record<string, string>): Reader {
  return target =>
    Object.prototype.hasOwnProperty.call(files, target) ? files[target] : null;
}

/**
 * The failure text Maestro renders when a visibility gate times out.
 * @param selector - The `id:` selector the gate waited on
 * @returns The rendered assertion message
 */
export function assertionFor(selector: string): string {
  return `Assertion is false: id: ${selector} is visible`;
}

/**
 * A single-row JUnit report for one failing flow.
 * @param file - `file` attribute as the runner writes it
 * @param timeSec - Flow duration in seconds
 * @param message - Failure message
 * @returns JUnit XML
 */
export function failingReport(
  file: string,
  timeSec: number,
  message: string
): string {
  return (
    `<testcase file="${file}" time="${timeSec}" status="ERROR">` +
    `<failure>${message}</failure></testcase>`
  );
}

/**
 * The YAML lines of one `extendedWaitUntil` gate.
 * @param selector - The `id:` selector the gate waits on
 * @param timeoutMs - Ceiling in milliseconds, or omitted for a gate with none
 * @returns The gate's lines
 */
export function gateLines(selector: string, timeoutMs?: number): string[] {
  return [
    "- extendedWaitUntil:",
    "    visible:",
    `      id: '${selector}'`,
    ...(timeoutMs === undefined ? [] : [`    timeout: ${timeoutMs}`]),
  ];
}

/** A sign-in preamble: it gates on the landing screen, then taps sign-in. */
export const SIGN_IN = [
  "appId: ${MAESTRO_APP_ID}",
  "---",
  "- launchApp:",
  "    clearState: true",
  ...gateLines(LANDING_SCREEN, 90000),
  "- tapOn:",
  "    id: 'landing:sign-in'",
  "- tapOn: 'Go'",
  ...gateLines("confirm:back", 30000),
  "",
].join("\n");

/** A mid-scenario navigation helper — deliberately NOT a preamble. */
export const NAV_HELPER = [
  "appId: ${MAESTRO_APP_ID}",
  "---",
  ...gateLines("player:ready", 45000),
  "",
].join("\n");

/** A registry entry that carries everything the contract demands. */
export const MEASURED_ENTRY = {
  flow: FLAKY_FLOW,
  platforms: [ANDROID],
  measured: {
    failures: 2,
    runs: 7,
    measuredAt: "2026-08-10",
    method:
      "seven local runs on one emulator against build 0.0.327, arm-alternated",
  },
  ticket: "TUN-560",
};
