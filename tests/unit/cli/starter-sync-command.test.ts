import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { runLandingCommand } from "../../../src/cli/pr-landing.js";
import { describe, expect, it, vi } from "vitest";
import { runStarterSync } from "../../../src/cli/starter-sync-command.js";
import { captureCommand } from "../../../src/cli/starter-provenance.js";
import type { StarterSyncOptions } from "../../../src/cli/starter-sync.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const STARTER = "example/starter";
const UNTRACKED = "untracked.txt";
const DIRECT = "direct-when-clean";
const CONFIG = ".lisa.config.json";
const OWNED = "owned.txt";
const PR_URL = "https://github.com/example/app/pull/1";

/**
 * Create a disposable Git checkout with a controlled GitHub boundary.
 * @param strategy - Explicit strategy override.
 * @returns Git fixture and injected operations.
 */
async function fixture(strategy?: string) {
  const root = await realpath(await createTempDir());
  const git = (args: readonly string[], cwd = root) =>
    captureCommand("git", args, { cwd });
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.name", "Landing fixture"]);
  await git(["config", "user.email", "fixture@example.invalid"]);
  await git(["config", "core.hooksPath", "/dev/null"]);
  await writeFile(
    path.join(root, CONFIG),
    JSON.stringify({
      starter: {
        sync: { strategy },
        templates: [
          {
            repo: STARTER,
            ref: "main",
            lastSync: { sha: "a".repeat(40), at: "2026-09-15T00:00:00Z" },
          },
        ],
      },
    })
  );
  await writeFile(path.join(root, OWNED), "before\n");
  await git(["add", "--", CONFIG, OWNED]);
  await git(["commit", "-m", "Initial fixture"]);
  const before = await git(["rev-parse", "HEAD"]);
  const sync = vi.fn(async ({ projectRoot }: StarterSyncOptions) => {
    await writeFile(path.join(projectRoot, OWNED), "after\n");
    return [{ repo: STARTER, state: "updated" as const, changed: [OWNED] }];
  });
  const run = vi.fn(
    async (command: string, args: readonly string[], cwd: string) => {
      if (command === "git" && args[0] !== "push")
        await captureCommand(command, args, { cwd });
    }
  );
  const capture = vi.fn(
    async (
      command: string,
      args: readonly string[],
      options?: { cwd?: string }
    ) => {
      if (command === "gh")
        return args[0] === "repo"
          ? "example/app"
          : args[1] === "list"
            ? "[]"
            : PR_URL;
      return await captureCommand(command, args, options);
    }
  );
  return { root, git, before, sync, run, capture };
}

