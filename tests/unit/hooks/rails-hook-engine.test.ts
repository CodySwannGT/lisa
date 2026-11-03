import * as fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureRailsHooks,
  inspectRailsHooks,
} from "../../../scripts/lib/rails-hooks.mjs";
import {
  createRailsHookFixture,
  fixtureGit,
  fixtureHooksDirectory,
  installedFixtureHooks,
  RAILS_HOOKS,
  seedFixtureHooks,
  type RailsHookFixture,
} from "../../helpers/rails-hook-install-fixture.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";
import { GIT_BIN } from "../../support/git-executable.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

describe("shared Rails hook engine", () => {
  let fixture: RailsHookFixture;

  beforeEach(async () => {
    fixture = await createRailsHookFixture();
  });

  afterEach(async () => cleanupTempDir(fixture.root));

  it("installs from a subdirectory and ignores inherited repository routing", async () => {
    const nested = path.join(fixture.project, "directory with spaces");
    await fs.ensureDir(nested);
    const result = await ensureRailsHooks(nested, {
      env: {
        ...fixture.env,
        GIT_DIR: path.join(fixture.root, "not-this-repository"),
      },
    });
    expect(result.status).toBe("installed");
    expect(await installedFixtureHooks(fixture)).toEqual(RAILS_HOOKS);
  });

  it.each(["relative", "absolute", "worktree"])(
    "installs at the actual %s hooks directory",
    async kind => {
      let root = fixture.project;
      if (kind === "worktree") {
        root = path.join(fixture.root, "linked worktree");
        fixtureGit(fixture, ["worktree", "add", "--detach", root, "HEAD"]);
      } else {
        fixtureGit(fixture, [
          "config",
          "core.hooksPath",
          kind === "relative"
            ? "hooks with spaces"
            : path.join(fixture.root, "external hooks"),
        ]);
      }
      expect((await ensureRailsHooks(root, { env: fixture.env })).status).toBe(
        "installed"
      );
      expect(await installedFixtureHooks(fixture, root)).toEqual(RAILS_HOOKS);
      if (kind === "worktree")
        expect(await installedFixtureHooks(fixture)).toEqual(RAILS_HOOKS);
    }
  );

  it("preserves bytes, mode and modification time of all installed wrappers", async () => {
    seedFixtureHooks(fixture);
    const files = RAILS_HOOKS.map(name =>
      path.join(fixtureHooksDirectory(fixture), name)
    );
    const before = await Promise.all(
      files.map(async file => ({
        text: await fs.readFile(file, "utf8"),
        mode: (await fs.stat(file)).mode,
        mtime: (await fs.stat(file)).mtimeMs,
      }))
    );
    expect(
      (await ensureRailsHooks(fixture.project, { env: fixture.env })).status
    ).toBe("already-installed");
    const after = await Promise.all(
      files.map(async file => ({
        text: await fs.readFile(file, "utf8"),
        mode: (await fs.stat(file)).mode,
        mtime: (await fs.stat(file)).mtimeMs,
      }))
    );
    expect(after).toEqual(before);
    expect(await fs.readFile(fixture.journal, "utf8")).toBe(
      "exec lefthook install\n"
    );
  });

  it("reports success without wrappers as a failure", async () => {
    await fs.writeFile(path.join(fixture.bin, "bundle"), "#!/bin/sh\nexit 0\n");
    const result = await ensureRailsHooks(fixture.project, {
      env: fixture.env,
    });
    expect(result.status).toBe("failed");
    for (const name of RAILS_HOOKS) expect(result.detail).toContain(name);
    expect(result.detail).toContain("bundle exec lefthook install");
  });

  it("reports missing Bundler through the actual spawn failure", async () => {
    const git = path.join(fixture.bin, "git");
    await fs.symlink(GIT_BIN, git);
    await fs.remove(path.join(fixture.bin, "bundle"));
    const result = await ensureRailsHooks(fixture.project, {
      env: { ...fixture.env, PATH: fixture.bin },
    });
    expect(result).toEqual({
      status: "failed",
      detail:
        "Rails Git hooks: Bundler is unavailable; run bundle exec lefthook install.",
    });
  });

  it("does not install for a checkout without Lefthook configuration", async () => {
    await fs.remove(path.join(fixture.project, "lefthook.yml"));
    expect(
      (await ensureRailsHooks(fixture.project, { env: fixture.env })).status
    ).toBe("not-applicable");
    expect(await fs.pathExists(fixture.journal)).toBe(false);
  });

  it("honors cancellation without running Bundler", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await ensureRailsHooks(fixture.project, {
          env: fixture.env,
          signal: controller.signal,
        })
      ).status
    ).toBe("failed");
    expect(await fs.pathExists(fixture.journal)).toBe(false);
  });

  it("bounds an actual hung installation and stops its descendant", async () => {
    await fs.writeFile(
      path.join(fixture.bin, "bundle"),
      [
        "#!/bin/sh",
        "node -e 'setInterval(() => {}, 1000)' &",
        'echo "$!" > "$LISA_TEST_BUNDLE_JOURNAL"',
        "wait",
        "",
      ].join("\n")
    );
    const result = await ensureRailsHooks(fixture.project, {
      env: fixture.env,
      timeoutMs: ioLatencyBudgetMs(1_500),
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("timed out");
    expect(result.detail).toContain("bundle exec lefthook install");
    const child = (await fs.readFile(fixture.journal, "utf8")).trim();
    expect(child).toMatch(/^\d+$/);
    const observed = boundedSpawnSync({
      command: "ps",
      args: ["-o", "stat=", "-p", child],
      label: "owned timed-out Bundler descendant state",
    });
    // A reaped process is absent; a zombie has already stopped executing and
    // is waiting for its new parent to reap it. Neither can continue the job.
    expect(
      observed.status === 1 || observed.stdout.trim().startsWith("Z")
    ).toBe(true);
    expect(await installedFixtureHooks(fixture)).toEqual([]);
  });

  it.each([
    "missing",
    "non-owner-executable",
    "wrong-content",
    "symlink",
    "oversized",
    "invalid-utf8",
  ])("rejects a %s wrapper without executing it", async kind => {
    seedFixtureHooks(fixture);
    const file = path.join(fixtureHooksDirectory(fixture), "pre-push");
    if (kind === "missing") await fs.remove(file);
    if (kind === "non-owner-executable") await fs.chmod(file, 0o610);
    if (kind === "wrong-content")
      await fs.writeFile(file, "#!/bin/sh\nexit 1\n");
    if (kind === "symlink") {
      await fs.move(file, `${file}-target`);
      await fs.symlink(`${file}-target`, file);
    }
    if (kind === "oversized")
      await fs.writeFile(file, `lefthook${"x".repeat(512 * 1024)}`);
    if (kind === "invalid-utf8")
      await fs.writeFile(file, Buffer.from([0xff, ...Buffer.from("lefthook")]));
    expect(
      await inspectRailsHooks(fixture.project, { env: fixture.env })
    ).toMatchObject({
      status: "fail",
      drift: ["pre-push"],
    });
    expect(await fs.readFile(fixture.journal, "utf8")).toBe(
      "exec lefthook install\n"
    );
  });

  it("accepts the existing case-insensitive Lefthook wrapper contract", async () => {
    seedFixtureHooks(fixture);
    await fs.writeFile(
      path.join(fixtureHooksDirectory(fixture), "pre-push"),
      "#!/bin/sh\n# LEFTHOOK\nexit 0\n"
    );
    expect(
      (await inspectRailsHooks(fixture.project, { env: fixture.env })).status
    ).toBe("pass");
  });
});
