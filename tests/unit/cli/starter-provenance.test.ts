import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runSetupProject } from "../../../src/cli/setup-project.js";
import { SETUP_TYPES, resolveStarter } from "../../../src/cli/starters.js";

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const CONFIG = ".lisa.config.json";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lisa-starter-provenance-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Model the commands while leaving real config persistence to setup.
 * @param authenticated - Which creation path to exercise.
 * @param tree - The copied template's tree.
 * @returns Injectable setup collaborators.
 */
function dependencies(authenticated = true, tree = TREE) {
  return {
    runApply: vi.fn(async (destination: string | undefined) => {
      await mkdir(destination!, { recursive: true });
      await writeFile(
        join(destination!, CONFIG),
        JSON.stringify({
          extension: "retained",
          starter: { extension: "also-retained", sync: { auto: false } },
        })
      );
    }),
    runCommand: vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "gh" && args[0] === "auth" && !authenticated)
        throw new Error("not authenticated");
    }),
    captureCommand: vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "gh")
        return args.includes(".default_branch") ? "main" : `${SHA}\t${TREE}`;
      if (args.includes("HEAD^{tree}")) return tree;
      return args[0] === "symbolic-ref" ? "main" : SHA;
    }),
  };
}

describe("starter provenance at creation", () => {
  it.each(SETUP_TYPES)(
    "records the copied %s starter through the canonical config",
    async type => {
      const destination = join(root, "project");
      await runSetupProject(destination, { type }, dependencies());
      const config = JSON.parse(
        await readFile(join(destination, CONFIG), "utf8")
      );
      const starter = resolveStarter(type);
      expect(config.starter.templates).toEqual([
        {
          repo: `${starter.owner}/${starter.repo}`,
          ref: "main",
          lastSync: { sha: SHA, at: expect.any(String) },
        },
      ]);
      expect(
        Number.isNaN(Date.parse(config.starter.templates[0].lastSync.at))
      ).toBe(false);
      expect(config.extension).toBe("retained");
      expect(config.starter.extension).toBe("also-retained");
    }
  );

  it("reads fallback clone provenance before its Git history is removed", async () => {
    const deps = dependencies(false);
    const destination = join(root, "project");
    await runSetupProject(destination, { type: "expo" }, deps);
    const config = JSON.parse(
      await readFile(join(destination, CONFIG), "utf8")
    );
    expect(config.starter.templates[0].lastSync.sha).toBe(SHA);
    expect(deps.captureCommand).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: destination }
    );
    expect(deps.captureCommand.mock.invocationCallOrder[0]).toBeLessThan(
      deps.runCommand.mock.invocationCallOrder[2] ?? Number.NaN
    );
  });

  it("refuses to stamp a GitHub template whose copied files do not match the snapshot", async () => {
    const deps = dependencies(true, "c".repeat(40));
    await expect(
      runSetupProject(join(root, "project"), { type: "expo" }, deps)
    ).rejects.toThrow("starter changed");
    expect(deps.runApply).not.toHaveBeenCalled();
  });
});
