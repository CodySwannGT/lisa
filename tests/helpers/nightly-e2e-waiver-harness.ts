/**
 * Typed view of the guard's §6.4 waiver half — the durable record and the
 * merge-time re-derivation.
 *
 * A separate module from `nightly-e2e-gate-harness` for the same reason the
 * reporting and selection halves are: the gate harness is at its line budget,
 * and a shared file that everything appends to is how two suites end up
 * disagreeing about what a fixture means. `GateModule` extends this, so a suite
 * still imports one thing.
 *
 * Specification: `docs/nightly-e2e-gate.md` §6.4.
 * @module tests/helpers/nightly-e2e-waiver-harness
 */
import type { BypassDecision } from "./nightly-e2e-gate-harness.js";

/** The `Nightly-E2E-Bypass: <TICKET> <reason>` trailer, parsed. */
export interface WaiverTrailer {
  readonly ticket: string;
  readonly reason: string | null;
}

/** What `observeWaiver` saw on the live pull request. */
export interface WaiverObservation {
  readonly bypass: BypassDecision | null;
  readonly trailer: WaiverTrailer | null;
  /** `null` means the pull request was unreadable — not "no label". */
  readonly labelPresent: boolean | null;
}

/**
 * What a merge-time waiver re-derivation answers.
 *
 * `state` and `record` are separate fields because a waiver can be REFUSED and
 * still need a record: an expired waiver shipped something, and "what shipped
 * on a waiver, and why" is exactly the question that goes unanswerable when the
 * reaper strips the only label indexing it.
 */
export interface WaiverVerdict {
  readonly state: string;
  readonly prNumber: number | null;
  readonly repo: string | null;
  readonly label: string;
  readonly gateContext: string;
  readonly derivedAt: string;
  readonly waiver: BypassDecision | null;
  readonly trailer: WaiverTrailer | null;
  readonly labelPresent: boolean | null;
  readonly record: string | null;
}

/** The §6.4 exports, as the waiver suites consume them. */
export interface WaiverModule {
  /** The four merge-time waiver states. */
  readonly WAIVER_STATES: Readonly<Record<string, string>>;
  /** The search key the durable record is found by, after the label is gone. */
  readonly WAIVER_RECORD_MARKER: string;
  readonly WAIVER_RECORD_BEGIN: string;
  readonly WAIVER_RECORD_END: string;
  parseWaiverTrailer(prBody: string | null | undefined): WaiverTrailer | null;
  classifyWaiver(bypass: BypassDecision | null | undefined): string;
  formatWaiverRecord(result: WaiverVerdict): string;
  formatWaiverVerdict(result: WaiverVerdict): string;
  observeWaiver(
    api: Record<string, unknown>,
    request: Record<string, unknown>,
    wait?: () => Promise<void>
  ): Promise<WaiverObservation>;
  resolveWaiverSettings(env: Record<string, string | undefined>): unknown;
  runWaiverVerdict(
    env: Record<string, string | undefined>,
    wait?: () => Promise<void>
  ): Promise<WaiverVerdict>;
  /** The CLI arm, exported so its EXIT CODE — the merge contract — is testable. */
  waiverVerdict(asJson: boolean): Promise<void>;
}
