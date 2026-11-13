/**
 * `lisa doctor` must say when this folder's Lisa plugins are not registered
 * (CodySwannGT/lisa#4504).
 *
 * Dependency install deliberately registers nothing, and its notice sends the
 * operator to `lisa doctor` — which, until this check, reported nothing about
 * plugins at all. The check reuses health's `pluginFinding`, so the two can
 * never disagree about what "registered here" means, and it stays quiet
 * wherever the answer cannot be had: no Claude in the harness, no Claude
 * settings, or no `claude` CLI to ask (CI).
 * @module tests/unit/cli/doctor-plugin-registration
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { checkPluginRegistration } from "../../../src/cli/doctor-plugin-registration.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { getPackageVersion } from "../../../src/cli/version.js";

const CHECK_NAME = "Claude Code plugins registered here?";
const REMEDY = "lisa apply .";
const roots: string[] = [];

/**
 * Create a project with Lisa config and, optionally, Claude settings.
 * @param options - Harness and whether to write `.claude/settings.json`
 * @param options.harness - Configured harness
 * @param options.settings - Whether Claude settings exist
 * @returns Canonical project root
 */
async function project({
  harness = "claude",
  settings = true,
}: { harness?: string; settings?: boolean } = {}): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "lisa-doctor-plugins-"))
  );
  roots.push(root);
  await writeFile(
    path.join(root, ".lisa.config.json"),
    JSON.stringify({ harness })
  );
  if (settings) {
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "lisa@lisa": true } })
    );
    await writeFile(
      path.join(root, ".claude", ".lisa-plugins-synced"),
      `${getPackageVersion()}\n`
    );
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("doctor plugin registration check", () => {
  it("warns and names `lisa apply .` when enabled plugins are registered only elsewhere", async () => {
    const root = await project();
    const check = await checkPluginRegistration(root, async () => []);
    expect(check.name).toBe(CHECK_NAME);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("lisa@lisa");
    expect(check.detail).toContain(REMEDY);
  });

  it("passes when every enabled plugin is registered for this folder", async () => {
    const root = await project();
    const check = await checkPluginRegistration(root, async () => [
      "lisa@lisa",
    ]);
    expect(check.status).toBe("ok");
  });

  it("skips quietly when the claude CLI cannot be asked", async () => {
    const root = await project();
    const check = await checkPluginRegistration(root, async () => {
      throw new Error("spawn claude ENOENT");
    });
    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain(REMEDY);
  });

  it.each([
    ["Claude is not in the harness", { harness: "codex" }],
    ["the project has no Claude settings", { settings: false }],
  ])("skips without asking claude when %s", async (_label, options) => {
    const root = await project(options);
    const reader = vi.fn(async () => [] as string[]);
    const check = await checkPluginRegistration(root, reader);
    expect(check.status).toBe("ok");
    expect(reader).not.toHaveBeenCalled();
  });

  it("is part of `lisa doctor` and does not by itself fail the run", async () => {
    const root = await project();
    const setExitCode = vi.fn();
    const result = await runDoctor(
      root,
      { json: true, offline: true },
      {
        write: vi.fn(),
        setExitCode,
        runUpdateCheck: vi.fn().mockResolvedValue({ updateAvailable: false }),
        readInstalledClaudePlugins: async () => [],
      }
    );
    const check = result.checks.find(
      candidate => candidate.name === CHECK_NAME
    );
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain(REMEDY);
  });
});
