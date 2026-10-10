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
    const state = { output: "", stderr: "", bytes: 0, failed: false };
    /* eslint-disable functional/immutable-data -- bounded event capture records the live child's evidence and terminal state */
    /**
     * Reject incomplete evidence and cancel only this live child handle.
     * @param error Actual capture or native failure.
     */
    const fail = (error: Error): void => {
      if (state.failed) return;
      state.failed = true;
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
      state.bytes += chunk.length;
      if (state.bytes > MAX_CAPTURE_BYTES) {
        fail(
          new Error(
            `${CENSUS_LABEL}: capture exceeded ${MAX_CAPTURE_BYTES} byte limit`
          )
        );
        return;
      }
      state[stream] += chunk.toString();
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
      if (state.failed) return;
      try {
        assertChildCompleted({ signal }, CENSUS_LABEL);
        if (status !== 0)
          throw new Error(`${CENSUS_LABEL}: exit ${status}: ${state.stderr}`);
        resolve(parseCensus(state.output));
      } catch (error) {
        reject(error);
      }
    });
    /* eslint-enable functional/immutable-data -- end bounded event capture */
  });
}

/**
 * Share one pending census and preserve its first terminal failure.
 * @returns A reader that never turns failed observation into empty proof.
 */
function sharedCensus(): () => Promise<readonly Identity[]> {
  const state: {
    inFlight?: Promise<readonly Identity[]> | undefined;
    failure?: unknown;
  } = {};
  return async (): Promise<readonly Identity[]> => {
    /* eslint-disable functional/immutable-data -- one live census and its terminal failure are shared by all concurrent callers */
    if (state.failure !== undefined) throw state.failure;
    if (state.inFlight) return state.inFlight;
    state.inFlight = census();
    try {
      return await state.inFlight;
    } catch (error) {
      state.failure = error;
      throw error;
    } finally {
      state.inFlight = undefined;
    }
    /* eslint-enable functional/immutable-data -- end shared census state updates */
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
  const owned = new Map<number, Identity>();
  const read = sharedCensus();
  /**
   * Extend ownership only through matching observed parent identities.
   * @returns Completion of the current descendant observation.
   */
  const observe = async (): Promise<void> => {
    const processes = await read();
    const root = processes.find(item => item.pid === leader);
    if (!owned.has(leader)) {
      if (!root || root.group !== leader || root.parent !== process.pid)
        throw new Error(
          `${CENSUS_LABEL}: fresh detached leader identity unavailable`
        );
      // eslint-disable-next-line functional/immutable-data -- pin the freshly spawned detached child's birth and parent before extending ownership
      owned.set(root.pid, root);
    }
    const parents = new Set(
      processes
        .filter(
          item =>
            owned.get(item.pid)?.birth === item.birth &&
            owned.get(item.pid)?.group === item.group
        )
        .map(item => item.pid)
    );
    // eslint-disable-next-line functional/no-let -- bounded ancestry traversal advances until no new child remains
    for (let pass = 0; pass < processes.length; pass += 1) {
      const newlyOwned = processes.filter(
        item => parents.has(item.parent) && !parents.has(item.pid)
      );
      for (const item of newlyOwned) {
        // eslint-disable-next-line functional/immutable-data -- live process ownership extends only from matching observed parents
        owned.set(item.pid, item);
        // eslint-disable-next-line functional/immutable-data -- this bounded traversal records its discovered parents
        parents.add(item.pid);
      }
      if (!newlyOwned.length) break;
    }
  };
  /**
   * A remembered PID proves life only when birth and group still match.
   * @returns Still-live matching identities, excluding terminated zombies.
   */
  const live = async (): Promise<readonly Identity[]> =>
    (await read()).filter(item => {
      const prior = owned.get(item.pid);
      return (
        prior?.birth === item.birth &&
        prior.group === item.group &&
        !item.state.startsWith("Z")
      );
    });
  return {
    observe,
    active: async () => (await live()).map(item => item.pid),
    captured: () => [...owned.keys()],
    identities: () => [...owned.values()],
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
