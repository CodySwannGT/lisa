/** Only timestamped, private folders owned by dead local proof runs can be removed. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROOF_SCRATCH_LIFETIME_MS,
  PROOF_SCRATCH_OWNER,
  PROOF_SCRATCH_PREFIX,
  recordProofScratchOwner,
  sweepProofScratch,
} from "../../../src/controls/proof-scratch.js";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const OLD = NOW - PROOF_SCRATCH_LIFETIME_MS - 1_000;
// Outside the valid process identifier range of the Unix hosts these suites use.
const DEAD = 2_147_483_647;

let scratch = "";
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "lisa-scratch-sweep-case-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/**
 * Create a private folder with a timestamped name and owner record.
 * @param created - Epoch milliseconds in the folder name
 * @param pid - Process recorded as the owner
 * @param host - Host recorded in the owner file
 * @returns The created directory
 */
async function runFolder(
  created: number,
  pid: number,
  host = hostname()
): Promise<string> {
  const folder = path.join(
    scratch,
    `${PROOF_SCRATCH_PREFIX}${created}-${randomUUID()}`
  );
  await mkdir(folder, { mode: 0o700 });
  await writeFile(
    path.join(folder, PROOF_SCRATCH_OWNER),
    JSON.stringify({ schema: 1, folder: path.basename(folder), pid, host }),
    { mode: 0o600 }
  );
  return folder;
}

describe("recovering abandoned proof copies", () => {
  it("records the owning process and host under the exact run name", async () => {
    const folder = path.join(
      scratch,
      `${PROOF_SCRATCH_PREFIX}${NOW}-${randomUUID()}`
    );
    await mkdir(folder, { mode: 0o700 });
    await recordProofScratchOwner(folder);

    expect(
      JSON.parse(await readFile(path.join(folder, PROOF_SCRATCH_OWNER), "utf8"))
    ).toEqual({
      schema: 1,
      folder: path.basename(folder),
      pid: process.pid,
      host: hostname(),
    });
  });

  it("removes only an old, verified abandoned copy", async () => {
    const abandoned = await runFolder(OLD, DEAD);
    const active = await runFolder(OLD, process.pid);
    const young = await runFolder(NOW, DEAD);
    const foreign = await runFolder(OLD, DEAD, "another-host.invalid");
    const unowned = path.join(
      scratch,
      `${PROOF_SCRATCH_PREFIX}${OLD}-${randomUUID()}`
    );
    const legacy = path.join(scratch, `${PROOF_SCRATCH_PREFIX}${randomUUID()}`);
    const canary = path.join(scratch, "lisa-attest-canary-fixture");
    for (const folder of [unowned, legacy, canary]) await mkdir(folder);

    expect(await sweepProofScratch(scratch, { now: NOW })).toEqual({
      removed: 1,
      active: 1,
      young: 1,
      failed: 0,
      unverified: 2,
      scanFailed: false,
    });
    expect(existsSync(abandoned)).toBe(false);
    for (const folder of [active, young, foreign, unowned, legacy, canary])
      expect(existsSync(folder)).toBe(true);
  });

  it("retains the owner after a partial payload removal so a later sweep can retry", async () => {
    const folder = await runFolder(OLD, DEAD);
    const ownerPath = path.join(folder, PROOF_SCRATCH_OWNER);
    const original = await readFile(ownerPath, "utf8");
    const removed: string[] = [];
    for (const name of ["copy-entry-a", "copy-entry-b"])
      await writeFile(path.join(folder, name), "payload\n");

    expect(
      await sweepProofScratch(scratch, {
        now: NOW,
        remove: async entry => {
          if (removed.length > 0) throw new Error("fixture entry is busy");
          await rm(entry);
          removed.push(entry);
        },
      })
    ).toMatchObject({ removed: 0, failed: 1, scanFailed: false });
    expect(removed).toHaveLength(1);
    expect(await readFile(ownerPath, "utf8")).toBe(original);
    expect(await readdir(folder)).toHaveLength(2);
    expect(await sweepProofScratch(scratch, { now: NOW })).toMatchObject({
      removed: 1,
      failed: 0,
    });
    expect(existsSync(folder)).toBe(false);
  });

  it("restores the verified owner record if a late entry prevents final removal", async () => {
    const folder = await runFolder(OLD, DEAD);
    const ownerPath = path.join(folder, PROOF_SCRATCH_OWNER);
    const original = await readFile(ownerPath, "utf8");
    await writeFile(path.join(folder, "initial-entry"), "payload\n");

    expect(
      await sweepProofScratch(scratch, {
        now: NOW,
        remove: async entry => {
          await writeFile(path.join(folder, "late-entry"), "payload\n");
          await rm(entry);
        },
      })
    ).toMatchObject({ removed: 0, failed: 1 });
    expect(await readFile(ownerPath, "utf8")).toBe(original);
    expect(await sweepProofScratch(scratch, { now: NOW })).toMatchObject({
      removed: 1,
      failed: 0,
    });
  });
});
