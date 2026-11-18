/**
 * What the canary suites of `lisa controls attest` share
 * (CodySwannGT/lisa#4997).
 *
 * Every canary case runs against the in-memory platform in
 * `./fake-canary-platform.ts`, with a fixed run identifier, a pause that
 * takes no time, and a stand-in for the process's termination signals, so
 * nothing a case does reaches a real platform or the real process.
 * @module tests/unit/controls/support/canary-run
 */
import { expect } from "vitest";

import type { SignalSource } from "../../../../src/controls/canary-lifecycle.js";
import type { PullRequestDependencies } from "../../../../src/controls/pull-request-settle.js";
import { CONTROL_AUDIT_FIXTURE_FILES } from "../../../helpers/control-audit-fixtures.js";
import { F_NONE_SOURCE } from "../../../helpers/control-proofs.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import {
  fakeCanaryPlatform,
  type FakeCanaryOptions,
  type FakeCanaryPlatform,
} from "./fake-canary-platform.js";
import type { RecordedRequest } from "./fake-github.js";
import { REPO } from "./protect-fixture.js";
import {
  PULL_ONLY_CHECK,
  settle,
  type Settled,
  type SettleOptions,
} from "./pull-request-run.js";

/** The identifier every case's run is given. */
export const RUN_ID = "run0000a";

/** A file of the default branch that no proof touches. */
export const UNTOUCHED_FILE = "README.md";

/** The files the in-memory default branch holds. */
export const PLATFORM_FILES: Readonly<Record<string, string>> = {
  [F_NONE_SOURCE]: CONTROL_AUDIT_FIXTURE_FILES["F-none"][F_NONE_SOURCE] ?? "",
  [UNTOUCHED_FILE]: "# A fixture repository\n",
};

/** Every way a request could accept a pull request into its base branch. */
export const MERGE_REQUEST =
  /\/merges?(?:[/?]|$)|merge_method|mergePullRequest|enablePullRequestAutoMerge|update-branch/u;

/** A stand-in for the process's termination signals. */
export interface FakeSignals {
  readonly source: SignalSource;
  /** Deliver a signal to whatever is listening for it. */
  readonly emit: (signal: NodeJS.Signals) => void;
  /** The signals something is listening for now. */
  readonly listening: () => readonly string[];
  /** The signals the run asked to end the process with. */
  readonly terminated: readonly string[];
  readonly terminate: (signal: NodeJS.Signals) => void;
}

/**
 * Build a stand-in for the process's termination signals.
 * @returns The stand-in
 */
export function fakeSignals(): FakeSignals {
  const handlers: { signal: string; handler: () => void }[] = [];
  const terminated: string[] = [];
  return {
    source: {
      on: (signal, handler) => {
        handlers.push({ signal, handler });
      },
      off: (signal, handler) => {
        const index = handlers.findIndex(
          held => held.signal === signal && held.handler === handler
        );
        if (index !== -1) handlers.splice(index, 1);
      },
    },
    emit: signal => {
      handlers
        .filter(held => held.signal === signal)
        .forEach(held => {
          held.handler();
        });
    },
    listening: () => handlers.map(held => held.signal),
    terminated,
    terminate: signal => {
      terminated.push(signal);
    },
  };
}

/**
 * Build the in-memory platform: one repository whose default branch
 * requires the pull-request check and holds the fixture's source file.
 * @param overrides - How it differs
 * @returns The platform
 */
export function canaryPlatform(
  overrides: Partial<FakeCanaryOptions> = {}
): FakeCanaryPlatform {
  return fakeCanaryPlatform({
    repo: REPO,
    required: [PULL_ONLY_CHECK],
    files: PLATFORM_FILES,
    ...overrides,
  });
}

/** How a canary case differs from the default. */
export interface CanaryCaseOptions extends SettleOptions {
  readonly signals?: FakeSignals;
}

/**
 * Settle a declaration's pull-request moment with canaries asked for.
 * @param gates - The gates block
 * @param platform - The in-memory platform
 * @param options - How the case differs from the default
 * @returns The settled run
 */
export function settleWithCanaries(
  gates: GatesBlock,
  platform: FakeCanaryPlatform,
  options: CanaryCaseOptions = {}
): Promise<Settled> {
  const signals = options.signals ?? fakeSignals();
  const dependencies: PullRequestDependencies = {
    runId: () => RUN_ID,
    sleep: () => Promise.resolve(),
    signals: signals.source,
    terminate: signals.terminate,
    ...options.dependencies,
  };
  return settle(gates, platform.gh, {
    ...options,
    inputs: { canaries: true, ...options.inputs },
    dependencies,
  });
}

/**
 * Write a request as one line, with commit ids replaced by a fixed word.
 * @param request - The request
 * @returns For example `GET repos/o/r/git/trees/<sha>`
 */
export function line(request: RecordedRequest): string {
  return `${request.method} ${request.path.replaceAll(/[0-9a-f]{40}/gu, "<sha>")}`;
}

/**
 * Assert that a platform holds nothing a canary run made: no branch but the
 * default one, no open pull request, and nothing merged.
 * @param platform - The in-memory platform
 */
export function expectNothingLeft(platform: FakeCanaryPlatform): void {
  expect(platform.branches()).toEqual(["main"]);
  expect(platform.pulls().filter(pull => pull.state === "open")).toEqual([]);
  expect(platform.pulls().filter(pull => pull.merged)).toEqual([]);
}

/**
 * Assert that no request in a log could accept a pull request.
 * @param log - The recorded requests
 */
export function expectNoMerge(log: readonly RecordedRequest[]): void {
  expect(log.filter(request => MERGE_REQUEST.test(request.path))).toEqual([]);
  // A canary's own words say "do not merge", so the body is searched for the
  // fields that ask for one, not for the word.
  expect(
    log.filter(request =>
      /"(?:merge_method|auto_merge|merged|commit_title)"/u.test(
        JSON.stringify(request.body ?? {})
      )
    )
  ).toEqual([]);
  // Accepting a pull request is a PUT. A canary run sends none at all.
  expect(log.filter(request => request.method === "PUT")).toEqual([]);
}
