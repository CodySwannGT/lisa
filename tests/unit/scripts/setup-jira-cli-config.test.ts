import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const SAFE_COMMAND_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const SITE = "example.atlassian.net";
const PROJECT_KEY = "LISA";
const LOGIN = "bot@example.com";
const LISA_CONFIG = ".lisa.config.json";
const setupJiraCli = path.join(
  repoRoot,
  "plugins",
  "src",
  "base",
  "hooks",
  "setup-jira-cli.sh"
);

describe("setup-jira-cli hook config fallback", () => {
  let tempDir: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    homeDir = path.join(tempDir, "home");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(homeDir);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("uses Lisa config for non-secret Jira values when env vars are missing", async () => {
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
      atlassian: { site: SITE },
      jira: { project: PROJECT_KEY },
      tracker: "jira",
    });

    await runHook({ JIRA_LOGIN: LOGIN });

    await expectJiraConfig([
      "server: https://example.atlassian.net",
      `login: ${LOGIN}`,
      "project: LISA",
    ]);
  });

  it("keeps env vars ahead of local and global Lisa config", async () => {
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
      atlassian: { site: "global.atlassian.net" },
      jira: { project: "GLOBAL" },
      tracker: "jira",
    });
    await fs.writeJson(path.join(projectDir, ".lisa.config.local.json"), {
      atlassian: { site: "local.atlassian.net" },
      jira: { project: "LOCAL" },
      tracker: "jira",
    });

    await runHook({
      JIRA_LOGIN: LOGIN,
      JIRA_PROJECT: "ENV",
      JIRA_SERVER: "https://env.atlassian.net",
    });

    await expectJiraConfig([
      "server: https://env.atlassian.net",
      "project: ENV",
    ]);
  });

  /**
   * Execute the canonical setup-jira-cli hook inside the temporary project.
   * @param env - Environment variables to expose to the hook process.
   */
  function runHook(env: NodeJS.ProcessEnv) {
    const result = boundedSpawnSync({
      label: "the setup-jira-cli hook",
      command: "/bin/bash",
      args: [setupJiraCli],
      cwd: projectDir,
      env: {
        HOME: homeDir,
        PATH: SAFE_COMMAND_PATH,
        ...env,
      },
      input: "{}\n",
    });
    expect(result.status).toBe(0);
  }

  /**
   * Assert that the generated jira-cli config contains each expected line.
   * @param expectedLines - Config lines that must appear in the generated file.
   */
  async function expectJiraConfig(expectedLines: readonly string[]) {
    const config = await fs.readFile(
      path.join(projectDir, ".lisa", "jira-cli", ".config.yml"),
      "utf8"
    );
    for (const line of expectedLines) {
      expect(config).toContain(line);
    }
  }
});

/**
 * Every shell implementation of the SessionStart hook. The Claude plugin source
 * fans out to the Cursor and Copilot variants verbatim; Codex ships its own
 * hand-maintained twin. Both must gate identically or the tracker gate is only
 * half real.
 */
const trackerGateScripts = [
  ["claude plugin hook", setupJiraCli],
  [
    "codex hook script",
    path.join(repoRoot, "src", "codex", "scripts", "setup-jira-cli.sh"),
  ],
] as const;

describe.each(trackerGateScripts)(
  "setup-jira-cli tracker gate (%s)",
  (_label, scriptPath) => {
    let tempDir: string;
    let homeDir: string;
    let projectDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
      homeDir = path.join(tempDir, "home");
      projectDir = path.join(tempDir, "project");
      await fs.ensureDir(homeDir);
      await fs.ensureDir(projectDir);
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("skips the jira-cli config write when the tracker is not jira", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
        tracker: "linear",
      });

      await runHook({ JIRA_LOGIN: LOGIN });

      expect(await configExists()).toBe(false);
    });

    it("skips the jira-cli config write when no tracker is configured", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
      });

      await runHook({ JIRA_LOGIN: LOGIN });

      expect(await configExists()).toBe(false);
    });

    it("writes the jira-cli config when the tracker is jira", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
        tracker: "jira",
      });

      await runHook({ JIRA_LOGIN: LOGIN });

      expect(await configExists()).toBe(true);
    });

    it("honors a local-config tracker override over the committed tracker", async () => {
      await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
        atlassian: { site: SITE },
        jira: { project: PROJECT_KEY },
        tracker: "jira",
      });
      await fs.writeJson(path.join(projectDir, ".lisa.config.local.json"), {
        tracker: "github",
      });

      await runHook({ JIRA_LOGIN: LOGIN });

      expect(await configExists()).toBe(false);
    });

    /**
     * Execute the hook under test inside the temporary project.
     * @param env - Environment variables to expose to the hook process.
     */
    function runHook(env: NodeJS.ProcessEnv) {
      const result = boundedSpawnSync({
        label: "the setup-jira-cli hook under test",
        command: "/bin/bash",
        args: [scriptPath],
        cwd: projectDir,
        env: {
          HOME: homeDir,
          PATH: SAFE_COMMAND_PATH,
          ...env,
        },
        input: "{}\n",
      });
      expect(result.status).toBe(0);
    }

    /**
     * Whether the hook wrote a jira-cli config into the temporary project.
     * @returns True when `.lisa/jira-cli/.config.yml` exists.
     */
    function configExists(): Promise<boolean> {
      return fs.pathExists(
        path.join(projectDir, ".lisa", "jira-cli", ".config.yml")
      );
    }
  }
);
