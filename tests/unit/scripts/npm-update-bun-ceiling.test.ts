/**
 * The qualified Bun invoker hands each native call the caller's ceiling, not a
 * fixed two-minute cap, so a whole Bun-only root install (CodySwannGT/lisa#4862)
 * can use the gate's remaining phase budget. The native process runner is
 * recorded rather than run, so a ceiling far above two minutes is observable
 * without waiting for it.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(
  () => [] as { args: readonly string[]; timeout: number }[]
);

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-process-core.mjs",
  async original => ({
    ...(await original<Record<string, unknown>>()),
    runProcess: async (
      _command: string,
      args: readonly string[],
      options: { timeout: number }
    ) => {
      calls.push({ args, timeout: options.timeout });
      return {
        code: 0,
        stdout: Buffer.from(args[0] === "--version" ? "1.4.4\n" : ""),
        stderr: Buffer.alloc(0),
      };
    },
  })
);

const { qualifiedBun } =
  await import("../../../all/copy-overwrite/scripts/lib/npm-update-bun.mjs");

const roots: string[] = [];
const THIRTY_MINUTES = 1_800_000;
const TWO_MINUTES = 120_000;
// Recorded, never waited on: the native runner is mocked above.
const timeout = THIRTY_MINUTES;
const requested = { timeout };

/**
 * A regular executable standing in for the Bun binary's identity checks.
 * @returns Its absolute path.
 */
function stubExecutable() {
  const root = mkdtempSync(join(tmpdir(), "lisa-bun-ceiling-"));
  roots.push(root);
  const path = join(root, "bun");
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

afterEach(() => {
  calls.length = 0;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("qualified Bun ceiling", () => {
  it("passes a ceiling above two minutes through to the native call", async () => {
    const bun = await qualifiedBun(
      {},
      { executable: stubExecutable(), ceiling: THIRTY_MINUTES }
    );
    await bun(["install"], requested);
    expect(calls.at(-1)).toEqual({
      args: ["install"],
      timeout: THIRTY_MINUTES,
    });
  });

  it("keeps the historical two-minute cap when no ceiling is given", async () => {
    const bun = await qualifiedBun({}, { executable: stubExecutable() });
    await bun(["install"], requested);
    expect(calls.at(-1)).toEqual({ args: ["install"], timeout: TWO_MINUTES });
  });
});
