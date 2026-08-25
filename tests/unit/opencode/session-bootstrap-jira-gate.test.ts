/**
 * Runtime contract tests for the tracker gate in OpenCode's session-bootstrap
 * plugin. The fixture copies the template exactly as installHooks does, then
 * invokes the plugin factory under Bun against a throwaway worktree.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const TEMPLATE_DIR = path.join(
  process.cwd(),
  "src",
  "opencode",
  "plugin-templates"
);
const BUN_PATH = boundedSpawnSync({
  label: "which bun",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();
const SITE = "example.atlassian.net";
const PROJECT_KEY = "LISA";
const LOGIN = "bot@example.com";
const LISA_CONFIG = ".lisa.config.json";

describe("OpenCode session-bootstrap jira-cli tracker gate", () => {
  let tempDir: string;
  let pluginPath: string;
  let worktree: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    pluginPath = path.join(tempDir, "lisa-session-bootstrap.ts");
    worktree = path.join(tempDir, "worktree");
    await fs.copy(
      path.join(TEMPLATE_DIR, "lisa-session-bootstrap.ts"),
      pluginPath
    );
    await fs.ensureDir(worktree);
    // Keep the install-pkgs arm inert: no package.json means nothing to install.
    await fs.ensureDir(path.join(worktree, "node_modules"));
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the bootstrap plugin factory under Bun against the fixture worktree.
   * @param env - Extra environment variables for the plugin process.
   * @returns The completed spawn result, including what the plugin wrote to stderr.
   */
  const bootstrap = (env: NodeJS.ProcessEnv) => {
    const program = `
      const imported = await import(${JSON.stringify("file://PLACEHOLDER")}.replace("PLACEHOLDER", process.env.PLUGIN_PATH));
      await imported.LisaSessionBootstrap({
        $: () => Promise.resolve(),
        worktree: process.env.TEST_WORKTREE,
      });
    `;
    // Build the environment from scratch rather than inheriting: an ambient
    // JIRA_SERVER/JIRA_PROJECT on the developer's machine would otherwise decide
    // the outcome. Empty strings are not equivalent to absent here — the
    // template resolves env vars with `??`, which only falls through on
    // undefined.
    const result = boundedSpawnSync({
      label: "bun invoking the session-bootstrap plugin",
      command: BUN_PATH,
      args: ["-e", program],
      baseMs: 30_000,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        PLUGIN_PATH: pluginPath,
        TEST_WORKTREE: worktree,
        ...env,
      },
    });
    expect(result.status).toBe(0);
    return result;
  };

  /**
   * Whether the plugin wrote a jira-cli config into the fixture worktree.
   * @returns True when `.lisa/jira-cli/.config.yml` exists.
   */
  const configExists = (): Promise<boolean> =>
    fs.pathExists(path.join(worktree, ".lisa", "jira-cli", ".config.yml"));

  it("skips the jira-cli config write when the tracker is not jira", async () => {
    await fs.writeJson(path.join(worktree, LISA_CONFIG), {
      atlassian: { site: SITE },
      jira: { project: PROJECT_KEY },
      tracker: "linear",
    });

    bootstrap({ JIRA_LOGIN: LOGIN });

    expect(await configExists()).toBe(false);
  });

  it("skips the jira-cli config write when no tracker is configured", async () => {
    await fs.writeJson(path.join(worktree, LISA_CONFIG), {
      atlassian: { site: SITE },
      jira: { project: PROJECT_KEY },
    });

    bootstrap({ JIRA_LOGIN: LOGIN });

    expect(await configExists()).toBe(false);
  });

  it("writes the jira-cli config when the tracker is jira", async () => {
    await fs.writeJson(path.join(worktree, LISA_CONFIG), {
      atlassian: { site: SITE },
      jira: { project: PROJECT_KEY },
      tracker: "jira",
    });

    bootstrap({ JIRA_LOGIN: LOGIN });

    expect(await configExists()).toBe(true);
  });

  it("says so on stderr when the Lisa config cannot be parsed", async () => {
    // This plugin cannot exit non-zero the way the two shell implementations
    // do — throwing out of the factory would take the session down — so the
    // compensating rung is that the failure is visible rather than reported
    // as an unconfigured project. See CodySwannGT/lisa#2768.
    await fs.writeFile(
      path.join(worktree, LISA_CONFIG),
      '{ "tracker": "jira",,, }'
    );

    const result = bootstrap({ JIRA_LOGIN: LOGIN });

    expect(result.stderr).toContain("is not valid JSON");
    expect(await configExists()).toBe(false);
  });

  it("reports an unreadable Lisa config separately from invalid JSON", async () => {
    await fs.ensureDir(path.join(worktree, LISA_CONFIG));

    const result = bootstrap({ JIRA_LOGIN: LOGIN });

    expect(result.stderr).toContain("could not be read");
    expect(result.stderr).not.toContain("is not valid JSON");
    expect(await configExists()).toBe(false);
  });
});
