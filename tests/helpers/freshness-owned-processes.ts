/**
 * Birth-bound descendant observation for a freshly spawned detached fixture.
 * Process names never confer cleanup authority; ancestry and identity do.
 * @module tests/helpers/freshness-owned-processes
 */
import { spawn } from "node:child_process";
import {
  assertChildCompleted,
  ioLatencyBudgetMs,
} from "./io-latency-budget.js";

const CENSUS_LABEL = "birth-bound freshness fixture process census";
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

/** Native process identity observed while under the live fixture leader. */
export interface Identity {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  readonly birth: string;
  readonly state: string;
}

/**
 * Parse a complete census without granting authority to malformed prefixes.
 * @param output Complete native stdout.
 * @returns Native rows with the complete process birth time.
 */
function parseCensus(output: string): readonly Identity[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const fields = line.trim().split(/\s+/u);
      if (
        fields.length !== 9 ||
        fields.slice(0, 3).some(field => !/^\d+$/u.test(field))
      )
        throw new Error(`${CENSUS_LABEL}: invalid native row ${line}`);
      return {
        pid: Number(fields[0]),
        parent: Number(fields[1]),
        group: Number(fields[2]),
        birth: fields.slice(3, 8).join(" "),
        state: fields[8] ?? "",
      };
    });
}

/**
 * Read the bounded native census without blocking marker timers.
 * @returns Complete identities; timeout, truncation and native errors reject.
 */
function census(): Promise<readonly Identity[]> {
  const timeout = ioLatencyBudgetMs(1_000);
  const child = spawn("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,stat="], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    killSignal: "SIGKILL",
  });
  return new Promise((resolve, reject) => {
    // A cell over immutable snapshots of the live child's capture.
    const state: {
      current: {
        readonly output: string;
        readonly stderr: string;
        readonly bytes: number;
        readonly failed: boolean;
      };
    } = { current: { output: "", stderr: "", bytes: 0, failed: false } };
    /**
     * Reject incomplete evidence and cancel only this live child handle.
     * @param error Actual capture or native failure.
     */
    const fail = (error: Error): void => {
      if (state.current.failed) return;
      state.current = { ...state.current, failed: true };
      clearTimeout(deadline);
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      reject(error);
    };
    const deadline = setTimeout(() => {
      fail(new Error(`${CENSUS_LABEL}: timeout after ${timeout}ms`));
    }, timeout);
    /**
     * Both streams count against the same cap; never accept a valid prefix.
     * @param chunk Actual stream bytes.
     * @param stream Captured stream destination.
     */
    const capture = (chunk: Buffer, stream: "output" | "stderr"): void => {
      state.current = {
        ...state.current,
        bytes: state.current.bytes + chunk.length,
      };
      if (state.current.bytes > MAX_CAPTURE_BYTES) {
        fail(
          new Error(
            `${CENSUS_LABEL}: capture exceeded ${MAX_CAPTURE_BYTES} byte limit`
          )
        );
        return;
      }
      state.current = {
        ...state.current,
        [stream]: state.current[stream] + chunk.toString(),
      };
    };
    child.stdout.on("data", chunk => capture(chunk, "output"));
    child.stderr.on("data", chunk => capture(chunk, "stderr"));
    const nativeFailure = (error: Error): void =>
      fail(new Error(`${CENSUS_LABEL}: ${error.message}`));
    child.once("error", nativeFailure);
    child.stdout.once("error", nativeFailure);
    child.stderr.once("error", nativeFailure);
    child.once("close", (status, signal) => {
      clearTimeout(deadline);
      if (state.current.failed) return;
      try {
        assertChildCompleted({ signal }, CENSUS_LABEL);
        if (status !== 0)
          throw new Error(
            `${CENSUS_LABEL}: exit ${status}: ${state.current.stderr}`
          );
        resolve(parseCensus(state.current.output));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Share one pending census and preserve its first terminal failure.
 * @returns A reader that never turns failed observation into empty proof.
 */
function sharedCensus(): () => Promise<readonly Identity[]> {
  // Cells: the one pending census, and the first terminal failure.
  const inFlight: { current: Promise<readonly Identity[]> | undefined } = {
    current: undefined,
  };
  const failure: { current: unknown } = { current: undefined };
  return async (): Promise<readonly Identity[]> => {
    if (failure.current !== undefined) throw failure.current;
    if (inFlight.current) return inFlight.current;
    inFlight.current = census();
    try {
      return await inFlight.current;
    } catch (error) {
      failure.current = error;
      throw error;
    } finally {
      inFlight.current = undefined;
    }
  };
}

/**
 * Track actual descendants of one fresh detached fixture.
 * @param leader Detached process launched by this exact fixture.
 * @returns Read-only observations and identity-checked emergency cleanup.
 */
export function ownedProcesses(leader: number): {
  readonly observe: () => Promise<void>;
  readonly active: () => Promise<readonly number[]>;
  readonly drain: () => Promise<void>;
  readonly captured: () => readonly number[];
  readonly identities: () => readonly Identity[];
} {
  // A cell over immutable maps: each observation replaces the ownership map.
  const owned: { current: ReadonlyMap<number, Identity> } = {
    current: new Map(),
  };
  const read = sharedCensus();
  /**
   * Extend ownership only through matching observed parent identities.
   * @returns Completion of the current descendant observation.
   */
  const observe = async (): Promise<void> => {
    const processes = await read();
    const root = processes.find(item => item.pid === leader);
    if (!owned.current.has(leader)) {
      if (!root || root.group !== leader || root.parent !== process.pid)
        throw new Error(
          `${CENSUS_LABEL}: fresh detached leader identity unavailable`
        );
      owned.current = new Map([...owned.current, [root.pid, root]]);
    }
    const parents = new Set(
      processes
        .filter(
          item =>
            owned.current.get(item.pid)?.birth === item.birth &&
            owned.current.get(item.pid)?.group === item.group
        )
        .map(item => item.pid)
    );
    /**
     * Walk the observed tree outward from the owned parents. Each step adds at
     * least one new pid or stops, so it is bounded by the census size.
     * @param known - Pids already proven owned.
     * @param found - Descendant identities discovered so far.
     * @returns Every descendant reachable from the owned parents.
     */
    const descendants = (
      known: ReadonlySet<number>,
      found: readonly Identity[]
    ): readonly Identity[] => {
      const newlyOwned = processes.filter(
        item => known.has(item.parent) && !known.has(item.pid)
      );
      return newlyOwned.length === 0
        ? found
        : descendants(
            new Set([...known, ...newlyOwned.map(item => item.pid)]),
            [...found, ...newlyOwned]
          );
    };
    owned.current = new Map([
      ...owned.current,
      ...descendants(parents, []).map(item => [item.pid, item] as const),
    ]);
  };
  /**
   * A remembered PID proves life only when birth and group still match.
   * @returns Still-live matching identities, excluding terminated zombies.
   */
  const live = async (): Promise<readonly Identity[]> =>
    (await read()).filter(item => {
      const prior = owned.current.get(item.pid);
      return (
        prior?.birth === item.birth &&
        prior.group === item.group &&
        !item.state.startsWith("Z")
      );
    });
  return {
    observe,
    active: async () => (await live()).map(item => item.pid),
    captured: () => [...owned.current.keys()],
    identities: () => [...owned.current.values()],
    drain: async () => {
      for (const group of new Set((await live()).map(item => item.group))) {
        // Re-read just before signaling, and require a live matching member.
        if (!(await live()).some(item => item.group === group)) continue;
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          /* terminal race */
        }
      }
    },
  };
}
