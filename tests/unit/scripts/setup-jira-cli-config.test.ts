import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
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
    await fs.writeJson(path.join(projectDir, ".lisa.config.json"), {
      atlassian: { site: "example.atlassian.net" },
      jira: { project: "LISA" },
    });

    await runHook({ JIRA_LOGIN: "bot@example.com" });

    await expectJiraConfig([
      "server: https://example.atlassian.net",
      "login: bot@example.com",
      "project: LISA",
    ]);
  });

  it("keeps env vars ahead of local and global Lisa config", async () => {
    await fs.writeJson(path.join(projectDir, ".lisa.config.json"), {
      atlassian: { site: "global.atlassian.net" },
      jira: { project: "GLOBAL" },
    });
    await fs.writeJson(path.join(projectDir, ".lisa.config.local.json"), {
      atlassian: { site: "local.atlassian.net" },
      jira: { project: "LOCAL" },
    });

    await runHook({
      JIRA_LOGIN: "bot@example.com",
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
  async function runHook(env: NodeJS.ProcessEnv) {
    await execFileAsync("bash", [setupJiraCli], {
      cwd: projectDir,
      env: {
        HOME: homeDir,
        PATH: process.env.PATH ?? "",
        ...env,
      },
    });
  }

  /**
   * Assert that the generated jira-cli config contains each expected line.
   * @param expectedLines - Config lines that must appear in the generated file.
   */
  async function expectJiraConfig(expectedLines: readonly string[]) {
    const config = await fs.readFile(
      path.join(homeDir, ".config", ".jira", ".config.yml"),
      "utf8"
    );
    for (const line of expectedLines) {
      expect(config).toContain(line);
    }
  }
});
