/** Scheduler confinement regressions for the authoritative Codex adapter. */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { listCodexAutomations } from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";

const AUTOMATION_PREFIX = "lisa-auto-confined-repo-";
const AUTOMATION_ID = `${AUTOMATION_PREFIX}intake-tickets`;
const AUTOMATION_TOML = "automation.toml";
const AUTOMATION_MEMORY = "memory.md";
const roots: string[] = [];

/**
 * Create a disposable scheduler fixture root.
 * @returns Created fixture root
 */
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-codex-confined-"));
  roots.push(root);
  return root;
}

/**
 * Return the minimal valid TOML consumed by the adapter.
 * @returns Valid automation contract
 */
function automationToml(): string {
  return [
    "version = 1",
    `id = "${AUTOMATION_ID}"`,
    'kind = "cron"',
    'status = "ACTIVE"',
    'rrule = "FREQ=HOURLY;INTERVAL=1"',
    'prompt = "Use the Lisa intake skill."',
    "",
  ].join("\n");
}

/**
 * Create one matching scheduler directory and return it.
 * @param root - Scheduler root
 * @returns Created automation directory
 */
async function automationDirectory(root: string): Promise<string> {
  const directory = path.join(root, AUTOMATION_ID);
  await mkdir(directory);
  return directory;
}

/**
 * List the matching fixture through the authoritative adapter.
 * @param root - Scheduler root
 * @returns Adapter result
 */
async function listFixture(root: string): Promise<unknown> {
  return await listCodexAutomations({
    automationsDir: root,
    automationPrefix: AUTOMATION_PREFIX,
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("Codex scheduler adapter confinement", () => {
  it("rejects an external automation.toml symlink", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const directory = await automationDirectory(root);
    const target = path.join(outside, AUTOMATION_TOML);
    await writeFile(target, automationToml());
    await symlink(target, path.join(directory, AUTOMATION_TOML));

    await expect(listFixture(root)).rejects.toThrow(
      /Unsafe Codex scheduler file/u
    );
  });

  it("rejects a memory FIFO without opening or blocking on it", async () => {
    const root = await temporaryRoot();
    const directory = await automationDirectory(root);
    await writeFile(path.join(directory, AUTOMATION_TOML), automationToml());
    execFileSync("/usr/bin/mkfifo", [path.join(directory, AUTOMATION_MEMORY)]);

    await expect(listFixture(root)).rejects.toThrow(
      /Unsafe Codex scheduler file/u
    );
  });

  it.each([
    [AUTOMATION_TOML, 256 * 1024 + 1],
    [AUTOMATION_MEMORY, 512 * 1024 + 1],
  ])("rejects oversized %s evidence", async (filename, size) => {
    const root = await temporaryRoot();
    const directory = await automationDirectory(root);
    if (filename === AUTOMATION_MEMORY) {
      await writeFile(path.join(directory, AUTOMATION_TOML), automationToml());
    }
    await writeFile(path.join(directory, filename), "x".repeat(size));

    await expect(listFixture(root)).rejects.toThrow(/exceeds size limit/u);
  });

  it("bounds total scheduler directory enumeration", async () => {
    const root = await temporaryRoot();
    await Promise.all(
      Array.from({ length: 1_001 }, (_value, index) =>
        writeFile(path.join(root, `unrelated-${index}`), "")
      )
    );

    await expect(listFixture(root)).rejects.toThrow(/entry limit/u);
  });

  it("honors an already-aborted request before opening scheduler resources", async () => {
    const root = await temporaryRoot();
    const controller = new AbortController();
    controller.abort(new Error("request cancelled"));

    await expect(
      listCodexAutomations({
        automationsDir: root,
        automationPrefix: AUTOMATION_PREFIX,
        signal: controller.signal,
      })
    ).rejects.toThrow("request cancelled");
  });
});
