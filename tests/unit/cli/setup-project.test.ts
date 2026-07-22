import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runSetupProject,
  type SetupProjectDependencies,
} from "../../../src/cli/setup-project.js";

/**
 * Create an isolated temporary directory for setup-project tests.
 * @returns Temporary directory path
 */
async function createTempDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "lisa-setup-project-"));
}

/**
 * Build fake setup-project dependencies.
 * @param authenticated - Whether `gh auth status` should succeed
 * @returns Injectable dependencies and their spies
 */
function createDeps(authenticated: boolean): {
  deps: SetupProjectDependencies;
  runApply: ReturnType<typeof vi.fn>;
  runCommand: ReturnType<typeof vi.fn>;
} {
  const runApply = vi.fn(async () => undefined);
  const runCommand = vi.fn(async (command: string, args: readonly string[]) => {
    if (
      command === "gh" &&
      args.join(" ") === "auth status" &&
      !authenticated
    ) {
      throw new Error("not authenticated");
    }
  });

  return { deps: { runApply, runCommand }, runApply, runCommand };
}

describe("runSetupProject", () => {
  it("fails closed at the apply step when dependencies are omitted", async () => {
    const root = await createTempDir();
    const destination = path.join(root, "existing-project");
    await mkdir(destination);
    await writeFile(path.join(destination, "package.json"), "{}\n");

    await expect(
      runSetupProject(destination, { type: "rails", yes: true })
    ).rejects.toThrow("runApply dependency was not configured");
  });

  it("requires --type", async () => {
    const { deps } = createDeps(true);

    await expect(runSetupProject("my-app", {}, deps)).rejects.toThrow(
      "Missing required --type"
    );
  });

  it("rejects unknown setup types with the valid type list", async () => {
    const { deps } = createDeps(true);

    await expect(
      runSetupProject("my-app", { type: "fortran" }, deps)
    ).rejects.toThrow("Valid types: rails, typescript, expo");
  });

  it("creates from a GitHub template when gh is authenticated", async () => {
    const root = await createTempDir();
    const destination = path.join(root, "my-app");
    const { deps, runApply, runCommand } = createDeps(true);

    await runSetupProject(destination, { type: "rails", yes: true }, deps);

    expect(runCommand).toHaveBeenCalledWith("gh", ["auth", "status"]);
    expect(runCommand).toHaveBeenCalledWith(
      "gh",
      [
        "repo",
        "create",
        "my-app",
        "--template",
        "CodySwannGT/railsstarter",
        "--public",
        "--clone",
      ],
      { cwd: root }
    );
    expect(runApply).toHaveBeenCalledWith(
      destination,
      expect.objectContaining({ yes: true })
    );
    expect(
      runCommand.mock.calls.filter(([command]) => command === "git")
    ).toEqual([]);
  });

  it("creates a clean fallback baseline before apply without inventing skipGitCheck", async () => {
    const root = await createTempDir();
    const destination = path.join(root, "my-app");
    const { deps, runApply, runCommand } = createDeps(false);

    await runSetupProject(destination, { type: "rails", yes: true }, deps);

    expect(runCommand.mock.calls).toEqual([
      ["gh", ["auth", "status"]],
      [
        "git",
        [
          "clone",
          "--depth=1",
          "https://github.com/CodySwannGT/railsstarter.git",
          destination,
        ],
      ],
      ["git", ["init", "-b", "main"], { cwd: destination }],
      ["git", ["add", "--all"], { cwd: destination }],
      [
        "git",
        [
          "-c",
          "user.name=Lisa",
          "-c",
          "user.email=lisa@localhost",
          "-c",
          "commit.gpgSign=false",
          "commit",
          "-m",
          "Initial starter baseline",
        ],
        { cwd: destination },
      ],
    ]);
    expect(runApply).toHaveBeenCalledWith(destination, { yes: true });
    expect(runCommand.mock.invocationCallOrder.at(-1)).toBeLessThan(
      runApply.mock.invocationCallOrder[0]
    );
  });

  it("treats an existing non-empty destination as an apply target", async () => {
    const root = await createTempDir();
    const destination = path.join(root, "my-app");
    await mkdir(destination);
    await writeFile(path.join(destination, "package.json"), "{}\n");
    const { deps, runApply, runCommand } = createDeps(true);

    await runSetupProject(
      destination,
      { type: "rails", yes: true, skipGitCheck: true },
      deps
    );

    expect(runCommand).not.toHaveBeenCalled();
    expect(runApply).toHaveBeenCalledWith(destination, {
      yes: true,
      skipGitCheck: true,
    });
  });

  it.each([
    ["dry-run", { dryRun: true }],
    ["validate", { validate: true }],
  ])("keeps %s free of clone, stage, and commit commands", async (_, mode) => {
    const root = await createTempDir();
    const destination = path.join(root, "my-app");
    const { deps, runApply, runCommand } = createDeps(false);

    await runSetupProject(destination, { type: "rails", ...mode }, deps);

    expect(runCommand).not.toHaveBeenCalled();
    expect(runApply).toHaveBeenCalledWith(destination, mode);
  });
});
