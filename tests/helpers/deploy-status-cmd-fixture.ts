/**
 * Shared fixture for the deploy-status-sync command test files: a recording
 * fake adapter, config writer, and fixture-directory harness. Split out so
 * the cmd suites (validation, execution, output) stay under the max-lines
 * budget without duplicating plumbing. Callback-based by design: this module
 * lives outside the `*.test.ts` lint relaxation, so all mutable accumulation
 * (write logs, sink lines) is owned by the calling test file.
 * @module tests/helpers/deploy-status-cmd-fixture
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TrackerAdapter } from "../../src/cli/deploy-status-adapter.js";
import type { DeployStatusSyncDependencies } from "../../src/cli/deploy-status-sync-cmd.js";
import type { TrackerItemState } from "../../src/core/deploy-status-transition.js";

/** Canonical ref used across the cmd suites. */
export const REF_101 = "acme/app#101";
/** Commit range used across the cmd suites. */
export const RANGE = "abc..def";
/** Adapter method name: transition write. */
export const TRANSITION = "transitionToDone";
/** Adapter method name: managed-comment write. */
export const UPSERT = "upsertManagedComment";
/** Adapter method name: native closure write. */
export const CLOSE_NATIVELY = "closeNatively";

/** Default github fixture config with a three-env ladder. */
export const DEFAULT_CONFIG = {
  tracker: "github",
  github: { org: "acme", repo: "app" },
  deploy: {
    branches: { dev: "dev", staging: "staging", production: "main" },
  },
};

/** One recorded adapter write. */
export interface WriteCall {
  readonly method: string;
  readonly ref: string;
  readonly detail?: string;
}

/** Behavior options for {@link fakeAdapter}. */
export interface FakeAdapterOptions {
  /** Sink receiving each successful write, in call order */
  readonly onWrite: (write: WriteCall) => void;
  /** Refs whose transition should throw */
  readonly failTransitionRefs?: readonly string[];
}

/**
 * Build a fake adapter that reports writes to the caller-owned sink.
 * @param states - Item state per ref
 * @param options - Write sink and failure toggles
 * @returns The fake adapter
 */
export function fakeAdapter(
  states: Readonly<Record<string, TrackerItemState>>,
  options: FakeAdapterOptions
): TrackerAdapter {
  const failTransitionRefs = options.failTransitionRefs ?? [];
  return {
    fetchItemState: ref => {
      const state = states[ref];
      return state === undefined
        ? Promise.reject(new Error(`no state for ${ref}`))
        : Promise.resolve(state);
    },
    transitionToDone: (ref, doneStatus) => {
      if (failTransitionRefs.includes(ref)) {
        return Promise.reject(new Error(`transition failed for ${ref}`));
      }
      options.onWrite({ method: TRANSITION, ref, detail: doneStatus });
      return Promise.resolve();
    },
    upsertManagedComment: (ref, body) => {
      options.onWrite({ method: UPSERT, ref, detail: body });
      return Promise.resolve("created" as const);
    },
    closeNatively: ref => {
      options.onWrite({ method: CLOSE_NATIVELY, ref });
      return Promise.resolve();
    },
  };
}

/**
 * Write the fixture .lisa.config.json.
 * @param cwd - Fixture directory
 * @param value - Config object (or raw string)
 */
export async function writeConfig(cwd: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(cwd, ".lisa.config.json"),
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8"
  );
}

/** Fixture directory handle. */
export interface FixtureDir {
  /** Directory containing .lisa.config.json */
  readonly cwd: string;
  /** Remove the fixture directory */
  readonly dispose: () => Promise<void>;
}

/**
 * Create a temp fixture directory with the config written into it.
 * @param config - Config object or raw string (defaults to the github ladder)
 * @returns The fixture directory handle
 */
export async function createFixtureDir(
  config: unknown = DEFAULT_CONFIG
): Promise<FixtureDir> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "lisa-dss-cmd-"));
  await writeConfig(cwd, config);
  return { cwd, dispose: () => rm(cwd, { recursive: true, force: true }) };
}

/** Inputs for {@link makeDeps}. */
export interface MakeDepsOptions {
  /** Fixture directory */
  readonly cwd: string;
  /** Adapter returned by the injected factory */
  readonly adapter: TrackerAdapter;
  /** Extracted refs to report (defaults to [{@link REF_101}]) */
  readonly refs?: readonly string[];
  /** Log sink (caller-owned accumulation) */
  readonly log: (message: string) => void;
  /** Error sink (caller-owned accumulation) */
  readonly error: (message: string) => void;
}

/**
 * Build injectable cmd dependencies around a fake adapter and static refs.
 * @param options - Directory, adapter, refs, and caller-owned sinks
 * @returns Cmd dependencies
 */
export function makeDeps(
  options: MakeDepsOptions
): DeployStatusSyncDependencies {
  return {
    cwd: options.cwd,
    log: options.log,
    error: options.error,
    extractRefs: () =>
      Promise.resolve({
        refs: options.refs ?? [REF_101],
        skipped: [],
        headSha: "def456",
      }),
    adapterFactory: () => options.adapter,
  };
}
