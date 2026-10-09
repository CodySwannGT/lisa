/**
 * Birth-bound descendant observation for a freshly spawned detached fixture.
 * Process names never confer cleanup authority; ancestry and identity do.
 * @module tests/helpers/freshness-owned-processes
 */
import { boundedSpawnSync } from "./io-latency-budget.js";

/** Native process identity observed while under the live fixture leader. */
interface Identity {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  readonly birth: string;
  readonly state: string;
}

/**
 * Collect native identities without selecting or signaling by process name.
 * @returns Native rows with the complete process birth time.
 */
function census(): readonly Identity[] {
  return boundedSpawnSync({
    command: "/bin/ps",
    args: ["-axo", "pid=,ppid=,pgid=,lstart=,stat="],
    baseMs: 1_000,
    label: "birth-bound freshness fixture process census",
  })
    .stdout.split("\n")
    .flatMap(line => {
      const fields = line.trim().split(/\s+/u);
      return fields.length === 9
        ? [
            {
              pid: Number(fields[0]),
              parent: Number(fields[1]),
              group: Number(fields[2]),
              birth: fields.slice(3, 8).join(" "),
              state: fields[8] ?? "",
            },
          ]
        : [];
    });
}

/**
 * Track the actual descendants of one new fixture, including supervisor jobs.
 * @param leader Detached process launched by this exact fixture.
 * @returns Read-only observations and identity-checked emergency cleanup.
 */
export function ownedProcesses(leader: number): {
  readonly observe: () => void;
  readonly active: () => readonly number[];
  readonly drain: () => void;
  readonly captured: () => readonly number[];
} {
  const owned = new Map<number, Identity>();
  /** Extend ownership only through currently matching observed parent identities. */
  const observe = (): void => {
    const processes = census();
    const parents = new Set(
      processes
        .filter(
          item =>
            (item.pid === leader && !owned.has(leader)) ||
            owned.get(item.pid)?.birth === item.birth
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
    const root = processes.find(item => item.pid === leader);
    // eslint-disable-next-line functional/immutable-data -- pin the initial leader birth exactly once
    if (root && !owned.has(leader)) owned.set(root.pid, root);
  };
  /**
   * A remembered PID proves life only when birth and group still match.
   * @returns Still-live matching identities, excluding terminated zombies.
   */
  const live = (): readonly Identity[] =>
    census().filter(item => {
      const prior = owned.get(item.pid);
      return (
        prior?.birth === item.birth &&
        prior.group === item.group &&
        !item.state.startsWith("Z")
      );
    });
  return {
    observe,
    active: () => live().map(item => item.pid),
    captured: () => [...owned.keys()],
    drain: () => {
      for (const group of new Set(live().map(item => item.group))) {
        // Re-read just before signaling, and require a live matching member.
        if (!live().some(item => item.group === group)) continue;
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          /* terminal race */
        }
      }
    },
  };
}
