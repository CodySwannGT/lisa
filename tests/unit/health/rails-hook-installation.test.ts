import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  inspectHookInstallation,
  readCoreHooksPath,
} from "../../../src/health/hook-inspection.js";
import {
  createRailsHookFixture,
  fixtureGit,
  seedFixtureHooks,
  type RailsHookFixture,
} from "../../helpers/rails-hook-install-fixture.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";

describe("Rails hooks at Git's actual installation path", () => {
  let fixture: RailsHookFixture;

  beforeEach(async () => {
    fixture = await createRailsHookFixture();
  });

  afterEach(async () => {
    await cleanupTempDir(fixture.root);
  });

  it("recognizes shared installed hooks from a genuine linked worktree", async () => {
    const linked = path.join(fixture.root, "linked");
    fixtureGit(fixture, ["worktree", "add", "--detach", linked, "HEAD"]);
    seedFixtureHooks(fixture, linked);
    const result = await inspectHookInstallation(
      linked,
      ["rails"],
      readCoreHooksPath,
      5_000,
      new AbortController().signal
    );
    expect(result).toEqual({ status: "pass", drift: [] });
  });

  it.each(["relative", "absolute"])(
    "recognizes a %s configured core.hooksPath",
    async kind => {
      const configured =
        kind === "relative"
          ? ".rails-hooks"
          : path.join(fixture.root, "absolute-hooks");
      fixtureGit(fixture, ["config", "core.hooksPath", configured]);
      seedFixtureHooks(fixture);
      const result = await inspectHookInstallation(
        fixture.project,
        ["rails"],
        readCoreHooksPath,
        5_000,
        new AbortController().signal
      );
      expect(result).toEqual({ status: "pass", drift: [] });
    }
  );
});
