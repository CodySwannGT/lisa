/**
 * The `plugins.current` health finding must tell the operator how to fix a
 * failure, not only what is wrong (CodySwannGT/lisa#4504).
 *
 * Dependency install never registers Claude Code plugins, so a fresh clone
 * fails this check until someone runs `lisa apply .` in it. A reason that
 * lists `lisa@lisa` without naming that command leaves a non-technical
 * operator with a plugin id and no next step.
 * @module tests/unit/health/plugin-finding-remediation
 */
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getPackageVersion } from "../../../src/cli/version.js";
import { pluginFinding } from "../../../src/health/governance-probes.js";
import { readInstalledClaudePlugins } from "../../../src/health/plugin-inspection.js";

const REMEDY = "Run `lisa apply .` in this project";
// Every project declares the knowledge role (default llm-wiki), so the wiki
// plugin is enabled beside the base plugin.
const SETTINGS =
  '{"enabledPlugins":{"lisa@lisa":true,"lisa-wiki@lisa":true}}\n';
const ALL_ENABLED = ["lisa@lisa", "lisa-wiki@lisa"];
const roots: string[] = [];

/**
 * Create a canonical temporary project root with Claude settings and marker.
 * @param settings - `.claude/settings.json` body
 * @param marker - Plugin sync marker body
 * @returns Project root
 */
async function project(settings: string, marker: string): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "lisa-plugin-finding-"))
  );
  roots.push(root);
  await mkdir(path.join(root, ".claude"), { recursive: true });
  await writeFile(path.join(root, ".claude", "settings.json"), settings);
  await writeFile(path.join(root, ".claude", ".lisa-plugins-synced"), marker);
  return root;
}

/**
 * Run the finding with a fixed installed-plugin answer.
 * @param root - Project root
 * @param installed - Plugin ids the reader reports for this folder
 * @returns The finding
 */
async function finding(
  root: string,
  installed: readonly string[] | Error
): Promise<Awaited<ReturnType<typeof pluginFinding>>> {
  return pluginFinding(
    root,
    { harness: "claude" },
    [],
    async () => {
      if (installed instanceof Error) throw installed;
      return installed;
    },
    1_000,
    new AbortController().signal
  );
}

describe("plugins.current remediation", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
    );
  });

  it("names `lisa apply .` when enabled plugins are not registered for this folder", async () => {
    const root = await project(SETTINGS, `${getPackageVersion()}\n`);
    const result = await finding(root, []);
    expect(result.status).toBe("fail");
    expect(result.reason).toContain("lisa@lisa");
    expect(result.reason).toContain(REMEDY);
  });

  it("names `lisa apply .` when the plugin marker is stale", async () => {
    const root = await project(SETTINGS, "0.0.1\n");
    const result = await finding(root, ["lisa@lisa"]);
    expect(result.status).toBe("fail");
    expect(result.reason).toContain(REMEDY);
  });

  it("does not prescribe apply when the installed state could not be read", async () => {
    const root = await project(SETTINGS, `${getPackageVersion()}\n`);
    const result = await finding(root, new Error("claude unavailable"));
    expect(result.status).toBe("warn");
    expect(result.reason).not.toContain("lisa apply");
  });

  it("passes without a remedy when every plugin is registered", async () => {
    const root = await project(SETTINGS, `${getPackageVersion()}\n`);
    const result = await finding(root, ALL_ENABLED);
    expect(result.status).toBe("pass");
    expect(result.reason).not.toContain("lisa apply");
  });

  it("reads a long-lived workstation's plugin list, which is far past 256 KB and 512 entries", async () => {
    // A machine that has registered plugins for many checkouts lists
    // thousands of entries (measured: 3,338 entries, 1.6 MB). A reader capped
    // below that fails, and every plugin check silently degrades to
    // "unavailable" on exactly the machines that need it (#4504; same class
    // as the apply-side fix in #4645).
    const root = await project(SETTINGS, `${getPackageVersion()}\n`);
    const bin = path.join(root, "bin");
    await mkdir(bin);
    const entries = [
      ...Array.from({ length: 4_000 }, (_unused, index) => ({
        id: `p${index}@market`,
        scope: "project",
        projectPath: `/elsewhere/checkout-${index}/${"x".repeat(200)}`,
      })),
      { id: "lisa@lisa", scope: "project", projectPath: root },
    ];
    await writeFile(path.join(bin, "list.json"), JSON.stringify(entries));
    await writeFile(
      path.join(bin, "claude"),
      `#!/bin/sh\ncat "${path.join(bin, "list.json")}"\n`
    );
    await chmod(path.join(bin, "claude"), 0o755);
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);

    await expect(
      readInstalledClaudePlugins(root, 10_000, new AbortController().signal)
    ).resolves.toEqual(["lisa@lisa"]);
  });
});
