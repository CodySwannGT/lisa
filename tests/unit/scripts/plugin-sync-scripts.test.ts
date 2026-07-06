/**
 * Regression tests for issue #1398: plugin sync checks must catch generated
 * artifact additions and deletions, not only tracked diffs.
 *
 * @module tests/unit/scripts/plugin-sync-scripts
 */
import { spawnSync } from "node:child_process";
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = path.resolve(".");
const PLUGINS = "plugins";
const SRC = "src";
const BASE = "base";
const SKILLS = "skills";
const CLAUDE_PLUGIN = ".claude-plugin";
const SOURCE_SKILLS_ROOT = path.join(PLUGINS, SRC, BASE, SKILLS);
const SCRIPT_NAMES = [
  "build-plugins.sh",
  "check-plugins-sync.sh",
  "generate-agy-plugin-artifacts.mjs",
  "generate-codex-plugin-artifacts.mjs",
  "generate-copilot-plugin-artifacts.mjs",
  "generate-cursor-plugin-artifacts.mjs",
] as const;

describe("plugin sync shell scripts (#1398)", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await createTempDir();
    await seedRepo(repoDir);
  });

  afterEach(async () => {
    await cleanupTempDir(repoDir);
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

    git(["init", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test User"]);
    expect(run(["bash", "scripts/build-plugins.sh"], dir).status).toBe(0);
    git(["add", "."]);
    git(["commit", "-m", "test: seed plugin artifacts"]);
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
   * Run git in the temporary fixture repo and assert success.
   * @param args Git arguments.
   * @returns The completed child-process result.
   */
  function git(args: readonly string[]): ReturnType<typeof spawnSync> {
    const result = run(["git", ...args], repoDir);
    expect(result.status).toBe(0);
    return result;
  }
});

/**
 * Run the real plugin sync checker in a fixture repo.
 * @param cwd Fixture repo root.
 * @returns The completed child-process result.
 */
function runCheckPlugins(cwd: string): ReturnType<typeof spawnSync> {
  return run(["bash", "scripts/check-plugins-sync.sh"], cwd);
}

/**
 * Spawn a command with deterministic test environment defaults.
 * @param args Command plus arguments.
 * @param cwd Working directory.
 * @returns The completed child-process result.
 */
function run(
  args: readonly string[],
  cwd: string
): ReturnType<typeof spawnSync> {
  // Git hooks export GIT_DIR/GIT_INDEX_FILE pointing at the parent repo, which
  // would redirect the fixture repo's git commands there; strip them so the
  // fixture stays hermetic when this suite runs under pre-push.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  return spawnSync(args[0] as string, args.slice(1), {
    cwd,
    encoding: "utf8",
    env: {
      ...env,
      HUSKY: "0",
    },
  });
}
