/**
 * Keep check rows, current base and registration in one snapshot (#4487).
 * Legacy head/required-set seams deliberately make the pre-fix implementation
 * exercisable without live GitHub access.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  __dirname,
  "../../..",
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs"
);
const HEAD = "d".repeat(40);
const REPO = "owner/name";
const COMMON = "Common required check";
const DEV_ONLY = "Dev-only required check";

/** A complete current PR observation from the metadata adapter. */
interface Observation {
  readonly headSha: string;
  readonly repo: string;
  readonly pullRequest: {
    readonly number: number;
    readonly url: string;
    readonly headRefOid: string;
    readonly baseRefName: string;
  };
}

/** One selected per-branch requirement set. */
interface RequiredSet {
  readonly base: string | null;
  readonly contexts: readonly string[];
}

/** A real roster row consumed by the settlement reader. */
interface CheckRow {
  readonly name: string;
  readonly state: string;
}

/** The observable settlement result, including its registration decision. */
interface SnapshotRead {
  readonly checks: readonly CheckRow[];
  readonly settled: boolean;
  readonly headSha: string;
  readonly requiredSet?: RequiredSet;
  readonly registration: {
    readonly elapsedSeconds: number;
    readonly present: number;
    readonly total: number;
    readonly missing: readonly string[];
    readonly expired: boolean;
  };
}

/** Only the public behavior this suite drives. */
interface GuardModule {
  selectRequiredContexts(
    declaration: Record<string, unknown>,
    base: { base: string; source: string }
  ): RequiredSet;
  fetchSettledChecks(
    declaration: Record<string, unknown>,
    pr: string,
    repo: string,
    options: Record<string, unknown>
  ): SnapshotRead;
}

const declaration = {
  required_contexts: [COMMON, DEV_ONLY],
  required_contexts_by_branch: {
    dev: [COMMON, DEV_ONLY],
    staging: [COMMON],
  },
  evidence_bearing_checks: {},
};
const stagingRows = [{ name: COMMON, state: "SUCCESS" }];
const devRows = [...stagingRows, { name: DEV_ONLY, state: "SUCCESS" }];
let guard: GuardModule;

beforeAll(async () => {
  guard = (await import(pathToFileURL(SCRIPT).href)) as unknown as GuardModule;
});

/** Build independent metadata with an unchanged concrete head. */
function observation(baseRefName: string): Observation {
  return {
    headSha: HEAD,
    repo: REPO,
    pullRequest: {
      number: 1,
      url: `https://github.com/${REPO}/pull/1`,
      headRefOid: HEAD,
      baseRefName,
    },
  };
}

/** Select from the current observation, rather than a saved workflow event. */
function requiredFor(current: Observation): RequiredSet {
  return guard.selectRequiredContexts(declaration, {
    base: current.pullRequest.baseRefName,
    source: "current PR metadata",
  });
}

/** Preserve working legacy seams so a known-bad replay never contacts GitHub. */
function legacySeams(): Record<string, unknown> {
  return {
    headSha: () => HEAD,
    requiredSet: requiredFor(observation("dev")),
  };
}

describe("current PR base snapshots remain coherent (#4487)", () => {
  it("reads a fresh snapshot when the early head was unresolved", () => {
    let observations = 0;
    const current = observation("staging");
    const result = guard.fetchSettledChecks(declaration, "1", REPO, {
      ...legacySeams(),
      timeoutSeconds: 0,
      now: () => 0,
      initialObservation: { ...observation("dev"), headSha: undefined },
      observe: () => {
        observations += 1;
        return current;
      },
      requiredSetFor: requiredFor,
      fetch: () => stagingRows,
    });

    expect(result.checks).toEqual(stagingRows);
    expect(result.headSha).toBe(HEAD);
    expect(result.registration).toMatchObject({
      total: 1,
      missing: [],
      expired: false,
    });
    expect(observations).toBe(2);
  });

  it.each([false, true])(
    "refuses a same-head retarget at zero budget (cached observation: %s)",
    cached => {
      const before = observation("dev");
      const after = observation("staging");
      const observations = cached ? [after] : [before, after];
      expect(() =>
        guard.fetchSettledChecks(declaration, "1", REPO, {
          ...legacySeams(),
          timeoutSeconds: 0,
          now: () => 0,
          initialObservation: cached ? before : undefined,
          observe: () => observations.shift() ?? after,
          requiredSetFor: requiredFor,
          fetch: () => devRows,
        })
      ).toThrow(/base changed.*dev -> staging/u);
    }
  );

  it("discards a mixed read and registers only the recovered staging roster", () => {
    let elapsed = 0;
    let reads = 0;
    const sleeps: number[] = [];
    const observations = [
      observation("dev"),
      observation("staging"),
      observation("staging"),
      observation("staging"),
    ];
    const result = guard.fetchSettledChecks(declaration, "1", REPO, {
      ...legacySeams(),
      timeoutSeconds: 0.5,
      intervalSeconds: 0.2,
      now: () => elapsed,
      sleep: (milliseconds: number) => {
        sleeps.push(milliseconds);
        elapsed += milliseconds;
      },
      observe: () => observations.shift() ?? observation("staging"),
      requiredSetFor: requiredFor,
      fetch: () => {
        elapsed += 100;
        return reads++ === 0 ? devRows : stagingRows;
      },
    });

    expect(result.checks).toEqual(stagingRows);
    expect(result.requiredSet?.base).toBe("staging");
    expect(result.requiredSet?.contexts).toEqual([COMMON]);
    expect(result.headSha).toBe(HEAD);
    expect(result.settled).toBe(true);
    expect(result.registration).toMatchObject({
      elapsedSeconds: 0.4,
      present: 1,
      total: 1,
      missing: [],
      expired: false,
    });
    expect(sleeps).toEqual([200]);
    expect(elapsed).toBeLessThan(500);
  });

  it("expires repeated retargets at the original shared deadline", () => {
    let elapsed = 0;
    let observations = 0;
    const sleeps: number[] = [];
    expect(() =>
      guard.fetchSettledChecks(declaration, "1", REPO, {
        ...legacySeams(),
        timeoutSeconds: 1,
        intervalSeconds: 0.6,
        now: () => elapsed,
        sleep: (milliseconds: number) => {
          sleeps.push(milliseconds);
          if (milliseconds < 0 || sleeps.length > 2)
            throw new Error("Settlement deadline was extended.");
          elapsed += milliseconds;
        },
        observe: () =>
          observation(observations++ % 2 === 0 ? "dev" : "staging"),
        requiredSetFor: requiredFor,
        fetch: () => {
          elapsed += 100;
          return devRows;
        },
      })
    ).toThrow(/base changed/u);

    // API work consumes the same budget. The second sleep has only200ms left.
    expect(sleeps).toEqual([600, 200]);
    expect(elapsed).toBe(1100);
  });
});
