import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { GIT_BIN } from "../../support/git-executable.js";

/**
 * Where the setup-jira-cli SessionStart hook reads .lisa.config*.json from.
 *
 * The hook's write target has always been absolute — the git toplevel, or
 * CLAUDE_PROJECT_DIR — while its reads were relative to the process working
 * directory. `jq` on a missing file yields empty and every consumer treats
 * empty as absent, so a session launched from a subdirectory read a directory
 * it had never written to, concluded the project had configured nothing, and
 * exited 0. Running from the project root cannot tell the two resolutions
 * apart, so every case here runs the hook from a SUBDIRECTORY of a real git
 * repository — which is what makes `git rev-parse --show-toplevel` disagree
 * with `pwd` the way it does in a real session.
 *
 * See CodySwannGT/lisa#2768.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const SAFE_COMMAND_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const SITE = "example.atlassian.net";
const PROJECT_KEY = "LISA";
const LOGIN = "bot@example.com";
const LISA_CONFIG = ".lisa.config.json";
const LISA_CONFIG_LOCAL = ".lisa.config.local.json";
const JIRA_CONFIG_RELATIVE = path.join(".lisa", "jira-cli", ".config.yml");
const NESTED_SUBDIR = path.join("src", "nested");

const claudePluginHook = path.join(
  repoRoot,
  "plugins",
  "src",
  "base",
  "hooks",
  "setup-jira-cli.sh"
);
const codexHookScript = path.join(
  repoRoot,
  "src",
  "codex",
  "scripts",
  "setup-jira-cli.sh"
);

/**
 * Every shell implementation of the hook. The Claude plugin source fans out to
 * the Cursor and Copilot plugin copies verbatim; Codex ships its own
 * hand-maintained twin. One resolution rule living in two files is exactly how
 * the Codex half of this defect survived, so both are asserted here.
 */
const shellImplementations = [
  ["claude plugin hook", claudePluginHook],
  ["codex hook script", codexHookScript],
] as const;

describe.each(shellImplementations)(
  "setup-jira-cli config resolution (%s)",
  (_label, scriptPath) => {
    let tempDir: string;
    let homeDir: string;
    let projectDir: string;
    let sessionDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
      homeDir = path.join(tempDir, "home");
      projectDir = path.join(tempDir, "project");
      sessionDir = path.join(projectDir, NESTED_SUBDIR);
      await fs.ensureDir(homeDir);
      await fs.ensureDir(sessionDir);
      initGitRepo(projectDir, homeDir);
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("finds the project-root config when the session cwd is a subdirectory", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
        tracker: "jira",
      });

      const result = runHook({ JIRA_LOGIN: LOGIN });

      expect(result.status).toBe(0);
      const config = await readJiraConfig();
      expect(config).toContain("server: https://example.atlassian.net");
      expect(config).toContain(`login: ${LOGIN}`);
      expect(config).toContain(`project: ${PROJECT_KEY}`);
    });

    it("honors the local-config override from a subdirectory", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: "committed.atlassian.net" },
        jira: { project: "COMMITTED" },
        tracker: "jira",
      });
      await fs.writeJson(path.join(projectDir, LISA_CONFIG_LOCAL), {
        atlassian: { site: "override.atlassian.net" },
        jira: { project: "OVERRIDE" },
        tracker: "jira",
      });

      const result = runHook({ JIRA_LOGIN: LOGIN });

      expect(result.status).toBe(0);
      const config = await readJiraConfig();
      expect(config).toContain("server: https://override.atlassian.net");
      expect(config).toContain("project: OVERRIDE");
    });

    it("gates on the project-root tracker rather than the cwd's", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
        tracker: "linear",
      });
      // A stray config in the session directory must not govern the gate: the
      // project root is the authority, not wherever the harness launched.
      await fs.writeJson(path.join(sessionDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
        tracker: "jira",
      });

      const result = runHook({ JIRA_LOGIN: LOGIN });

      expect(result.status).toBe(0);
      expect(await jiraConfigExists()).toBe(false);
    });

    it("reports nothing configured for a project with no Lisa config at all", async () => {
      // The negative control. A directory with no .lisa.config*.json is
      // genuinely unconfigured, and must stay silent and successful — the same
      // command and the same exit status it produced before this change. If
      // resolving from the project root made an unconfigured project noisy,
      // the fix would be trading one bad report for another.
      const result = runHook({ JIRA_LOGIN: LOGIN });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(await jiraConfigExists()).toBe(false);
    });

    it("fails visibly instead of reporting nothing configured when the config is malformed", async () => {
      await fs.writeFile(
        path.join(projectDir, LISA_CONFIG),
        '{ "tracker": "jira",,, }'
      );

      const result = runHook({ JIRA_LOGIN: LOGIN });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("is not valid JSON");
      expect(await jiraConfigExists()).toBe(false);
    });

    it("fails visibly instead of reporting nothing configured when jq is unavailable", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
        tracker: "jira",
      });
      const jqLessPath = await makeJqLessBin();

      const result = runHook({ JIRA_LOGIN: LOGIN }, jqLessPath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("jq is not installed");
      expect(await jiraConfigExists()).toBe(false);
    });

    it("stays silent when jq is unavailable and the project has no Lisa config", async () => {
      // Control for the case above: without a config file there is nothing the
      // missing jq could have told us, so this is still an unconfigured
      // project rather than an unreadable one.
      const jqLessPath = await makeJqLessBin();

      const result = runHook({ JIRA_LOGIN: LOGIN }, jqLessPath);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    });

    /**
     * Run the hook under test from the nested session directory.
     * @param env - Environment variables to expose to the hook process.
     * @param commandPath - PATH for the hook process.
     * @returns The completed spawn result.
     */
    function runHook(env: NodeJS.ProcessEnv, commandPath = SAFE_COMMAND_PATH) {
      return boundedSpawnSync({
        label: "the setup-jira-cli hook under test",
        command: "/bin/bash",
        args: [scriptPath],
        cwd: sessionDir,
        env: { HOME: homeDir, PATH: commandPath, ...env },
        input: "{}\n",
      });
    }

    /**
     * Read the jira-cli config the hook wrote into the project root.
     * @returns The file contents.
     */
    function readJiraConfig(): Promise<string> {
      return fs.readFile(path.join(projectDir, JIRA_CONFIG_RELATIVE), "utf8");
    }

    /**
     * Whether the hook wrote a jira-cli config into the project root.
     * @returns True when the config file exists.
     */
    function jiraConfigExists(): Promise<boolean> {
      return fs.pathExists(path.join(projectDir, JIRA_CONFIG_RELATIVE));
    }

    /**
     * Build a PATH containing the commands the hook needs except `jq`.
     * @returns A PATH value exposing git, cat and mkdir but no jq.
     */
    async function makeJqLessBin(): Promise<string> {
      const binDir = path.join(tempDir, "jq-less-bin");
      await fs.ensureDir(binDir);
      for (const tool of [GIT_BIN, "/bin/cat", "/bin/mkdir"]) {
        await fs.ensureSymlink(tool, path.join(binDir, path.basename(tool)));
      }
      return binDir;
    }
  }
);

