/**
 * Regression tests for issue #1398: plugin sync checks must catch generated
 * artifact additions and deletions, not only tracked diffs.
 *
 * @module tests/unit/scripts/plugin-sync-scripts
 */
import type { SpawnSyncReturns } from "node:child_process";
import * as fs from "fs-extra";
import * as path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

// `beforeEach` used to seed a plugin repo and run the real `build-plugins.sh`,
// so every case paid a full shell build: 9.2s of the 10s default, measured at
// load ~48 on 18 cores, and at 16-way concurrency (load 68.5) 15/16 processes
// failed, every one `Hook timed out in 10000ms` (CodySwannGT/lisa#2490).
//
// The build now runs ONCE, in `beforeAll`, and each case copies the built tree.
// That is the remedy CodySwannGT/lisa#2822 asks for — reduce the work rather
// than raise the budget — and it is available here because no case needs a
// DIFFERENT build, only its own disposable copy of the same one. The copy still
// carries `.git`, so each case keeps the seeded commit and its own index.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(".");
const PLUGINS = "plugins";
const SRC = "src";
const BASE = "base";
const SKILLS = "skills";
const CLAUDE_PLUGIN = ".claude-plugin";
const SOURCE_SKILLS_ROOT = path.join(PLUGINS, SRC, BASE, SKILLS);
/** The build entry point, and a canonical whose copies land in three lanes. */
const BUILD_SCRIPT = "build-plugins.sh";
const INVOKED_AS_SCRIPT = "invoked-as-script.mjs";
const SCRIPT_NAMES = [
  BUILD_SCRIPT,
  "check-plugins-sync.sh",
  "generate-agy-plugin-artifacts.mjs",
  "generate-codex-plugin-artifacts.mjs",
  "generate-copilot-plugin-artifacts.mjs",
  "generate-cursor-plugin-artifacts.mjs",
  // #3064. Every materialize call in build-plugins.sh is guarded on this
  // generator being present, so a fixture without it produced a build that
  // wrote NOTHING outside plugins/ — which is exactly the state the sync check
  // now refuses. Vendoring it is not widening the fixture to suit the check:
  // materializing is part of what build-plugins.sh does, and a fixture that
  // skipped it was under-representing the script it exists to exercise.
  "materialize-copy-overwrite.mjs",
] as const;

/** Manifest of every destination the build materialized, written by the build. */
const MATERIALIZED_MANIFEST = path.join(PLUGINS, "materialized-artifacts.json");

/** A generated copy that lives outside `plugins/`, and its canonical source. */
const GENERATED_COPY = path.join(
  "all",
  "copy-overwrite",
  "scripts",
  "lib",
  INVOKED_AS_SCRIPT
);
const CANONICAL_SOURCE = path.join("scripts", "lib", INVOKED_AS_SCRIPT);

/** A lane the build does not currently write into, for the derivation case. */
const NEW_LANE_COPY = path.join(
  "nestjs",
  "copy-overwrite",
  "scripts",
  "lib",
  INVOKED_AS_SCRIPT
);

