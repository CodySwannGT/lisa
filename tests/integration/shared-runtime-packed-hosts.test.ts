/** Required real packed-artifact TS/CDK runtime adoption journey. */
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { fsLatencyBudgetMs } from "../helpers/fs-latency-budget.js";
import { cleanupTempDir } from "../helpers/test-utils.js";
import {
  packCandidate,
  startRegistry,
  type Candidate,
} from "../fixtures/shared-runtime-hosts/artifact.js";
import { verifyHost } from "../fixtures/shared-runtime-hosts/journey.js";
import { installTool } from "../fixtures/shared-runtime-hosts/tool-install.js";
import { verifyRuntimeOwnership } from "../fixtures/shared-runtime-hosts/ownership.js";
import { verifyInheritedHost } from "../fixtures/shared-runtime-hosts/inherited-journey.js";
import { assertPackedRuntimePolicy } from "../fixtures/shared-runtime-hosts/assertions.js";
import {
  sharedInstallCache,
  type SharedInstallCache,
} from "../fixtures/shared-runtime-hosts/teardown.js";
import { suiteDeferral } from "../support/ci-runtime.js";

/** The reviewed CI runtime this journey must run under. */
const CI_NODE = "24.21.0";
const deferred = suiteDeferral(
  () => process.versions.node === CI_NODE,
  `the reviewed CI Node ${CI_NODE} as the outer test runtime`,
  `Run the journey under it, e.g. \`mise exec node@${CI_NODE} -- bun run test:integration:packed-hosts\`.`
);

/** Framework hosts that inherit Node 24 and install through the shared cache. */
const INHERITED_STACKS = [
  "npm-package",
  "nestjs",
  "phaser",
  "harper-fabric",
  "expo",
] as const;

/** Existing-host ownership modes; these adopt but never install. */
const OWNERSHIP_MODES = ["known", "ignored", "custom"] as const;

/** TS/CDK hosts with patched installs through the shared cache. */
const NATIVE_STACKS = ["typescript", "cdk"] as const;

/** Every case that installs through the shared Bun cache. */
const INSTALLERS: readonly string[] = [...INHERITED_STACKS, ...NATIVE_STACKS];

/**
 * Every case's host folder. Tracked apart from {@link INSTALLERS} on purpose:
 * a full run is recognised by every case finishing, so a case that stopped
 * reporting its install would fail the teardown's check rather than skip it.
 */
const CASES: readonly string[] = [
  ...INHERITED_STACKS,
  ...OWNERSHIP_MODES.map(mode => `ownership-${mode}`),
  ...NATIVE_STACKS,
];

/** Cases whose host is removed and whose part in the shared cache is done. */
const finishedCases = new Set<string>();

// 2026-10-02 wrapped TS journey: Git init -> completed proof 193.30s,
// with 7-8 Vitest processes observed by ps -Ao args | rg -c '[v]itest'.
// That includes the previous structural Buffer comparison cost; native
// Buffer.compare retains every byte check without that overhead. Wrapped
// install measured 30.95s; an independent cold install measured 122s.
// The 600s case and 180s install bases retain headroom and scale together
// through the existing measured machine factor and asserted margin guard.
useIoLatencyBudget(600_000);
const root = fs.mkdtempSync(
  path.join(tmpdir(), "lisa-shared-runtime-packed-hosts-")
);
let candidate: Candidate;
let registry: Awaited<ReturnType<typeof startRegistry>> | undefined;
let sharedCache: SharedInstallCache | undefined;

/**
 * Run work and keep its failure, so cleanup that must follow still runs.
 * @param work - Work to run
 * @returns The failure, or undefined when the work succeeded
 */
async function attempt(work: () => Promise<void>): Promise<unknown> {
  try {
    await work();
    return undefined;
  } catch (error) {
    return error;
  }
}

/**
 * Rethrow kept failures without letting a later one replace an earlier one.
 * @param label - What failed, for the combined message
 * @param failures - Kept failures in the order they happened
 */
function rethrow(label: string, failures: readonly unknown[]): void {
  const real = failures.filter(failure => failure !== undefined);
  if (real.length > 1)
    throw new AggregateError(
      real,
      `${label}: ${real.length} failures; the first is the original`
    );
  if (real.length === 1) throw real[0];
}

/**
 * Retain complete proof before removing each native host within its case
 * budget, and free the shared install cache after its last installer.
 * @param folder - Owned host beneath the immutable candidate fixture root
 * @param verify - Actual complete native journey
 * @param installs - Whether this case installs through the shared cache
 */
async function observeAndRemoveHost(
  folder: string,
  verify: () => Promise<void>,
  installs = false
): Promise<void> {
  const journey = await attempt(async () => {
    await verify();
    process.stdout.write(
      fs.readFileSync(path.join(candidate.logs, `${folder}-proof.json`), "utf8")
    );
  });
  // Report the case's own failure before its cleanup runs, so a cleanup that
  // fails or overruns the case budget cannot hide it.
  if (journey !== undefined)
    console.error(`${folder} failed before its cleanup:`, journey);
  const cleanup = await attempt(async () => {
    await cleanupTempDir(path.join(candidate.root, folder));
    if (installs) await sharedCache?.finish(folder);
    finishedCases.add(folder);
  });
  rethrow(folder, [journey, cleanup]);
}

/**
 * Identify the active teardown phase without inspecting the fixture corpus.
 * @param phase - Bounded phase and boundary name
 * @param startedAt - Monotonic start of this teardown
 * @param detail - Optional measurements belonging to this phase
 */
