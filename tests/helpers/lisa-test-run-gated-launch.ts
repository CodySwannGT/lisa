/** Gated real-process launch and progressive scratch authority observation. */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
  captureExactCleanupAuthority,
  type ExactCleanupAuthority,
} from "./lisa-test-run-exact-process-cleanup.js";
import {
  OPAQUE_CONTROL,
  REPO_ROOT,
  SCRATCH_NAMESPACE,
  TEST_RUN_SOURCE_ARGS,
} from "./lisa-test-run-process.js";

const { env: PROCESS_ENVIRONMENT } = process;

/** Terminal event attached before a gated child is released. */
export interface GatedTerminal {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly at: number;
}
/** A wrapper whose original PID identity is published before GO. */
export interface GatedLaunch {
  readonly child: ReturnType<typeof spawn>;
  readonly marker: string;
  readonly baseline: ReadonlySet<string>;
  readonly terminal: Promise<GatedTerminal>;
  readonly authority: ExactCleanupAuthority;
}
/** Fully observed run returned only after all teardown authority is published. */
export interface GatedWaitingRun {
  readonly child: ReturnType<typeof spawn>;
  readonly marker: string;
  readonly root: string;
  readonly payloadPid: number;
  readonly companionPids: readonly number[];
  readonly terminal: Promise<GatedTerminal>;
}
/** Callback that atomically publishes expanded original authority. */
export type PublishGatedAuthority = (authority: ExactCleanupAuthority) => void;

/**
 * List the owned namespace without creating it.
 * @param base - Test-owned platform temp root
 * @returns Sorted namespace basenames
 */
function namespaceNames(base: string): readonly string[] {
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  return fs.existsSync(namespace)
    ? fs
        .readdirSync(namespace)
        .toSorted((left, right) => left.localeCompare(right))
    : [];
}

/**
 * Spawn one stdin-gated shell and publish its PID/birth before GO.
 * @param base - Test-owned platform temp root
 * @param markerName - Invocation-unique payload marker
 * @param publish - Immutable teardown-authority registry
 * @param fault - Optional production reaper fault seam
 * @param payloadMode - Waiting payload or adversarial extra owned descendant
 * @returns Registered launch handle with a preattached close promise
 */
export async function createGatedTestRunLaunch(
  base: string,
  markerName: string,
  publish: PublishGatedAuthority,
  fault?: "pause-recovery-before-drain",
  payloadMode: "extra-owned-process" | "wait" = "wait"
): Promise<GatedLaunch> {
  const marker = path.join(base, markerName);
  const child = spawn(
    "/bin/sh",
    [
      "-c",
      'IFS= read -r gate || exit 74\n[ "$gate" = GO ] || exit 75\nexec "$@"',
      "lisa-test-run-gate",
      process.execPath,
      ...TEST_RUN_SOURCE_ARGS,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...PROCESS_ENVIRONMENT,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_RUN_MARKER: marker,
        LISA_TEST_RUN_MODE: payloadMode,
        LISA_TEST_SCRATCH_SUITE: "lisa",
        LISA_TEST_RUN_OPAQUE_CONTROL: OPAQUE_CONTROL,
        ...(fault === undefined ? {} : { LISA_TEST_RUN_TEST_FAULT: fault }),
      },
      stdio: ["pipe", "ignore", "ignore"],
    }
  );
  const terminal = new Promise<GatedTerminal>(resolve => {
    child.once("exit", (code, signal) =>
      resolve({ code, signal, at: performance.now() })
    );
  });
  const authority = captureExactCleanupAuthority({ child });
  publish(authority);
  if (
    authority.capture === undefined ||
    authority.capture.failures.length !== 0 ||
    authority.capture.identities.length !== 1
  ) {
    child.stdin?.end();
    await terminal;
    throw new AggregateError(
      authority.capture?.failures ?? [
        new Error("Shell birth was not captured"),
      ],
      "Could not capture gated launcher authority"
    );
  }
  return {
    child,
    marker,
    baseline: new Set(namespaceNames(base)),
    terminal,
    authority,
  };
}
