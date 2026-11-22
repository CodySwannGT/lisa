import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRailsHookFixture,
  installedFixtureHooks,
  RAILS_HOOKS,
  runFixtureStartup,
  seedFixtureHooks,
  type RailsHookFixture,
} from "../../helpers/rails-hook-install-fixture.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";

const STARTUP_SURFACES = [
  ["Claude/plugin", "plugins/lisa/.claude-plugin/plugin.json"],
  ["Codex/plugin", "plugins/lisa/.codex-plugin/hooks.json"],
  ["Cursor/plugin", "plugins/lisa-cursor/hooks/hooks.json"],
  ["Copilot/plugin", "plugins/lisa-copilot/.claude-plugin/plugin.json"],
  ["Devin/plugin", "plugins/lisa-devin/hooks.json"],
] as const;

describe("registered Rails startup installation", () => {
  let fixture: RailsHookFixture;

  beforeEach(async () => {
    fixture = await createRailsHookFixture();
  });

  afterEach(async () => {
    await cleanupTempDir(fixture.root);
  });

  it.each(STARTUP_SURFACES)(
    "%s installs missing wrappers through the registered startup path",
    async (_name, manifest) => {
      expect(await installedFixtureHooks(fixture)).toEqual([]);
      const runs = await runFixtureStartup(fixture, manifest);
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.every(run => run.status === 0)).toBe(true);
      expect(await installedFixtureHooks(fixture)).toEqual(RAILS_HOOKS);
      expect(await fs.readFile(fixture.journal, "utf8")).toBe(
        "exec lefthook install\n"
      );
    }
  );

  it("keeps installed wrappers and avoids another Bundler invocation", async () => {
    seedFixtureHooks(fixture);
    const before = await fs.readFile(fixture.journal, "utf8");
    const runs = await runFixtureStartup(fixture, STARTUP_SURFACES[0][1]);
    expect(runs.every(run => run.status === 0)).toBe(true);
    expect(await installedFixtureHooks(fixture)).toEqual(RAILS_HOOKS);
    expect(await fs.readFile(fixture.journal, "utf8")).toBe(before);
  });

  it("reports a failed installation once and leaves the session running", async () => {
    const runs = await runFixtureStartup(
      fixture,
      STARTUP_SURFACES[0][1],
      fixture.project,
      { LISA_TEST_BUNDLE_FAIL: "1" }
    );
    expect(runs.every(run => run.status === 0)).toBe(true);
    const output = runs.map(run => `${run.stdout}${run.stderr}`).join("");
    expect(output).toContain("bundle exec lefthook install");
    expect(output.trim().split("\n")).toHaveLength(1);
    expect(await installedFixtureHooks(fixture)).toEqual([]);
  });
});
