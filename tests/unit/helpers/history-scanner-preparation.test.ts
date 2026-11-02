/**
 * @file history-scanner-preparation.test.ts
 * @description The cold scanner acquisition's containing deadline, and its
 * bounded, truthful and owned failure outcomes. Network-free: every provision
 * child here is a stub, for explicit failure handling only, and none stands in
 * for the genuine acquisition proved in
 * tests/integration/history-secret-scanner-preparation.test.ts.
 * @module tests/unit/helpers/history-scanner-preparation
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  COLD_PROVISION_DEADLINE_MS,
  PROVISIONED,
  PROVISIONER_PHASE_LIMITS_MS,
  prepareHistoryScanner,
  type FailedPreparation,
} from "../../helpers/history-scanner-preparation.js";
import {
  BOUNDED_SPAWN_BASE_MS,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";

const root = resolve(import.meta.dirname, "../../..");
const lease = mkdtempSync(join(tmpdir(), "history-scanner-cold-failures-"));
const marker = join(lease, "cold-unpinned-was-executed");
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Deadline for stub children that finish on their own, calibrated like any child. */
const STUB_DEADLINE_MS = ioLatencyBudgetMs(BOUNDED_SPAWN_BASE_MS);

/** A stub that writes unpinned bytes, which would leave a marker if run. */
const UNPINNED = `require("node:fs").writeFileSync(process.argv[1], ${JSON.stringify(
  `#!/bin/sh\nprintf invoked > ${quote(marker)}\n`
)}, { mode: 0o700 }); process.stdout.write(${JSON.stringify(PROVISIONED)});`;

/**
 * Run one stub provision child through the real preparation path.
 *
 * The scope must already be gone when the failure comes back: the failure
 * path removes it on its own, and the dispose called afterwards only makes
 * the case safe to rerun, so it cannot be what passes the check.
 * @param script - The stub child's program
 * @param deadlineMs - Its containing deadline
 * @returns The failure, and the scope it ran in
 */
async function coldFailure(
  script: string,
  deadlineMs = STUB_DEADLINE_MS
): Promise<FailedPreparation & { readonly scope: string }> {
  const { preparation, dispose } = await prepareHistoryScanner({
    argv: destination => [process.execPath, "-e", script, destination],
    deadlineMs,
  });
  const scope = dirname(String(preparation.evidence?.argv.at(-1)));
  const removedByFailurePath = !existsSync(scope);
  dispose();
  if (preparation.ok) throw new Error("The stub cold acquisition succeeded.");
  expect(scope).toMatch(/lisa-history-scanner-preparation-/u);
  expect(removedByFailurePath).toBe(true);
  expect(preparation.evidence).toMatchObject({
    deadlineMs,
    executableSha256: null,
    version: null,
  });
  return { ...preparation, scope };
}

afterAll(() => {
  rmSync(lease, { recursive: true, force: true });
  expect(existsSync(lease)).toBe(false);
});

describe("the cold scanner acquisition's containing deadline", () => {
  it("is exactly the sum of the shipped provisioner's own phase limits", () => {
    const source = readFileSync(
      join(root, "all/copy-overwrite/scripts/lib/history-secret-scanner.mjs"),
      "utf8"
    );
    const provisioning = source.slice(
      source.indexOf("export const provisionScanner"),
      source.indexOf("export const qualifyScanner")
    );
    const declared = [
      ...provisioning.matchAll(/(?:AbortSignal\.timeout\(|timeout: )(\d+)/gu),
    ].map(match => Number(match[1]));
    expect(declared).toEqual(Object.values(PROVISIONER_PHASE_LIMITS_MS));
    expect(COLD_PROVISION_DEADLINE_MS).toBe(
      declared.reduce((total, limit) => total + limit, 0)
    );
  });
});

describe("cold acquisition failures stay bounded, truthful and owned", () => {
  it("kills a cold provision at its containing deadline and reports the timeout", async () => {
    const failure = await coldFailure(
      "setTimeout(() => undefined, 60_000);",
      500
    );
    expect(failure.reason).toMatch(/did not complete within its 500ms/u);
    expect(failure.evidence).toMatchObject({
      status: null,
      signal: "SIGKILL",
      errorCode: "ETIMEDOUT",
    });
    // Killed at its own 500ms deadline, long before the stub's calibrated bound.
    expect(failure.evidence?.elapsedMs).toBeLessThan(STUB_DEADLINE_MS);
  });

  it("gives the provision child a private TMPDIR inside its owned scope", async () => {
    const failure = await coldFailure(
      'process.stderr.write(require("node:os").tmpdir()); process.exitCode = 1;'
    );
    expect(failure.reason).toBe(
      `The cold scanner provision exited 1: ${join(failure.scope, "tmp")}`
    );
  });

  it.each([
    [
      "is killed by a signal",
      'process.kill(process.pid, "SIGTERM");',
      /was killed by SIGTERM/u,
      { status: null, signal: "SIGTERM", errorCode: null },
    ],
    [
      "exits nonzero",
      'process.stderr.write("Pinned scanner download failed.\\n"); process.exitCode = 1;',
      /exited 1: Pinned scanner download failed\./u,
      { status: 1, signal: null, errorCode: null },
    ],
    [
      "omits the success line",
      "",
      /without the provisioner's exact success line/u,
      { status: 0, stdout: "" },
    ],
    [
      "reports success but writes nothing",
      `process.stdout.write(${JSON.stringify(PROVISIONED)});`,
      /the provisioned executable is missing/u,
      { status: 0, stdout: PROVISIONED },
    ],
    [
      "reports success over unpinned bytes",
      UNPINNED,
      /SHA256 [a-f0-9]{64} is not the pinned/u,
      { status: 0, stdout: PROVISIONED },
    ],
  ] as const)(
    "refuses a cold provision that %s, and removes its owned scope",
    async (_name, script, reason, outcome) => {
      const failure = await coldFailure(script);
      expect(failure.reason).toMatch(reason);
      expect(failure.evidence).toMatchObject(outcome);
      expect(existsSync(marker)).toBe(false);
    }
  );
});
