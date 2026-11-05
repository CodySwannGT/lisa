import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";
import {
  createRailsHookFixture,
  fixtureGit,
  seedFixtureHooks,
  type RailsHookFixture,
} from "../../helpers/rails-hook-install-fixture.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";

const HOOK_CHECK_NAME = "Git hooks installed?";

describe("runDoctor Rails hook installation", () => {
  let fixture: RailsHookFixture;
  beforeEach(async () => {
    fixture = await createRailsHookFixture();
  });
  afterEach(async () => {
    await cleanupTempDir(fixture.root);
    vi.restoreAllMocks();
  });
  it("names missing Rails hooks and their installation command", async () => {
    const result = await runDoctor(
      fixture.project,
      { offline: true, json: true },
      { runUpdateCheck: vi.fn(), write: vi.fn(), setExitCode: vi.fn() }
    );
    const check = result.checks.find(row => row.name === HOOK_CHECK_NAME);
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("bundle exec lefthook install");
    for (const name of [
      "pre-commit",
      "commit-msg",
      "prepare-commit-msg",
      "pre-push",
    ]) {
      expect(check?.detail).toContain(name);
    }
  });

  it("recognizes installed Rails hooks inside a real linked worktree", async () => {
    const linked = path.join(fixture.root, "linked");
    fixtureGit(fixture, ["worktree", "add", "--detach", linked, "HEAD"]);
    seedFixtureHooks(fixture, linked);
    const result = await runDoctor(
      linked,
      { offline: true, json: true },
      { runUpdateCheck: vi.fn(), write: vi.fn(), setExitCode: vi.fn() }
    );
    expect(
      result.checks.find(row => row.name === HOOK_CHECK_NAME)
    ).toMatchObject({ status: "ok" });
  });

  it("does not impose Rails wrappers on a TypeScript Lefthook project", async () => {
    for (const name of ["Gemfile", "bin/rails", "config/application.rb"])
      await rm(path.join(fixture.project, name));
    await writeFile(path.join(fixture.project, "tsconfig.json"), "{}\n");
    await writeFile(
      path.join(fixture.project, "lefthook.yml"),
      "pre-commit:\n  commands:\n    lint:\n      run: npm run lint\n"
    );
    const result = await runDoctor(
      fixture.project,
      { offline: true, json: true },
      { runUpdateCheck: vi.fn(), write: vi.fn(), setExitCode: vi.fn() }
    );
    expect(
      result.checks.find(row => row.name === "Project type detection")?.detail
    ).toContain("typescript");
    expect(
      result.checks.find(row => row.name === HOOK_CHECK_NAME)
    ).toBeUndefined();
  });
});
