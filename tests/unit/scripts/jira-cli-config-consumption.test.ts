import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { GIT_BIN } from "../../support/git-executable.js";

/**
 * Whether anything actually CONSUMES the jira-cli config Lisa writes.
 *
 * The `setup-jira-cli` SessionStart hook writes
 * `${PROJECT_DIR}/.lisa/jira-cli/.config.yml`. Nothing read it. Every consumer
 * looked at `${HOME}/.config/.jira/.config.yml` instead — `JIRA_CONFIG_FILE`
 * and `jira … --config` each appeared ZERO times in the tree — so on a headless
 * JIRA project the hook wrote a file no reader ever opened and `post-evidence.sh`
 * then told the operator to run `jira init`. The hook was a control that
 * reported success and enforced nothing. See CodySwannGT/lisa#2767.
 *
 * Two properties are asserted here, and they pull in opposite directions:
 *
 *   1. **The Lisa-written config is consumed.** A project-local config must be
 *      found, preferred over the developer's own, and resolved from the PROJECT
 *      ROOT — every executable case below runs from a SUBDIRECTORY of a real git
 *      repository, because running from the root cannot tell a project-root
 *      resolution apart from a cwd-relative one. That is the #2768 lesson
 *      applied to the read side.
 *   2. **The environment still wins, and silence is still forbidden.**
 *      `download-attachment.sh` reads a config file ONLY when JIRA_SERVER and
 *      JIRA_LOGIN are unset; a headless runner with both exported must never
 *      open one. That case is the negative control — it passed before this
 *      change and must keep passing. And a fall-through to the developer's own
 *      config is announced on stderr rather than taken silently, because a
 *      quiet fallback is how the Lisa-written config went unconsumed unnoticed.
 *
 * jira-cli's resolution order was MEASURED against v1.7.0 (darwin/arm64) rather
 * than read off its README, which does not state a default:
 * `--config` > `JIRA_CONFIG_FILE` > `${HOME}/.config/.jira/.config.yml`, and a
 * `--config` path that does not exist fails closed ("Missing configuration
 * file.", exit 1) instead of falling back to the default. That is what makes
 * passing `--config` an enforcement rather than a hint.
 * @module tests/unit/scripts/jira-cli-config-consumption
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const SAFE_COMMAND_PATH = "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin";
const NESTED_SUBDIR = path.join("src", "nested");
const JIRA_CONFIG_RELATIVE = path.join(".lisa", "jira-cli", ".config.yml");
const HOME_CONFIG_RELATIVE = path.join(".config", ".jira", ".config.yml");

const PROJECT_SERVER = "https://project-config.invalid";
const PROJECT_LOGIN = "project@example.com";
const HOME_SERVER = "https://home-config.invalid";
const HOME_LOGIN = "home@example.com";
const ENV_SERVER = "https://env-wins.invalid";
const ENV_LOGIN = "env@example.com";

const downloadAttachmentSource = path.join(
  repoRoot,
  "plugins/src/base/skills/lisa-jira-read-ticket/scripts/download-attachment.sh"
);
const postEvidenceSource = path.join(
  repoRoot,
  "plugins/src/base/skills/lisa-jira-evidence/scripts/post-evidence.sh"
);

describe("download-attachment.sh consumes the config Lisa writes", () => {
  let tempDir: string;
  let homeDir: string;
  let projectDir: string;
  let sessionDir: string;
  let curlLog: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    homeDir = path.join(tempDir, "home");
    projectDir = path.join(tempDir, "project");
    sessionDir = path.join(projectDir, NESTED_SUBDIR);
    curlLog = path.join(tempDir, "curl-args.txt");
    await fs.ensureDir(homeDir);
    await fs.ensureDir(sessionDir);
    await fs.ensureDir(path.join(projectDir, "out"));
    initGitRepo(projectDir, homeDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reads the project-root config when JIRA_SERVER and JIRA_LOGIN are unset", async () => {
    // The bite. Before this change the script looked only at
    // ${HOME}/.config/.jira/.config.yml, so the config the hook had just
    // written was ignored and the script exited 2 saying JIRA_SERVER was unset.
    await writeProjectConfig(PROJECT_SERVER, PROJECT_LOGIN);

    const result = await runDownloadAttachment({ JIRA_API_TOKEN: "tok" });

    expect(await requestedUrl()).toContain(PROJECT_SERVER);
    expect(result.stderr).not.toContain("JIRA_SERVER is not set");
  });

  it("prefers the project-root config over the developer's own", async () => {
    await writeProjectConfig(PROJECT_SERVER, PROJECT_LOGIN);
    await writeHomeConfig(HOME_SERVER, HOME_LOGIN);

    await runDownloadAttachment({ JIRA_API_TOKEN: "tok" });

    expect(await requestedUrl()).toContain(PROJECT_SERVER);
    expect(await requestedUrl()).not.toContain(HOME_SERVER);
  });

  it("resolves the project root from a subdirectory, not the working directory", async () => {
    // Every case here already runs from `src/nested`, so this asserts the
    // property the others depend on: a cwd-relative read would look in
    // `src/nested/.lisa/jira-cli/`, find nothing, and fall through. A config
    // planted at the WRONG level must not be picked up.
    await writeProjectConfig(PROJECT_SERVER, PROJECT_LOGIN);
    await fs.outputFile(
      path.join(sessionDir, JIRA_CONFIG_RELATIVE),
      `server: https://cwd-relative.invalid\nlogin: cwd@example.com\n`
    );

    await runDownloadAttachment({ JIRA_API_TOKEN: "tok" });

    expect(await requestedUrl()).toContain(PROJECT_SERVER);
    expect(await requestedUrl()).not.toContain("cwd-relative.invalid");
  });

  it("NEGATIVE CONTROL: never opens a config when the environment supplies both values", async () => {
    // The behaviour this change must not break. A headless environment exports
    // JIRA_SERVER and JIRA_LOGIN; the script must use them and leave every
    // config file shut. A project config naming a DIFFERENT server is planted
    // precisely so that reading it would be visible in the requested URL.
    await writeProjectConfig(PROJECT_SERVER, PROJECT_LOGIN);
    await writeHomeConfig(HOME_SERVER, HOME_LOGIN);

    const result = await runDownloadAttachment({
      JIRA_API_TOKEN: "tok",
      JIRA_LOGIN: ENV_LOGIN,
      JIRA_SERVER: ENV_SERVER,
    });

    expect(await requestedUrl()).toContain(ENV_SERVER);
    expect(await requestedUrl()).not.toContain(PROJECT_SERVER);
    expect(await requestedUrl()).not.toContain(HOME_SERVER);
    expect(result.stderr).not.toContain("falling back");
    expect(result.stderr).not.toContain("no Lisa-written jira-cli config");
  });

  it("announces the fallback to the developer's own config instead of taking it silently", async () => {
    await writeHomeConfig(HOME_SERVER, HOME_LOGIN);

    const result = await runDownloadAttachment({ JIRA_API_TOKEN: "tok" });

    expect(result.stderr).toContain("no Lisa-written jira-cli config at");
    expect(result.stderr).toContain(
      path.join(projectDir, JIRA_CONFIG_RELATIVE)
    );
    expect(await requestedUrl()).toContain(HOME_SERVER);
  });

  it("says which paths it looked at when no config exists anywhere", async () => {
    const result = await runDownloadAttachment({ JIRA_API_TOKEN: "tok" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no jira-cli config at");
    expect(result.stderr).toContain(
      path.join(projectDir, JIRA_CONFIG_RELATIVE)
    );
    expect(result.stderr).toContain("JIRA_SERVER is not set");
  });

  it("never creates or modifies the developer's own jira-cli config", async () => {
    await writeProjectConfig(PROJECT_SERVER, PROJECT_LOGIN);

    await runDownloadAttachment({ JIRA_API_TOKEN: "tok" });

    expect(await fs.pathExists(path.join(homeDir, ".config", ".jira"))).toBe(
      false
    );
  });

  /**
   * Write the config the setup-jira-cli hook would have written.
   * @param server - The `server:` value to record.
   * @param login - The `login:` value to record.
   */
  async function writeProjectConfig(
    server: string,
    login: string
  ): Promise<void> {
    await fs.outputFile(
      path.join(projectDir, JIRA_CONFIG_RELATIVE),
      `installation: cloud\nserver: ${server}\nlogin: ${login}\n`
    );
  }

  /**
   * Write a developer's own `jira init` config into the fake HOME.
   * @param server - The `server:` value to record.
   * @param login - The `login:` value to record.
   */
  async function writeHomeConfig(server: string, login: string): Promise<void> {
    await fs.outputFile(
      path.join(homeDir, HOME_CONFIG_RELATIVE),
      `installation: cloud\nserver: ${server}\nlogin: ${login}\n`
    );
  }

  /**
   * The URL the script asked `curl` for, as recorded by the curl stub.
   * @returns The stub's recorded argument line, or the empty string.
   */
  async function requestedUrl(): Promise<string> {
    if (!(await fs.pathExists(curlLog))) return "";
    return fs.readFile(curlLog, "utf8");
  }

  /**
   * Run download-attachment.sh from the nested session directory.
   *
   * `curl` is stubbed so the case is fully offline and deterministic: the stub
   * records the arguments it was handed and reports HTTP 000, which the script
   * treats as an unexpected status. The URL it was about to fetch embeds
   * JIRA_SERVER, which is what makes the source of that value observable
   * without any network.
   * @param env - Environment variables to expose to the script.
   * @returns The completed spawn result.
   */
  async function runDownloadAttachment(
    env: NodeJS.ProcessEnv
  ): Promise<{ status: number | null; stderr: string; stdout: string }> {
    const stubDir = await makeCurlStub();
    const result = boundedSpawnSync({
      args: [downloadAttachmentSource, "12345", path.join(projectDir, "out/f")],
      command: "/bin/bash",
      cwd: sessionDir,
      env: { HOME: homeDir, PATH: `${stubDir}:${SAFE_COMMAND_PATH}`, ...env },
      label: "download-attachment.sh under test",
    });
    return {
      status: result.status,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    };
  }

  /**
   * Build a PATH entry holding a `curl` that records its arguments offline.
   * @returns The directory to prepend to PATH.
   */
  async function makeCurlStub(): Promise<string> {
    const stubDir = path.join(tempDir, "stub-bin");
    const stub = path.join(stubDir, "curl");
    await fs.outputFile(
      stub,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(curlLog)}\nprintf '000'\nexit 0\n`
    );
    await fs.chmod(stub, 0o755);
    return stubDir;
  }
});

describe("post-evidence.sh consumes the config Lisa writes", () => {
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
    await fs.ensureDir(path.join(projectDir, "evidence"));
    initGitRepo(projectDir, homeDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("no longer sends the operator to run 'jira init' when Lisa wrote a config", async () => {
    // The bite, and the ticket's third acceptance scenario. Before this change
    // the script hard-failed at line 26 with "jira-cli config not found at
    // ${HOME}/.config/.jira/.config.yml — run 'jira init' first", no matter what
    // the hook had written into the project.
    await fs.outputFile(
      path.join(projectDir, JIRA_CONFIG_RELATIVE),
      `installation: cloud\nserver: ${PROJECT_SERVER}\nlogin: ${PROJECT_LOGIN}\n`
    );

    // Both an image and a text artifact: macOS ships bash 3.2, where expanding
    // an EMPTY array under `set -u` is itself an unbound-variable error, so a
    // half-populated evidence directory stops the script for a reason that has
    // nothing to do with the config gate under test.
    await fs.outputFile(path.join(projectDir, "evidence", "01-shot.png"), "x");
    await fs.outputFile(path.join(projectDir, "evidence", "02-notes.txt"), "y");

    const result = await runPostEvidence();

    expect(result.stderr).not.toContain("jira-cli config not found");
    expect(result.stderr).not.toContain("run 'jira init' first");
    // Proof it got PAST the config gate rather than failing differently. This
    // line is printed ~35 lines after the gate, once the evidence sweep has
    // run, so it cannot be reached by a script that stopped at line 26.
    expect(result.stdout).toContain("Found 1 screenshots");
  });

  it("names both candidate paths when no config exists anywhere", async () => {
    const result = await runPostEvidence();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      path.join(projectDir, JIRA_CONFIG_RELATIVE)
    );
    expect(result.stderr).toContain(path.join(homeDir, HOME_CONFIG_RELATIVE));
  });

  it("announces the fallback to the developer's own config", async () => {
    await fs.outputFile(
      path.join(homeDir, HOME_CONFIG_RELATIVE),
      `installation: cloud\nserver: ${HOME_SERVER}\nlogin: ${HOME_LOGIN}\n`
    );

    const result = await runPostEvidence();

    expect(result.stderr).toContain("no Lisa-written jira-cli config at");
    expect(result.stderr).toContain(
      path.join(projectDir, JIRA_CONFIG_RELATIVE)
    );
  });

  /**
   * Run post-evidence.sh from the nested session directory with `gh` stubbed.
   * @returns The completed spawn result.
   */
  async function runPostEvidence(): Promise<{
    status: number | null;
    stderr: string;
  }> {
    const stubDir = await makeGhStub();
    const result = boundedSpawnSync({
      args: [
        postEvidenceSource,
        "ABC-1",
        path.join(projectDir, "evidence"),
        "42",
      ],
      command: "/bin/bash",
      cwd: sessionDir,
      env: {
        HOME: homeDir,
        JIRA_API_TOKEN: "tok",
        PATH: `${stubDir}:${SAFE_COMMAND_PATH}`,
      },
      label: "post-evidence.sh under test",
    });
    return {
      status: result.status,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    };
  }

  /**
   * Build a PATH entry holding a `gh` that answers `repo view` offline.
   * @returns The directory to prepend to PATH.
   */
  async function makeGhStub(): Promise<string> {
    const stubDir = path.join(tempDir, "stub-bin");
    const stub = path.join(stubDir, "gh");
    await fs.outputFile(stub, `#!/bin/sh\nprintf 'owner/repo'\nexit 0\n`);
    await fs.chmod(stub, 0o755);
    return stubDir;
  }
});

