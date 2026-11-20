/**
 * The raise waits for the packument, and the scheduled raise finds its own
 * target (CodySwannGT/lisa#4951).
 *
 * The exact-version endpoint can serve a release before the packument lists
 * it, and both `check:self-pin` and Bun's resolver read the packument — both
 * the abbreviated shape since #5094, and the full one is still awaited for
 * every other client that reads it. `--await-listed` is the
 * bounded wait the raise runs before proving anything, so propagation lag is
 * waited out rather than reported as a stale pin. `--newest-installable` is
 * how the hourly run, which has no release behind it, decides what to raise
 * to.
 * @module tests/unit/scripts/check-self-dependency-pin-listed
 */
import { describe, expect, it, vi } from "vitest";

import {
  awaitListed,
  main,
  newestInstallableVersion,
  SELF_PACKAGE,
} from "../../../scripts/check-self-dependency-pin.mjs";

const REGISTRY = "https://registry.example.test";

/** Flag that selects the bounded packument wait. */
const AWAIT_LISTED = "--await-listed";

/** Flag that names the registry origin. */
const REGISTRY_FLAG = "--registry";

/** The release being waited for. */
const RELEASE = "7.0.0";

/** The full packument's media type. */
const FULL = "application/json";

/** The abbreviated install packument's media type, which Bun reads. */
const ABBREVIATED = "application/vnd.npm.install-v1+json";

/**
 * A packument body listing these versions.
 * @param versions - The versions it lists.
 * @returns A packument-shaped document.
 */
function packument(versions: readonly string[]): unknown {
  return {
    name: SELF_PACKAGE,
    versions: Object.fromEntries(versions.map(v => [v, { version: v }])),
  };
}

/**
 * A registry whose packument shapes each list `versions[n]` on read n,
 * repeating the last, and which serves every exact version.
 * @param shapes - Per media type, the versions listed on each successive read.
 * @returns The fetch stand-in and a per-shape read count.
 */
function propagating(
  shapes: Readonly<Record<string, readonly (readonly string[])[]>>
): { fetchImpl: typeof fetch; reads: Record<string, number> } {
  const reads: Record<string, number> = { [FULL]: 0, [ABBREVIATED]: 0 };
  const base = `${REGISTRY}/${SELF_PACKAGE}`;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const accept = String(
      (init?.headers as Record<string, string> | undefined)?.accept ?? FULL
    );
    if (url !== base) {
      const version = url.slice(base.length + 1);
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: SELF_PACKAGE, version }),
      };
    }
    const sequence = shapes[accept] ?? [[]];
    const read = reads[accept] ?? 0;
    reads[accept] = read + 1;
    const versions = sequence[Math.min(read, sequence.length - 1)] ?? [];
    return { ok: true, status: 200, json: async () => packument(versions) };
  }) as unknown as typeof fetch;
  return { fetchImpl, reads };
}

/**
 * A sleep stand-in that counts its calls.
 * @returns The sleep seam and how many times it slept.
 */
function countingSleep(): { sleep: () => Promise<void>; slept: () => number } {
  const state = { count: 0 };
  return {
    sleep: async () => {
      state.count += 1;
    },
    slept: () => state.count,
  };
}

