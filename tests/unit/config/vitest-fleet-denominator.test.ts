/**
 * Tests for the honest denominator underneath the fleet cap.
 *
 * `discoverFleetConcurrency` returned **6 while 13 vitest main processes were
 * running** (CodySwannGT/lisa#3941). The undercount changed nothing while the
 * divisor was saturated — 6 and 13 both clamp to two workers — which is exactly
 * why it had to be fixed in the same change as the saturation: any repair that
 * makes the denominator matter again inherits a denominator that undercounts
 * hardest when the fleet is largest.
 *
 * Three of the four named causes are addressed here and pinned by a case each:
 * differing `TMPDIR` values splitting the fleet across namespaces, the
 * 4,096-entry truncation, and this run's own root being counted as a sibling.
 * The fourth — non-vitest load such as builds, lint and typecheck — is out of
 * reach of a run-root census by construction and is deliberately not simulated
 * here; a test that pretended otherwise would assert a capability the code does
 * not have.
 * @module tests/unit/config/vitest-fleet-denominator
 */

import { describe, expect, it } from "vitest";

import { discoverFleetConcurrency } from "../../../src/configs/vitest/base.js";
import { readFleetRunRoots } from "../../../src/configs/vitest/fleet-admission.js";

/** This test process, so a fixture can exclude it the way discovery does. */
const SELF = 4242;

/**
 * A run root as the supervised runner actually names them.
 * @param pid - Owning process id encoded in the basename.
 * @param startedAt - Creation epoch encoded in the basename.
 * @returns One `run-<pid>-<epoch>-<suffix>` basename.
 */
const root = (pid: number, startedAt = 1788467384058): string =>
  `run-${String(pid)}-${String(startedAt)}-57071c2a`;

/**
 * Discovery against stated namespaces rather than the real one.
 * @param namespaces - Directory to entries, as the machine would list them.
 * @param alivePids - Which pids the kernel probe reports as live.
 * @param selfBasename - This run's own root basename, when supervised.
 * @returns The discovered fleet size.
 */
const discoverAcross = (
  namespaces: Readonly<Record<string, readonly string[]>>,
  alivePids: readonly number[],
  selfBasename?: string
): number =>
  discoverFleetConcurrency({
    namespaceDirs: () => Object.keys(namespaces),
    readDir: (dir: string) => namespaces[dir] ?? [],
    isAlive: (pid: number) => alivePids.includes(pid),
    self: SELF,
    selfBasename: () => selfBasename,
  });

describe("the denominator is honest when it matters", () => {
  it("counts a sibling that registered under a different TMPDIR", () => {
    // The largest of the four undercount causes #3941 names, and the one that
    // produced 6 against 13 live runs: `os.tmpdir()` is TMPDIR when it is set,
    // so two agents with different values enumerate different per-user temp
    // directories and each sees only its own cohort.
    const observed = discoverAcross(
      {
        "/nowhere/tmpdir-a/lisa-scratch": [root(11)],
        "/nowhere/tmpdir-b/lisa-scratch": [root(22), root(33)],
      },
      [11, 22, 33]
    );

    expect(observed).toBe(4);
  });

  it("survives a namespace that only one of the candidates has", () => {
    // One unreadable directory must not erase the count from a readable one.
    const observed = discoverFleetConcurrency({
      namespaceDirs: () => ["/present", "/absent"],
      readDir: (dir: string) => {
        if (dir === "/absent") throw new Error("ENOENT");
        return [root(11)];
      },
      isAlive: (pid: number) => pid === 11,
      self: SELF,
      selfBasename: () => undefined,
    });

    expect(observed).toBe(2);
  });

  it("counts run roots past the old 4,096-entry truncation point", () => {
    // The namespace has been measured holding 3,730 entries (#3032), so the
    // truncation was reachable rather than theoretical — and it undercounted
    // hardest exactly when the fleet was largest.
    const filler = Array.from(
      { length: 5_000 },
      (_unused, index) => `unrelated-${String(index)}`
    );
    const pids = [7001, 7002, 7003];

    const observed = discoverAcross(
      { "/ns": [...filler, ...pids.map(pid => root(pid))] },
      pids
    );

    expect(observed).toBe(4);
  });

  it("does not count this run's own root as a sibling", () => {
    // The config factory runs inside the PAYLOAD process, whose pid is not the
    // pid the run root is named for — the supervisor allocates the root before
    // it forks the bootstrap that launches the payload. A pid-only exclusion
    // therefore counts this run's own root and then adds one more for itself.
    const own = root(9001);

    expect(discoverAcross({ "/ns": [own] }, [9001], own)).toBe(1);
    expect(discoverAcross({ "/ns": [own, root(11)] }, [9001, 11], own)).toBe(2);
  });

  it("de-duplicates a root visible through two candidate namespaces", () => {
    // The platform default and a TMPDIR pointing at it are the same directory
    // by another name. Counting it twice would throttle a lone run.
    const observed = discoverAcross(
      {
        "/nowhere/tmpdir-a/lisa-scratch": [root(11)],
        "/nowhere/tmpdir-b/lisa-scratch": [root(11)],
      },
      [11]
    );

    expect(observed).toBe(2);
  });

  it("reads only the entries that are run roots", () => {
    expect(
      readFleetRunRoots(["notes.txt", root(11), "lisa-gate-run-abc"])
    ).toEqual([{ basename: root(11), pid: 11, startedAt: 1788467384058 }]);
  });
});
