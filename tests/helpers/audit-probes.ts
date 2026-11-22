/**
 * Sample probe entries for the suites that check, render or rely on the
 * `probes` section of an audit report.
 *
 * A probe is the record of one harmless read the audit tried against an
 * outside system. No suite ever makes that read: every entry here is written
 * by hand, the way a report would hold it, and names a repository that does
 * not exist.
 *
 * Nothing shaped like a credential is written in this file or in any suite.
 * A suite that needs one asks {@link fakeCredential} for it, which assembles
 * the text when the test runs (CodySwannGT/lisa#4981).
 * @module tests/helpers/audit-probes
 */
import {
  amendFinding,
  type FindingAddress,
  type SampleReport,
} from "./control-audit-report.js";

/** One probe as plain JSON, so a suite can also write a malformed one. */
export type SampleProbe = Readonly<Record<string, unknown>>;

/** The requirement that is always decided on the hosting platform. */
export const AUTHORITY: FindingAddress = { criterion: "AC5.1", scope: "." };

/** The id the probe of the hosting platform is always recorded under. */
export const PLATFORM = "hosting-platform";

/** What the hosting platform is, in plain words. */
export const PLATFORM_SYSTEM =
  "GitHub, where this repository is hosted and its merge settings are kept";

/** The access a read of the hosting platform needs, in plain words. */
export const PLATFORM_ACCESS =
  "the GitHub command-line tool (gh) signed in with an account that can read this repository";

/** What the platform's own tool says when nobody is signed in. */
export const SIGNED_OUT_ERROR =
  "To get started with GitHub CLI, please run:  gh auth login";

/** The read of the merge settings, as a probe records it. */
export const PLATFORM_REQUEST =
  "GET repos/example/widgets/rulesets; GET repos/example/widgets";

/**
 * A probe that got an answer.
 * @param change - Fields to set on it
 * @returns The probe
 */
export function reachableProbe(change: SampleProbe = {}): SampleProbe {
  return {
    id: PLATFORM,
    system: PLATFORM_SYSTEM,
    needed_by: [AUTHORITY],
    result: "reachable",
    request: PLATFORM_REQUEST,
    ...change,
  };
}

/**
 * A probe whose read was refused.
 * @param change - Fields to set on it
 * @returns The probe
 */
export function unreachableProbe(change: SampleProbe = {}): SampleProbe {
  return {
    id: PLATFORM,
    system: PLATFORM_SYSTEM,
    needed_by: [AUTHORITY],
    result: "unreachable",
    request: PLATFORM_REQUEST,
    observed_error: SIGNED_OUT_ERROR,
    access_needed: PLATFORM_ACCESS,
    ...change,
  };
}

/**
 * A probe that was never tried.
 * @param change - Fields to set on it
 * @returns The probe
 */
export function notAttemptedProbe(change: SampleProbe = {}): SampleProbe {
  return {
    id: PLATFORM,
    system: PLATFORM_SYSTEM,
    needed_by: [AUTHORITY],
    result: "not-attempted",
    reason:
      "No command on this machine can read that platform's merge settings.",
    access_needed: PLATFORM_ACCESS,
    ...change,
  };
}

/**
 * Give a report its probes.
 * @param report - The report to start from
 * @param probes - The probes, valid or not
 * @returns A new report; the original is untouched
 */
export function withProbes(
  report: SampleReport,
  probes: readonly unknown[]
): SampleReport {
  return { ...report, probes };
}

/**
 * Say, on one finding, that it could not be checked for want of access.
 * @param report - The report to start from
 * @param address - Which finding waits on the outside system
 * @param access - The access that is needed, as the probe states it
 * @returns A new report; the original is untouched
 */
export function waitingOn(
  report: SampleReport,
  address: FindingAddress = AUTHORITY,
  access: string = PLATFORM_ACCESS
): SampleReport {
  return amendFinding(report, address, {
    state: "unknown",
    what: `Lisa could not reach ${PLATFORM_SYSTEM}: ${SIGNED_OUT_ERROR}`,
    why: "Until the settings can be read, nobody knows whether a change can be merged without its checks.",
    next: `To check this requirement an agent needs ${access}.`,
    mechanisms: [],
  });
}

/** The characters a made-up credential is drawn from, by character code. */
const RANGES: readonly (readonly [number, number])[] = [
  [48, 10],
  [65, 26],
  [97, 26],
];

/**
 * Make up text that is shaped like a credential and is not one.
 *
 * The text is produced by a fixed arithmetic sequence when the test runs, so
 * a suite gets the same value every time and no file holds it. It mixes
 * digits, capitals and small letters the way a real token does.
 * @param length - How many characters to produce
 * @param seed - Start of the sequence; change it to get different text
 * @returns The made-up text
 */
export function fakeCredential(length = 40, seed = 11): string {
  const alphabet = RANGES.flatMap(([first, count]) =>
    Array.from({ length: count }, (_unused, index) =>
      String.fromCodePoint(first + index)
    )
  );
  return Array.from({ length }, (_unused, index) => {
    const step = (seed + index) * (seed + index + 17) + index * 31;
    return alphabet[step % alphabet.length] ?? "";
  }).join("");
}