describe("starter sync landing", () => {
  it("opens the default PR from an isolated worktree and preserves dirty work", async () => {
    const f = await fixture();
    try {
      await writeFile(path.join(f.root, OWNED), "operator edit\n");
      await writeFile(path.join(f.root, UNTRACKED), "keep\n");
      const result = await runStarterSync({ path: f.root }, f);
      expect(result.state).toBe("pull-request");
      expect(result.url).toBe(PR_URL);
      expect(await f.git(["rev-parse", "HEAD"])).toBe(f.before);
      expect(await f.git(["branch", "--show-current"])).toBe("main");
      expect(await readFile(path.join(f.root, OWNED), "utf8")).toBe(
        "operator edit\n"
      );
      expect(await readFile(path.join(f.root, UNTRACKED), "utf8")).toBe(
        "keep\n"
      );
      const push = f.run.mock.calls.find(
        ([command, args]) => command === "git" && args[0] === "push"
      );
      expect(push?.[1][2]).toMatch(/^HEAD:refs\/heads\/chore\/starter-sync-/);
    } finally {
      await cleanupTempDir(f.root);
    }
  });

  it("commits direct updates only on a clean tree without using GitHub", async () => {
    const f = await fixture(DIRECT);
    try {
      const result = await runStarterSync({ path: f.root }, f);
      expect(result.state).toBe("committed");
      expect(await f.git(["rev-parse", "HEAD"])).not.toBe(f.before);
      expect(await f.git(["status", "--porcelain"])).toBe("");
      expect(await readFile(path.join(f.root, OWNED), "utf8")).toBe("after\n");
      expect(f.capture.mock.calls.some(([command]) => command === "gh")).toBe(
        false
      );
      expect(f.run.mock.calls.some(([, args]) => args[0] === "push")).toBe(
        false
      );
    } finally {
      await cleanupTempDir(f.root);
    }
  });

  it.each([OWNED, UNTRACKED])(
    "refuses dirty direct mode before applying: %s",
    async name => {
      const f = await fixture(DIRECT);
      try {
        await writeFile(path.join(f.root, name), "keep\n");
        await expect(runStarterSync({ path: f.root }, f)).rejects.toThrow(
          /uncommitted/i
        );
        expect(f.sync).not.toHaveBeenCalled();
        expect(await f.git(["rev-parse", "HEAD"])).toBe(f.before);
        expect(await readFile(path.join(f.root, name), "utf8")).toBe("keep\n");
      } finally {
        await cleanupTempDir(f.root);
      }
    }
  );

  it("does not commit or publish a partially failed sync", async () => {
    const f = await fixture(DIRECT);
    try {
      const sync = async ({ projectRoot }: StarterSyncOptions) => {
        await writeFile(path.join(projectRoot, OWNED), "partial\n");
        return [
          {
            repo: STARTER,
            state: "failed" as const,
            changed: [OWNED],
            error: "conflict",
          },
        ];
      };
      await expect(
        runStarterSync({ path: f.root }, { ...f, sync })
      ).rejects.toThrow(/conflict/);
      expect(await f.git(["rev-parse", "HEAD"])).toBe(f.before);
      expect(await readFile(path.join(f.root, OWNED), "utf8")).toBe(
        "partial\n"
      );
    } finally {
      await cleanupTempDir(f.root);
    }
  });

  it("does not commit or open a PR when the starter is current", async () => {
    const f = await fixture();
    try {
      const sync = async () => [
        { repo: STARTER, state: "current" as const, changed: [] },
      ];
      expect(
        (await runStarterSync({ path: f.root }, { ...f, sync })).state
      ).toBe("current");
      expect(
        (await runStarterSync({ path: f.root }, { ...f, sync })).state
      ).toBe("current");
      expect(
        f.run.mock.calls.some(
          ([, args]) => args[0] === "push" || args[0] === "commit"
        )
      ).toBe(false);
      expect(await f.git(["rev-parse", "HEAD"])).toBe(f.before);
    } finally {
      await cleanupTempDir(f.root);
    }
  });

  it("reuses an open starter PR instead of creating another", async () => {
    const f = await fixture();
    try {
      const key = createHash("sha256")
        .update(`main\n${f.before}`)
        .digest("hex")
        .slice(0, 12);
      const capture = async (
        command: string,
        args: readonly string[],
        options?: { cwd?: string }
      ) =>
        command === "gh" && args[1] === "list"
          ? JSON.stringify([
              {
                url: PR_URL,
                headRefName: `chore/starter-sync-${key}-existing`,
              },
            ])
          : await f.capture(command, args, options);
      expect(
        (await runStarterSync({ path: f.root }, { ...f, capture })).url
      ).toBe(PR_URL);
      expect(f.sync).not.toHaveBeenCalled();
      expect(f.run).not.toHaveBeenCalled();
    } finally {
      await cleanupTempDir(f.root);
    }
  });

  it("refuses to include an unrelated edit that arrives during direct sync", async () => {
    const f = await fixture(DIRECT);
    try {
      const sync = async (options: StarterSyncOptions) => {
        const results = await f.sync(options);
        await writeFile(path.join(f.root, "concurrent.txt"), "operator work\n");
        return results;
      };
      await expect(
        runStarterSync({ path: f.root }, { ...f, sync })
      ).rejects.toThrow(/Unrelated changes/);
      expect(await f.git(["rev-parse", "HEAD"])).toBe(f.before);
      expect(await f.git(["diff", "--cached", "--name-only"])).toBe("");
      expect(await readFile(path.join(f.root, "concurrent.txt"), "utf8")).toBe(
        "operator work\n"
      );
    } finally {
      await cleanupTempDir(f.root);
    }
  });
  it("refuses uncommitted starter settings before creating a worktree", async () => {
    const f = await fixture();
    try {
      const config = JSON.parse(
        await readFile(path.join(f.root, CONFIG), "utf8")
      );
      config.starter.templates[0].ref = "another-branch";
      await writeFile(path.join(f.root, CONFIG), JSON.stringify(config));
      await expect(runStarterSync({ path: f.root }, f)).rejects.toThrow(
        /Commit the starter configuration/
      );
      expect(f.sync).not.toHaveBeenCalled();
      expect(f.run).not.toHaveBeenCalled();
    } finally {
      await cleanupTempDir(f.root);
    }
  });

  it("retains a rejected push and retries without colliding with its branch", async () => {
    const f = await fixture();
    const worktrees: string[] = [];
    try {
      const run = async (
        command: string,
        args: readonly string[],
        cwd: string
      ) => {
        if (args[0] === "worktree" && args[1] === "add")
          worktrees.push(args[5]!);
        if (args[0] === "push") throw new Error("push rejected by hook");
        await f.run(command, args, cwd);
      };
      await expect(
        runStarterSync({ path: f.root }, { ...f, run })
      ).rejects.toThrow(/retained at/);
      expect(await readFile(path.join(worktrees[0]!, OWNED), "utf8")).toBe(
        "after\n"
      );
      expect((await runStarterSync({ path: f.root }, f)).url).toBe(PR_URL);
      expect(await f.git(["rev-parse", "HEAD"])).toBe(f.before);
    } finally {
      for (const worktree of worktrees) {
        await f.git(["worktree", "remove", worktree]);
        await cleanupTempDir(path.dirname(worktree));
      }
      await cleanupTempDir(f.root);
    }
  });

  it("runs a real refusing commit hook headlessly and leaves changes unpublished", async () => {
    const f = await fixture(DIRECT);
    try {
      const hooks = path.join(f.root, ".git", "fixture-hooks");
      await mkdir(hooks);
      const hook = path.join(hooks, "pre-commit");
      await writeFile(
        hook,
        "#!/bin/sh\n[ ! -t 0 ] || exit 99\necho no-tty > .git/fixture-hooks/no-tty\necho refusing-fixture-hook >&2\nexit 42\n"
      );
      await chmod(hook, 0o700);
      await f.git(["config", "core.hooksPath", hooks]);
      await expect(
        runStarterSync({ path: f.root }, { ...f, run: runLandingCommand })
      ).rejects.toThrow(/git failed/);
      expect(await readFile(path.join(hooks, "no-tty"), "utf8")).toBe(
        "no-tty\n"
      );
      expect(await f.git(["rev-parse", "HEAD"])).toBe(f.before);
      expect(await readFile(path.join(f.root, OWNED), "utf8")).toBe("after\n");
      expect(f.capture.mock.calls.some(([command]) => command === "gh")).toBe(
        false
      );
    } finally {
      await cleanupTempDir(f.root);
    }
  });
});
