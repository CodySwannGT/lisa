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

beforeAll(async () => {
  expect(process.versions.node, "run using the reviewed CI runtime").toBe(
    "24.21.0"
  );
  candidate = await packCandidate(
    path.resolve(import.meta.dirname, "../.."),
    root
  );
  assertPackedRuntimePolicy(candidate);
  registry = await startRegistry(candidate);
}, ioLatencyBudgetMs(600_000));

afterAll(async () => {
  try {
    await registry?.close();
    expect(
      fs.existsSync(path.join(root, "github-was-invoked")),
      "no GitHub commands in the complete journey"
    ).toBe(false);
  } finally {
    await cleanupTempDir(root);
  }
}, fsLatencyBudgetMs(30_000));

describe("shared runtime through exact packed CLI and generated hosts", () => {
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
});