describe("setup-jira-cli shell implementations agree", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    homeDir = path.join(tempDir, "home");
    await fs.ensureDir(homeDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("writes byte-identical config from a subdirectory", async () => {
    const outputs = await Promise.all(
      shellImplementations.map(([label, scriptPath]) =>
        writeConfigFor(label, scriptPath)
      )
    );

    expect(outputs[0]).toBe(outputs[1]);
    expect(outputs[0]).toContain("server: https://example.atlassian.net");
  });

  /**
   * Run one implementation against its own fixture project and return what it
   * wrote.
   * @param label - Implementation name, used as the fixture directory name.
   * @param scriptPath - Absolute path to the shell implementation.
   * @returns The generated jira-cli config contents.
   */
  async function writeConfigFor(
    label: string,
    scriptPath: string
  ): Promise<string> {
    const projectDir = path.join(tempDir, label.replace(/\s+/gu, "-"));
    const sessionDir = path.join(projectDir, NESTED_SUBDIR);
    await fs.ensureDir(sessionDir);
    initGitRepo(projectDir, homeDir);
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
      atlassian: { site: SITE },
      jira: { project: PROJECT_KEY },
      tracker: "jira",
    });

    const result = boundedSpawnSync({
      label: `the ${label} implementation`,
      command: "/bin/bash",
      args: [scriptPath],
      cwd: sessionDir,
      env: { HOME: homeDir, JIRA_LOGIN: LOGIN, PATH: SAFE_COMMAND_PATH },
      input: "{}\n",
    });
    expect(result.status).toBe(0);

    return fs.readFile(path.join(projectDir, JIRA_CONFIG_RELATIVE), "utf8");
  }
});

/**
 * Initialize a git repository so `git rev-parse --show-toplevel` resolves the
 * project root from any subdirectory, the way it does in a real session.
 *
 * The environment is deliberately minimal: an inherited GIT_DIR or GIT_WORK_TREE
 * from the surrounding suite would point the fixture at this repository.
 * @param projectDir - Directory to initialize.
 * @param homeDir - HOME for the git process, isolating global git config.
 */
function initGitRepo(projectDir: string, homeDir: string): void {
  const result = boundedSpawnSync({
    label: "git init for the setup-jira-cli fixture",
    command: GIT_BIN,
    args: ["-c", "init.defaultBranch=main", "init", projectDir],
    cwd: projectDir,
    env: { HOME: homeDir, PATH: SAFE_COMMAND_PATH },
  });
  expect(result.status).toBe(0);
}