describe("plugin sync shell scripts (#1398)", () => {
  let repoDir: string;
  let builtRepoTemplate: string;

  beforeAll(async () => {
    builtRepoTemplate = await createTempDir();
    await seedRepo(builtRepoTemplate);
  });

  afterAll(async () => {
    await cleanupTempDir(builtRepoTemplate);
  });

  beforeEach(async () => {
    repoDir = await createTempDir();
    await fs.copy(builtRepoTemplate, repoDir);
  });

  afterEach(async () => {
    await cleanupTempDir(repoDir);
  });

  it("executes the Codex generator through build-plugins.sh", async () => {
    expect(
      await fs.pathExists(
        path.join(repoDir, PLUGINS, "lisa", ".codex-plugin", "plugin.json")
      )
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(
          repoDir,
          PLUGINS,
          "lisa",
          SKILLS,
          "existing",
          "agents",
          "openai.yaml"
        )
      )
    ).toBe(true);
  });

  it("fails when a committed source-only addition creates untracked generated artifacts", async () => {
    await writeSkill(repoDir, "new-source-only", "New source-only skill");
    git(["add", path.join(SOURCE_SKILLS_ROOT, "new-source-only", "SKILL.md")]);
    git(["commit", "-m", "test: add source without artifacts"]);

    const result = runCheckPlugins(repoDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Generated plugin artifacts are out of sync"
    );
    expect(result.stderr).toContain("plugins/lisa/skills/new-source-only");
  });

  it("removes stale generated artifacts when a source plugin path is retired", async () => {
    await fs.remove(path.join(repoDir, PLUGINS, SRC, "wiki"));
    git(["add", path.join(PLUGINS, SRC, "wiki")]);
    git(["commit", "-m", "test: remove plugin source without artifacts"]);

    const result = runCheckPlugins(repoDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Generated plugin artifacts are out of sync"
    );
    expect(result.stderr).toContain("plugins/lisa-wiki");
    expect(await fs.pathExists(path.join(repoDir, PLUGINS, "lisa-wiki"))).toBe(
      false
    );
  });

  // #3064. build-plugins.sh generates in two places and the sync check
  // inspected one of them. The four cases below are the four ways the other
  // half can be wrong; every one of them passed before the check was widened.

  it("records every destination the build materialized outside plugins/", async () => {
    const manifest = (await fs.readJson(
      path.join(repoDir, MATERIALIZED_MANIFEST)
    )) as string[];

    expect(manifest).toContain(GENERATED_COPY);
    expect(manifest.every(entry => !entry.startsWith("plugins/"))).toBe(true);
  });

  it("fails when a generated file outside plugins/ is edited directly", async () => {
    await fs.appendFile(
      path.join(repoDir, GENERATED_COPY),
      "\n// edited in the generated copy\n"
    );
    git(["add", GENERATED_COPY]);
    git(["commit", "-m", "test: edit a generated copy directly"]);

    const result = runCheckPlugins(repoDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Generated files outside plugins/ are out of sync"
    );
    expect(result.stderr).toContain(GENERATED_COPY);
  });

  it("fails when a canonical source is edited without a rebuild", async () => {
    await fs.appendFile(
      path.join(repoDir, CANONICAL_SOURCE),
      "\n// edited upstream, copies not rebuilt\n"
    );
    git(["add", CANONICAL_SOURCE]);
    git(["commit", "-m", "test: edit canonical without rebuilding copies"]);

    const result = runCheckPlugins(repoDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Generated files outside plugins/ are out of sync"
    );
    expect(result.stderr).toContain(GENERATED_COPY);
  });

  it("covers a materialize destination added after the fact, with no second list", async () => {
    // Appended BELOW the final line — the natural place to add a call, and the
    // placement that would escape a record written at the end of the script.
    await fs.appendFile(
      path.join(repoDir, "scripts", BUILD_SCRIPT),
      [
        "",
        `mkdir -p "$ROOT_DIR/${path.dirname(NEW_LANE_COPY)}"`,
        `materialize "$ROOT_DIR/${CANONICAL_SOURCE}" \\`,
        `  "$ROOT_DIR/${NEW_LANE_COPY}"`,
        "",
      ].join("\n")
    );
    git(["add", path.join("scripts", BUILD_SCRIPT)]);
    git(["commit", "-m", "test: materialize into a new lane"]);

    const result = runCheckPlugins(repoDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(NEW_LANE_COPY);
  });

  it("refuses to pass when the build resolved zero generated files", async () => {
    // Every materialize call is guarded on this generator, so removing it
    // reproduces the shape that matters: a build that quietly stops writing
    // anything outside plugins/ and a tree that is clean because of it.
    await fs.remove(
      path.join(repoDir, "scripts", "materialize-copy-overwrite.mjs")
    );
    expect(run(["bash", `scripts/${BUILD_SCRIPT}`], repoDir).status).toBe(0);
    expect(
      await fs.readJson(path.join(repoDir, MATERIALIZED_MANIFEST))
    ).toEqual([]);
    git(["add", "-A"]);
    git(["commit", "-m", "test: build that materializes nothing"]);

    const result = runCheckPlugins(repoDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("recorded ZERO generated files");
  });

  /**
   * Seed a disposable git repo with the real plugin sync shell scripts and a
   * minimal base plugin source/artifact pair.
   * @param dir Temporary repo root.
   */
  async function seedRepo(dir: string): Promise<void> {
    await fs.ensureDir(path.join(dir, "scripts"));
    for (const scriptName of SCRIPT_NAMES) {
      await fs.copy(
        path.join(REPO_ROOT, "scripts", scriptName),
        path.join(dir, "scripts", scriptName)
      );
    }
    await fs.copy(
      path.join(REPO_ROOT, "scripts", "lib"),
      path.join(dir, "scripts", "lib")
    );
    await fs.writeJson(path.join(dir, "package.json"), {
      name: "plugin-sync-script-fixture",
      version: "9.9.9",
      scripts: {
        "build:plugins": "bash scripts/build-plugins.sh",
        "check:plugins": "bash scripts/check-plugins-sync.sh",
      },
    });
    await fs.ensureDir(path.join(dir, CLAUDE_PLUGIN));
    await fs.writeJson(path.join(dir, CLAUDE_PLUGIN, "marketplace.json"), {
      plugins: [
        { source: "./plugins/lisa" },
        { source: "./plugins/lisa-agy" },
        { source: "./plugins/lisa-copilot" },
        { source: "./plugins/lisa-cursor" },
        { source: "./plugins/lisa-wiki" },
        { source: "./plugins/lisa-wiki-agy" },
        { source: "./plugins/lisa-wiki-copilot" },
        { source: "./plugins/lisa-wiki-cursor" },
      ],
    });
    await writePluginManifest(dir, BASE, "lisa-fixture");
    await writePluginManifest(dir, "wiki", "lisa-wiki-fixture");
    await writeSkill(dir, "existing", "Existing fixture skill");
    await writeSkill(
      dir,
      "wiki-existing",
      "Existing wiki fixture skill",
      "wiki"
    );

    gitIn(dir, ["init", "-b", "main"]);
    gitIn(dir, ["config", "user.email", "test@example.com"]);
    gitIn(dir, ["config", "user.name", "Test User"]);
    expect(run(["bash", `scripts/${BUILD_SCRIPT}`], dir).status).toBe(0);
    gitIn(dir, ["add", "."]);
    gitIn(dir, ["commit", "-m", "test: seed plugin artifacts"]);
    expect(runCheckPlugins(dir).status).toBe(0);
  }

  /**
   * Write a minimal Lisa skill into the fixture's source plugin tree.
   * @param dir Temporary repo root.
   * @param skillName Skill directory and frontmatter name.
   * @param description Frontmatter description.
   * @param pluginName Source plugin directory under plugins/src.
   */
  async function writeSkill(
    dir: string,
    skillName: string,
    description: string,
    pluginName = BASE
  ): Promise<void> {
    const skillDir = path.join(
      dir,
      PLUGINS,
      SRC,
      pluginName,
      SKILLS,
      skillName
    );
    await fs.ensureDir(skillDir);
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        `name: ${skillName}`,
        `description: ${description}`,
        "---",
        "",
        `# ${skillName}`,
        "",
      ].join("\n")
    );
  }

  /**
   * Write the minimum Claude plugin manifest required by artifact generators.
   * @param dir Temporary repo root.
   * @param pluginName Source plugin directory under plugins/src.
   * @param manifestName Plugin manifest name.
   */
  async function writePluginManifest(
    dir: string,
    pluginName: string,
    manifestName: string
  ): Promise<void> {
    const manifestDir = path.join(dir, PLUGINS, SRC, pluginName, CLAUDE_PLUGIN);
    await fs.ensureDir(manifestDir);
    await fs.writeJson(path.join(manifestDir, "plugin.json"), {
      name: manifestName,
      version: "0.0.0",
      description: "Fixture plugin",
    });
  }

  /**
   * Run git in the current case's fixture repo and assert success.
   * @param args Git arguments.
   * @returns The completed child-process result.
   */
  function git(args: readonly string[]): SpawnSyncReturns<string> {
    return gitIn(repoDir, args);
  }

  /**
   * Run git in a named fixture repo and assert success.
   *
   * Explicit rather than closing over `repoDir`, because the one-time build now
   * seeds a template repo that is NOT the repo any case runs against.
   * @param dir Fixture repo root.
   * @param args Git arguments.
   * @returns The completed child-process result.
   */
  function gitIn(
    dir: string,
    args: readonly string[]
  ): SpawnSyncReturns<string> {
    const result = run(["git", ...args], dir);
    expect(result.status).toBe(0);
    return result;
  }
});