function observeTeardownPhase(
  phase: string,
  startedAt: number,
  detail: Record<string, unknown> = {}
): void {
  console.error(
    `PACKED_HOSTS_TEARDOWN ${JSON.stringify({
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
      baseBudgetMs: 30_000,
      budgetMs: fsLatencyBudgetMs(30_000),
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      ...detail,
    })}`
  );
}

/**
 * Whether every declared case ran to the end of its cleanup.
 * @returns True for a full, unfiltered run whose cleanups all succeeded
 */
function fullRun(): boolean {
  return CASES.every(name => finishedCases.has(name));
}

/**
 * The names the owned root still holds. Like every teardown measurement it
 * must not stand between the teardown and the removal, so a failed read is
 * reported rather than thrown.
 * @returns Sorted top-level names, or "unreadable"
 */
function topLevelNames(): readonly string[] | "unreadable" {
  try {
    return fs.existsSync(root)
      ? fs.readdirSync(root).sort((left, right) => left.localeCompare(right))
      : [];
  } catch {
    return "unreadable";
  }
}

/**
 * Read the owned root's state at the teardown boundary, cheaply: the names it
 * still holds and the shared cache's state, never a corpus walk. The cache's
 * entry count was taken by its last installer, before it freed the cache
 * (CodySwannGT/lisa#4636); null when no installer freed it.
 * @returns Owned-resource state for the phase record
 */
function ownedRootState(): Record<string, unknown> {
  return {
    topLevel: topLevelNames(),
    fullRun: fullRun(),
    installersFinished: sharedCache?.allFinished() ?? false,
    sharedCacheFreed: sharedCache?.freed() ?? false,
    sharedCacheEntries: sharedCache?.entriesAtFree() ?? null,
  };
}

/**
 * Free space on the owned root's filesystem, for the removal's readback. A
 * measurement must never stand between the teardown and the removal, so a
 * failed read is reported as unknown rather than thrown.
 * @returns Free inodes and bytes, or undefined when unreadable
 */
function freeSpace():
  | { readonly inodes: number; readonly bytes: number }
  | undefined {
  try {
    const stats = fs.statfsSync(path.dirname(root));
    return { inodes: stats.ffree, bytes: stats.bfree * stats.bsize };
  } catch {
    return undefined;
  }
}

beforeAll(async () => {
  expect(process.versions.node, "run using the reviewed CI runtime").toBe(
    CI_NODE
  );
  candidate = await packCandidate(
    path.resolve(import.meta.dirname, "../.."),
    root
  );
  // The registry starts before the tool installs, so the tool installs Lisa
  // through it exactly as the hosts do (CodySwannGT/lisa#4636).
  registry = await startRegistry(candidate);
  await installTool(candidate, registry.url);
  assertPackedRuntimePolicy(candidate);
  const cache = candidate.env["BUN_INSTALL_CACHE_DIR"];
  expect(cache, "the candidate's shared install cache").toBeDefined();
  sharedCache = sharedInstallCache(cache!, INSTALLERS);
}, ioLatencyBudgetMs(600_000));

afterAll(async () => {
  const startedAt = performance.now();
  const checks = await attempt(async () => {
    observeTeardownPhase("registry-close:start", startedAt);
    await registry?.close();
    observeTeardownPhase("registry-close:end", startedAt);
    expect(
      fs.existsSync(path.join(root, "github-was-invoked")),
      "no GitHub commands in the complete journey"
    ).toBe(false);
    if (fullRun()) {
      expect(
        sharedCache?.freed(),
        "after a full run, the last installing case freed the shared install cache"
      ).toBe(true);
      expect(
        sharedCache !== undefined && fs.existsSync(sharedCache.directory),
        "the shared install cache is gone before the teardown removes the root"
      ).toBe(false);
    }
  });
  // Report a failed check before the removal runs: a removal that overruns
  // the hook's budget ends the hook, and the kept failure with it.
  if (checks !== undefined)
    console.error("teardown checks failed before the removal:", checks);
  observeTeardownPhase("root-cleanup:start", startedAt, ownedRootState());
  const before = freeSpace();
  const removal = await attempt(async () => {
    await cleanupTempDir(root);
    expect(fs.existsSync(root), "the owned root is removed").toBe(false);
  });
  const after = freeSpace();
  observeTeardownPhase("root-cleanup:end", startedAt, {
    ...(before && after
      ? {
          inodesFreed: after.inodes - before.inodes,
          bytesFreed: after.bytes - before.bytes,
        }
      : {}),
    rootExists: fs.existsSync(root),
  });
  rethrow("teardown", [checks, removal]);
}, fsLatencyBudgetMs(30_000));

describe.skipIf(deferred)(
  "shared runtime through exact packed CLI and generated hosts",
  () => {
    it.each(INHERITED_STACKS)(
      "%s inherits Node24 through genuine native framework checks and two adoptions",
      async stack => {
        expect(registry).toBeDefined();
        await observeAndRemoveHost(
          stack,
          () => verifyInheritedHost(candidate, registry!.url, stack),
          true
        );
      }
    );
    it.each(OWNERSHIP_MODES)(
      "Node24 adoption preserves existing host ownership: %s",
      async mode => {
        await observeAndRemoveHost(`ownership-${mode}`, () =>
          verifyRuntimeOwnership(candidate, mode)
        );
      }
    );
    it.each(NATIVE_STACKS)(
      "%s: patched installs, native execution and two idempotent adoptions",
      async stack => {
        expect(registry).toBeDefined();
        await observeAndRemoveHost(
          stack,
          () => verifyHost(candidate, registry!.url, stack),
          true
        );
      }
    );
  }
);
