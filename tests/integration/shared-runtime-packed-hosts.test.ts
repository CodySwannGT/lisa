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
import { verifyRuntimeOwnership } from "../fixtures/shared-runtime-hosts/ownership.js";
import { verifyInheritedHost } from "../fixtures/shared-runtime-hosts/inherited-journey.js";
import { assertPackedRuntimePolicy } from "../fixtures/shared-runtime-hosts/assertions.js";
import { suiteDeferral } from "../support/ci-runtime.js";

/** The reviewed CI runtime this journey must run under. */
const CI_NODE = "24.21.0";
const deferred = suiteDeferral(
  () => process.versions.node === CI_NODE,
  `the reviewed CI Node ${CI_NODE} as the outer test runtime`,
  `Run the integration suite under it, e.g. \`mise exec node@${CI_NODE} -- bun run test:integration\`.`
);

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

/**
 * Retain complete proof before removing each native host within its case budget.
 * @param folder - Owned host beneath the immutable candidate fixture root
 * @param verify - Actual complete native journey
 */
async function observeAndRemoveHost(
  folder: string,
  verify: () => Promise<void>
): Promise<void> {
  try {
    await verify();
    process.stdout.write(
      fs.readFileSync(path.join(candidate.logs, `${folder}-proof.json`), "utf8")
    );
  } finally {
    await cleanupTempDir(path.join(candidate.root, folder));
  }
}

/**
 * Identify the active teardown phase without inspecting the fixture corpus.
 * @param phase - Bounded phase and boundary name
 * @param startedAt - Monotonic start of this teardown
 */
function observeTeardownPhase(phase: string, startedAt: number): void {
  console.error(
    `PACKED_HOSTS_TEARDOWN ${JSON.stringify({
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
      baseBudgetMs: 30_000,
      budgetMs: fsLatencyBudgetMs(30_000),
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    })}`
  );
}

beforeAll(async () => {
  expect(process.versions.node, "run using the reviewed CI runtime").toBe(
    CI_NODE
  );
  candidate = await packCandidate(
    path.resolve(import.meta.dirname, "../.."),
    root
  );
  assertPackedRuntimePolicy(candidate);
  registry = await startRegistry(candidate);
}, ioLatencyBudgetMs(600_000));

afterAll(async () => {
  const startedAt = performance.now();
  try {
    observeTeardownPhase("registry-close:start", startedAt);
    await registry?.close();
    observeTeardownPhase("registry-close:end", startedAt);
    expect(
      fs.existsSync(path.join(root, "github-was-invoked")),
      "no GitHub commands in the complete journey"
    ).toBe(false);
  } finally {
    observeTeardownPhase("root-cleanup:start", startedAt);
    await cleanupTempDir(root);
    observeTeardownPhase("root-cleanup:end", startedAt);
  }
}, fsLatencyBudgetMs(30_000));

describe.skipIf(deferred)(
  "shared runtime through exact packed CLI and generated hosts",
  () => {
    it.each([
      "npm-package",
      "nestjs",
      "phaser",
      "harper-fabric",
      "expo",
    ] as const)(
      "%s inherits Node24 through genuine native framework checks and two adoptions",
      async stack => {
        expect(registry).toBeDefined();
        await observeAndRemoveHost(stack, () =>
          verifyInheritedHost(candidate, registry!.url, stack)
        );
      }
    );
    it.each(["known", "ignored", "custom"] as const)(
      "Node24 adoption preserves existing host ownership: %s",
      async mode => {
        await observeAndRemoveHost(`ownership-${mode}`, () =>
          verifyRuntimeOwnership(candidate, mode)
        );
      }
    );
    it.each(["typescript", "cdk"] as const)(
      "%s: patched installs, native execution and two idempotent adoptions",
      async stack => {
        expect(registry).toBeDefined();
        await observeAndRemoveHost(stack, () =>
          verifyHost(candidate, registry!.url, stack)
        );
      }
    );
  }
);
