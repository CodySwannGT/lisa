import * as fs from "fs-extra";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RAILS_HOOK_ENGINE_FILES } from "../../../scripts/lib/rails-hooks.mjs";
import {
  installHookCompatibility,
  installHooks as installCodexHooks,
} from "../../../src/codex/hooks-installer.js";
import { installHooks as installOpenCodeHooks } from "../../../src/opencode/hooks-installer.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  createRailsHookFixture,
  installedFixtureHooks,
  RAILS_HOOKS,
  type RailsHookFixture,
} from "../../helpers/rails-hook-install-fixture.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";

const ENTRYPOINT = "install-rails-hooks.sh";
const STARTUP_CLOSURE = [
  ENTRYPOINT,
  "install-rails-hooks.mjs",
  ...RAILS_HOOK_ENGINE_FILES,
];

describe("Rails hook runtime delivery", () => {
  let fixture: RailsHookFixture;

  beforeEach(async () => {
    fixture = await createRailsHookFixture();
  });

  afterEach(async () => cleanupTempDir(fixture.root));

  it.each(["linked", "copied"])(
    "runs the standalone Codex %s startup closure",
    async kind => {
      const root = process.cwd();
      await installCodexHooks(root, fixture.project, ["rails"]);
      const hooks = path.join(fixture.project, ".codex/hooks/lisa");
      if (kind === "copied") {
        const managed = await installHookCompatibility(
          root,
          fixture.project,
          ["rails"],
          []
        );
        for (const filename of STARTUP_CLOSURE) {
          expect(managed).toContain(`hooks/lisa/${filename}`);
          expect((await fs.lstat(path.join(hooks, filename))).isFile()).toBe(
            true
          );
        }
        // Relocate just the copied closure: no package-store symlink or
        // accidental adjacent source helper can satisfy its imports.
        const detached = path.join(fixture.root, "copied runtime with spaces");
        await fs.ensureDir(detached);
        for (const filename of STARTUP_CLOSURE)
          await fs.copyFile(
            path.join(hooks, filename),
            path.join(detached, filename)
          );
        const run = boundedSpawnSync({
          command: "bash",
          args: [path.join(detached, ENTRYPOINT)],
          cwd: fixture.project,
          env: fixture.env,
          input: "{}",
          label: "copied Codex Rails startup",
        });
        expect(run.status, run.stderr).toBe(0);
        expect(run.stderr).toBe("");
      } else {
        expect(
          (await fs.lstat(path.join(hooks, ENTRYPOINT))).isSymbolicLink()
        ).toBe(true);
        const run = boundedSpawnSync({
          command: "bash",
          args: [path.join(hooks, ENTRYPOINT)],
          cwd: fixture.project,
          env: fixture.env,
          input: "{}",
          label: "linked Codex Rails startup",
        });
        expect(run.status, run.stderr).toBe(0);
        expect(run.stderr).toBe("");
      }
      expect(await installedFixtureHooks(fixture)).toEqual(RAILS_HOOKS);
    }
  );

  it("runs the installed OpenCode factory without host Node dependencies", async () => {
    await fs.remove(path.join(fixture.project, "node_modules"));
    await fs.remove(path.join(fixture.project, "package.json"));
    await installOpenCodeHooks(process.cwd(), fixture.project, ["rails"], []);
    const plugin = path.join(
      fixture.project,
      ".opencode/plugin/lisa-session-bootstrap.ts"
    );
    const program = [
      `const { LisaSessionBootstrap } = await import(${JSON.stringify(pathToFileURL(plugin).href)});`,
      `await LisaSessionBootstrap({ worktree: ${JSON.stringify(fixture.project)}, $: () => { throw new Error("unexpected package install"); } });`,
    ].join("\n");
    const run = boundedSpawnSync({
      command: "bun",
      args: ["--eval", program],
      cwd: fixture.project,
      env: fixture.env,
      label: "installed OpenCode Rails startup factory",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(await installedFixtureHooks(fixture)).toEqual(RAILS_HOOKS);
    expect(
      await fs.pathExists(path.join(fixture.project, "node_modules"))
    ).toBe(false);
  });
});