describe("the fix reaches every shipped copy, not just the source", () => {
  it("passes --config to the one real jira-cli invocation in every post-evidence.sh", () => {
    const copies = findShippedScripts("post-evidence.sh");

    expect(copies.length).toBeGreaterThanOrEqual(18);
    for (const copy of copies) {
      const text = fs.readFileSync(path.join(repoRoot, copy), "utf8");
      expect(text, copy).toContain(
        'jira --config "$JIRA_CONFIG" issue move "$TICKET_ID" "$REVIEW"'
      );
      expect(text, copy).toContain(
        'PROJECT_JIRA_CONFIG="${PROJECT_DIR}/.lisa/jira-cli/.config.yml"'
      );
      // The old message is what the ticket's third acceptance scenario names.
      expect(text, copy).not.toContain("run 'jira init' first");
    }
  });

  it("resolves the project-local config in every download-attachment.sh", () => {
    const copies = findShippedScripts("download-attachment.sh");

    expect(copies.length).toBeGreaterThanOrEqual(6);
    for (const copy of copies) {
      const text = fs.readFileSync(path.join(repoRoot, copy), "utf8");
      expect(text, copy).toContain(
        'PROJECT_JIRA_CONFIG="${PROJECT_DIR}/.lisa/jira-cli/.config.yml"'
      );
      // The env-first arm is the negative control, asserted as source text too
      // so a future edit cannot quietly make the config unconditional.
      expect(text, copy).toContain(
        'if [[ -z "${JIRA_SERVER:-}" || -z "${JIRA_LOGIN:-}" ]]; then'
      );
    }
  });

  it("teaches the freehand jira commands in SKILL prose to pass --config", () => {
    const copies = findShippedFiles(
      name => name === "SKILL.md",
      text => text.includes("issue view <TICKET_ID>")
    );

    // Every add-journey doc across base/expo/rails and every agent variant.
    expect(copies.length).toBeGreaterThanOrEqual(3);
    for (const copy of copies) {
      const text = fs.readFileSync(path.join(repoRoot, copy), "utf8");
      expect(text, copy).toContain(
        "jira --config .lisa/jira-cli/.config.yml issue view <TICKET_ID>"
      );
    }
  });

  it("records that no per-harness environment export is used, in every hook implementation", () => {
    // #2767 gated all code on "can a SessionStart hook export an env var into
    // the agent's later tool invocations, per harness?". The answer recorded
    // here is that no consumer needs one — two parse the YAML in Lisa-owned
    // shell and the third passes an argument — so the capability question is
    // moot rather than unanswered. JIRA_CONFIG_FILE stays unexported: an
    // unexported variable is another inert control.
    const writers = [
      "plugins/src/base/hooks/setup-jira-cli.sh",
      "src/codex/scripts/setup-jira-cli.sh",
      "src/opencode/plugin-templates/lisa-session-bootstrap.ts",
    ];

    for (const writer of writers) {
      const text = fs.readFileSync(path.join(repoRoot, writer), "utf8");
      expect(text, writer).toContain("post-evidence.sh");
      expect(text, writer).toContain("download-attachment.sh");
      expect(text, writer).toContain("--config");
    }
  });

  it("exports JIRA_CONFIG_FILE nowhere, because an unexported variable is an inert control", () => {
    const offenders = findShippedFiles(
      () => true,
      text => /export\s+JIRA_CONFIG_FILE/.test(text)
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * Initialise a git repository so `git rev-parse --show-toplevel` has an answer
 * that disagrees with a subdirectory `pwd`.
 * @param dir - Directory to turn into a repository.
 * @param homeDir - HOME for the git processes, so no user config leaks in.
 */
function initGitRepo(dir: string, homeDir: string): void {
  for (const args of [
    ["init", "--quiet", dir],
    ["-C", dir, "config", "user.email", "test@example.com"],
    ["-C", dir, "config", "user.name", "Test"],
  ]) {
    boundedSpawnSync({
      args,
      command: GIT_BIN,
      env: { HOME: homeDir, PATH: SAFE_COMMAND_PATH },
      label: "git repository setup",
    });
  }
}

/**
 * Every tracked copy of a shipped script, source of truth and fan-out alike.
 * Derived by walking the tree rather than hardcoded, so a new agent variant
 * cannot slip past this suite by simply not being on a list.
 * @param basename - The filename to collect.
 * @returns Repository-relative paths.
 */
function findShippedScripts(basename: string): readonly string[] {
  return findShippedFiles(
    name => name === basename,
    () => true
  );
}

/**
 * Walk `plugins/` and `src/` collecting files matching both predicates.
 * @param matchesName - Predicate over the file's basename.
 * @param matchesText - Predicate over the file's contents.
 * @returns Repository-relative paths, sorted.
 */
function findShippedFiles(
  matchesName: (name: string) => boolean,
  matchesText: (text: string) => boolean
): readonly string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    const absolute = path.join(repoRoot, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(child);
      } else if (
        entry.isFile() &&
        matchesName(entry.name) &&
        matchesText(fs.readFileSync(path.join(repoRoot, child), "utf8"))
      ) {
        found.push(child);
      }
    }
  };
  walk("plugins");
  walk("src");
  return [...found].sort((left, right) => left.localeCompare(right));
}
