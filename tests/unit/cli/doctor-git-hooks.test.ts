import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";
import {
  createRailsHookFixture,
  fixtureGit,
  seedFixtureHooks,
  type RailsHookFixture,
} from "../../helpers/rails-hook-install-fixture.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";

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
    const check = result.checks.find(
      row => row.name === "Git hooks installed?"
    );
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
      result.checks.find(row => row.name === "Git hooks installed?")
    ).toMatchObject({ status: "ok" });
  });
});