/**
 * Run the real plugin sync checker in a fixture repo.
 * @param cwd Fixture repo root.
 * @returns The completed child-process result.
 */
function runCheckPlugins(cwd: string): SpawnSyncReturns<string> {
  return run(["bash", "scripts/check-plugins-sync.sh"], cwd);
}

/**
 * Quiet-box liveness bound for the children this helper starts.
 *
 * Wider than the 15s default because the heaviest of them is a full
 * `build-plugins.sh` shell build, recorded in this file's own header at 9.2s
 * on a box at load ~48. 30s stays under the 37.5s ceiling above which the 8x
 * clamp would push the child's deadline past the per-case budget.
 */
const PLUGIN_SYNC_CHILD_BASE_MS = 30_000;

/**
 * Spawn a command with deterministic test environment defaults.
 * @param args Command plus arguments.
 * @param cwd Working directory.
 * @returns The completed child-process result.
 */
function run(args: readonly string[], cwd: string): SpawnSyncReturns<string> {
  // Git hooks export GIT_DIR/GIT_INDEX_FILE pointing at the parent repo, which
  // would redirect the fixture repo's git commands there; strip them so the
  // fixture stays hermetic when this suite runs under pre-push.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  return boundedSpawnSync({
    label: args.join(" "),
    command: args[0] as string,
    args: args.slice(1),
    baseMs: PLUGIN_SYNC_CHILD_BASE_MS,
    cwd,
    env: {
      ...env,
      HUSKY: "0",
    },
  });
}