describe("the raise waits until npm lists the release (#4951)", () => {
  it("answers at once when both packument shapes list it", async () => {
    const registry = propagating({
      [FULL]: [["6.0.0", RELEASE]],
      [ABBREVIATED]: [["6.0.0", RELEASE]],
    });
    const clock = countingSleep();

    const outcome = await awaitListed({
      version: RELEASE,
      registry: REGISTRY,
      fetchImpl: registry.fetchImpl,
      sleep: clock.sleep,
    });

    expect(outcome.listed).toBe(true);
    expect(clock.slept()).toBe(0);
  });

  it("keeps reading while the abbreviated packument lags the full one", async () => {
    const registry = propagating({
      [FULL]: [["6.0.0", RELEASE]],
      [ABBREVIATED]: [["6.0.0"], ["6.0.0"], ["6.0.0", RELEASE]],
    });
    const clock = countingSleep();

    const outcome = await awaitListed({
      version: RELEASE,
      registry: REGISTRY,
      fetchImpl: registry.fetchImpl,
      sleep: clock.sleep,
    });

    expect(outcome.listed).toBe(true);
    expect(clock.slept()).toBe(2);
    expect(registry.reads[ABBREVIATED]).toBe(3);
  });

  it("gives up after a bounded number of reads and says which shape lagged", async () => {
    const registry = propagating({
      [FULL]: [["6.0.0"]],
      [ABBREVIATED]: [["6.0.0", RELEASE]],
    });
    const clock = countingSleep();

    const outcome = await awaitListed({
      version: RELEASE,
      registry: REGISTRY,
      fetchImpl: registry.fetchImpl,
      polls: 4,
      sleep: clock.sleep,
    });

    expect(outcome.listed).toBe(false);
    expect(outcome.detail).toContain("after 4 reads");
    expect(outcome.detail).toContain("full:");
    expect(outcome.detail).not.toContain("abbreviated:");
    expect(clock.slept()).toBe(3);
  });

  it("does not count an unreachable registry as listed", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const outcome = await awaitListed({
      version: RELEASE,
      registry: REGISTRY,
      fetchImpl,
      polls: 2,
      sleep: async () => undefined,
    });

    expect(outcome.listed).toBe(false);
    expect(outcome.detail).toContain("ECONNRESET");
  });

  it("exits 0 only once listed, and refuses a non-release version", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const listed = propagating({
      [FULL]: [[RELEASE]],
      [ABBREVIATED]: [[RELEASE]],
    });
    const lagging = propagating({ [FULL]: [[]], [ABBREVIATED]: [[]] });
    const seams = { polls: 2, sleep: async () => undefined };

    const ok = await main([REGISTRY_FLAG, REGISTRY, AWAIT_LISTED, RELEASE], {
      fetchImpl: listed.fetchImpl,
      ...seams,
    });
    const late = await main([REGISTRY_FLAG, REGISTRY, AWAIT_LISTED, RELEASE], {
      fetchImpl: lagging.fetchImpl,
      ...seams,
    });
    const prerelease = await main([AWAIT_LISTED, "7.0.0-rc.1"]);
    const printed = stdout.mock.calls.map(call => String(call[0])).join("");
    stdout.mockRestore();
    stderr.mockRestore();

    expect(ok).toBe(0);
    expect(late).toBe(1);
    expect(prerelease).toBe(1);
    expect(printed).toContain("self-dependency-pin: listed");
    expect(printed).toContain("self-dependency-pin: not-listed");
  });
});

describe("the hourly raise finds its own target (#4951)", () => {
  it("names the newest release the registry will serve", async () => {
    const registry = propagating({ [ABBREVIATED]: [["5.14.3", "6.0.0"]] });

    const found = await newestInstallableVersion({
      registry: REGISTRY,
      fetchImpl: registry.fetchImpl,
      attempts: 1,
      sleep: async () => undefined,
    });

    expect(found.version).toBe("6.0.0");
  });

  it("prints only the version for a step to capture, and fails when unprovable", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const registry = propagating({ [ABBREVIATED]: [["5.14.3", "6.0.0"]] });
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const seams = { attempts: 1, sleep: async () => undefined };

    const ok = await main([REGISTRY_FLAG, REGISTRY, "--newest-installable"], {
      fetchImpl: registry.fetchImpl,
      ...seams,
    });
    const printed = stdout.mock.calls.map(call => String(call[0])).join("");
    const failed = await main(
      [REGISTRY_FLAG, REGISTRY, "--newest-installable"],
      { fetchImpl: down, ...seams }
    );
    stdout.mockRestore();
    stderr.mockRestore();

    expect(ok).toBe(0);
    expect(printed).toBe("6.0.0\n");
    expect(failed).toBe(1);
  });
});
