/** Exercise the installed OpenCode after-tool adapter with real Bun and Bash. */
import * as fs from "fs-extra";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installHooks } from "../../../src/opencode/hooks-installer.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = process.cwd();
const COMMAND = "gh pr create";
const RAN = "validator-ran";
const LEGACY_USAGE = "Usage: lisa-work-item.mjs link|current|validate-pr";

describe("OpenCode deferred PR gate adapter", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
    const git = boundedSpawnSync({
      command: "git",
      args: ["init", "-q"],
      cwd: root,
      label: "initialize OpenCode PR fixture",
    });
    expect(git.status, git.stderr).toBe(0);
    await installHooks(REPO_ROOT, root, [], []);
  });
  afterEach(async () => {
    await cleanupTempDir(root);
  });

  /**
   * Install an explicit controlled host CLI and invoke the real shipped adapter.
   * @param status - The host validator's exit code.
   * @param diagnostic - The host's response.
   * @param command - Shell command in the after-tool envelope.
   * @param tool - Native tool name.
   * @param workdir - Optional shell working directory.
   * @returns The adapter's allow/deny result and emitted diagnostics.
   */
  async function invoke(
    status: number,
    diagnostic: string,
    command = COMMAND,
    tool = "bash",
    workdir?: string
  ): Promise<{ stdout: string; stderr: string }> {
    await fs.outputFile(
      path.join(root, "scripts/lisa-work-item.mjs"),
      `import { writeFileSync } from "node:fs";
       writeFileSync(${JSON.stringify(path.join(root, RAN))}, "ran");
       console.error(${JSON.stringify(diagnostic)});
       process.exit(${status});`
    );
    const moduleUrl = pathToFileURL(
      path.join(root, ".opencode/plugin/lisa-discharge-work-item-gates.ts")
    ).href;
    const program = `
      const { LisaDischargeWorkItemGates } = await import(${JSON.stringify(moduleUrl)});
      const plugin = await LisaDischargeWorkItemGates({directory: ${JSON.stringify(root)}});
      try {
        await plugin["tool.execute.after"](${JSON.stringify({ tool, args: { command, workdir } })});
        console.log("allow");
      } catch(error) {
        console.log("deny:" + error.message);
      }`;
    const result = boundedSpawnSync({
      command: "bun",
      args: ["-e", program],
      cwd: REPO_ROOT,
      label: "run installed OpenCode PR adapter",
    });
    expect(result.status, result.stderr).toBe(0);
    return { stdout: result.stdout.trim(), stderr: result.stderr };
  }

  it("stands down with one notice on an older host", async () => {
    const result = await invoke(1, LEGACY_USAGE);

    expect(result.stdout).toBe("allow");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("Update Lisa");
  });

  it("surfaces a supported host's genuine gate refusal", async () => {
    const result = await invoke(
      1,
      "Gate 4: PR body needs its Work-Item declaration."
    );

    expect(result.stdout).toContain("deny:Gate 4");
    expect(result.stderr).toBe("");
  });

  it.each([0, 3])("stays silent for validator status %s", async status => {
    const result = await invoke(status, "nothing to report");

    expect(result.stdout).toBe("allow");
    expect(result.stderr).toBe("");
    expect(await fs.pathExists(path.join(root, RAN))).toBe(true);
  });

  it.each(["absolute", "relative"])(
    "checks the operated-on repository for an %s workdir",
    async shape => {
      const other = path.join(root, "other");
      await fs.ensureDir(other);
      const git = boundedSpawnSync({
        command: "git",
        args: ["init", "-q"],
        cwd: other,
        label: "initialize operated-on PR repository",
      });
      expect(git.status, git.stderr).toBe(0);
      await fs.outputFile(
        path.join(other, "scripts/lisa-work-item.mjs"),
        `console.error("Operated-on repository gate unmet"); process.exit(1);`
      );
      const result = await invoke(
        0,
        "plugin project is compliant",
        COMMAND,
        "bash",
        shape === "absolute" ? other : "other"
      );

      expect(result.stdout).toContain("deny:Operated-on repository gate unmet");
      expect(await fs.pathExists(path.join(root, RAN))).toBe(false);
    }
  );

  it.each([
    ["bash", "git status"],
    ["bash", "gh pr view 7"],
    ["edit", COMMAND],
  ])("skips unrelated %s calls: %s", async (tool, command) => {
    const result = await invoke(1, "gate unmet", command, tool);

    expect(result.stdout).toBe("allow");
    expect(await fs.pathExists(path.join(root, RAN))).toBe(false);
  });
});
