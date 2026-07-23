/* eslint-disable max-lines -- lifecycle scenarios share one executable fixture */
/**
 * Regression tests for Lisa's postinstall script when it runs inside the Lisa
 * monorepo itself.
 *
 * @module tests/unit/scripts/install-claude-plugins-self
 */
import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const APPLY_DOWNSTREAM_LOG = "apply downstream";
const APPLY_BOOTSTRAP_LOG = "bootstrap=";
const CODEX_SELF_OVERLAY_LOG = "codex self overlay";
const CODYSWANN_SCOPE = "@codyswann";
const INSTALL_SCRIPT_NAME = "install-claude-plugins.sh";
const LISA_PACKAGE_DIR_NAME = "lisa";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", INSTALL_SCRIPT_NAME);
const COMMAND_LOG = "commands.log";
const CODEX_PLUGIN_ADD = "codex plugin add";
const CODEX_REMOVE_LISA = "codex plugin remove lisa@lisa";
const CODEX_MARKETPLACE_ADD = "codex plugin marketplace add";
const PACKAGE_JSON_FILE = "package.json";
const LISA_PACKAGE_NAME = "@codyswann/lisa";
const CLAUDE_INSTALL_BASE = "claude plugin install lisa@lisa --scope project";
const CLAUDE_DIR = ".claude";
const PLUGIN_SYNC_MARKER_FILE = ".lisa-plugins-synced";
const FAKE_LISA_VERSION = "9.9.9";

let tempRoots: string[] = [];

/**
 * Create a temporary directory and track it for cleanup.
 * @returns Absolute path to the temp directory.
 */
async function makeTempRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "lisa-self-postinstall-"))
  );
  tempRoots.push(root);
  return root;
}

/**
 * Write an executable shell script.
 * @param filePath - Absolute path to write.
 * @param body - Script body.
 */
async function writeExecutable(filePath: string, body: string): Promise<void> {
  await writeFile(filePath, body, "utf8");
  await chmod(filePath, 0o755);
}

/**
 * Build a minimal Lisa source checkout fixture.
 * @param root - Fixture root.
 */
async function writeSelfProject(root: string): Promise<void> {
  await writeFile(
    path.join(root, PACKAGE_JSON_FILE),
    `${JSON.stringify({ name: LISA_PACKAGE_NAME }, null, 2)}\n`,
    "utf8"
  );
  await mkdir(path.join(root, "dist", "codex"), { recursive: true });
  await writeFile(
    path.join(root, "dist", "codex", "project-overlay.js"),
    `require("node:fs").appendFileSync(process.env.LISA_TEST_COMMAND_LOG, "${CODEX_SELF_OVERLAY_LOG}\\n");\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, ".lisa.config.json"),
    `${JSON.stringify({ harness: "fleet" }, null, 2)}\n`,
    "utf8"
  );
  await mkdir(path.join(root, CLAUDE_DIR), { recursive: true });
  await writeFile(
    path.join(root, CLAUDE_DIR, "settings.json"),
    `${JSON.stringify(
      { enabledPlugins: { "lisa@lisa": true, "lisa-typescript@lisa": true } },
      null,
      2
    )}\n`,
    "utf8"
  );

  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(
    path.join(root, "dist", "index.js"),
    `require("node:fs").appendFileSync(process.env.LISA_TEST_COMMAND_LOG, "apply self\\n");\n`,
    "utf8"
  );
}

/**
 * Build a minimal downstream fixture with a fake installed Lisa package.
 * @param root - Fixture root.
 */
async function writeDownstreamProject(root: string): Promise<void> {
  await writeFile(
    path.join(root, PACKAGE_JSON_FILE),
    `${JSON.stringify({ name: "consumer-project" }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, ".lisa.config.json"),
    `${JSON.stringify({ harness: "fleet" }, null, 2)}\n`,
    "utf8"
  );

  const lisaDist = path.join(
    root,
    "node_modules",
    CODYSWANN_SCOPE,
    LISA_PACKAGE_DIR_NAME,
    "dist"
  );
  await mkdir(lisaDist, { recursive: true });
  await writeFile(
    path.join(lisaDist, "index.js"),
    `require("node:fs").appendFileSync(process.env.LISA_TEST_COMMAND_LOG, "${APPLY_DOWNSTREAM_LOG}\\n${APPLY_BOOTSTRAP_LOG}" + process.env.LISA_BOOTSTRAP + "\\n");\n`,
    "utf8"
  );
}

/**
 * Copy the postinstall script into a fixture as though Lisa were installed from npm.
 * @param root - Downstream fixture root.
 * @returns Absolute path to the copied lifecycle script.
 */
async function writeInstalledLisaScript(root: string): Promise<string> {
  return copyLisaScriptTo(
    root,
    "node_modules",
    CODYSWANN_SCOPE,
    LISA_PACKAGE_DIR_NAME,
    "scripts"
  );
}

/**
 * Copy the postinstall script into a pnpm virtual-store fixture path.
 * @param root - Downstream fixture root.
 * @returns Absolute path to the copied lifecycle script.
 */
async function writePnpmVirtualLisaScript(root: string): Promise<string> {
  return copyLisaScriptTo(
    root,
    "node_modules",
    ".pnpm",
    "@codyswann+lisa@2.0.0",
    "node_modules",
    CODYSWANN_SCOPE,
    LISA_PACKAGE_DIR_NAME,
    "scripts"
  );
}

/**
 * Copy the postinstall script into a fixture as though it were Lisa's source checkout.
 * @param root - Self fixture root.
 * @returns Absolute path to the copied lifecycle script.
 */
async function writeSelfLisaScript(root: string): Promise<string> {
  return copyLisaScriptTo(root, "scripts");
}

/**
 * Copy the postinstall script into the requested fixture subdirectory.
 * @param root - Fixture root.
 * @param segments - Directory segments below the fixture root.
 * @returns Absolute path to the copied lifecycle script.
 */
async function copyLisaScriptTo(
  root: string,
  ...segments: string[]
): Promise<string> {
  const scriptPath = path.join(root, ...segments, INSTALL_SCRIPT_NAME);
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await cp(SCRIPT_PATH, scriptPath);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

/**
 * Create fake agent CLIs that log invocations and otherwise succeed.
 * @param binDir - Directory to place fake executables in.
 * @param hasLisaMarketplace - Whether Codex reports the legacy marketplace
 */
async function writeFakeAgentBins(
  binDir: string,
  hasLisaMarketplace = true
): Promise<void> {
  const codexMarketplaces = hasLisaMarketplace
    ? '{"marketplaces":[{"name":"lisa"}]}'
    : '{"marketplaces":[]}';
  await mkdir(binDir, { recursive: true });
  await writeExecutable(
    path.join(binDir, "codex"),
    `#!/usr/bin/env bash
printf 'codex %s\\n' "$*" >> "$LISA_TEST_COMMAND_LOG"
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "list" ]; then
  printf '${codexMarketplaces}\\n'
fi
exit 0
`
  );
  await writeExecutable(
    path.join(binDir, "claude"),
    `#!/usr/bin/env bash
printf 'claude %s\\n' "$*" >> "$LISA_TEST_COMMAND_LOG"
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "list" ]; then
  printf '[]\\n'
fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
  printf '%s\\n' "\${LISA_TEST_INSTALLED_PLUGINS:-[]}"
fi
exit 0
`
  );
}

/**
 * Environment for spawning git in test fixtures: hook-set GIT_DIR /
 * GIT_WORK_TREE / GIT_INDEX_FILE poison git commands aimed at a different
 * repository, so strip every GIT_* key.
 * @returns process.env minus GIT_* keys.
 */
function gitCleanEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
}

/**
 * Create a real primary git checkout with a linked worktree.
 * @param root - Fixture root.
 * @param primaryMarkerVersion - Version recorded in the primary checkout's
 *   plugin sync marker.
 * @returns Absolute primary and worktree roots.
 */
async function writeLinkedWorktreeFixture(
  root: string,
  primaryMarkerVersion: string
): Promise<{ primaryRoot: string; worktreeRoot: string }> {
  const primaryRoot = path.join(root, "primary");
  const worktreeRoot = path.join(root, "wt");
  await mkdir(primaryRoot, { recursive: true });
  const env = { ...gitCleanEnv(), HOME: root };
  const git = async (...args: string[]): Promise<void> => {
    await execFileAsync(
      "git",
      ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
      { cwd: primaryRoot, env }
    );
  };
  await git("init", "--template=", "-q");
  await git("commit", "--allow-empty", "-m", "init", "-q", "--no-verify");
  await git("worktree", "add", worktreeRoot, "-q");
  await mkdir(path.join(primaryRoot, CLAUDE_DIR), { recursive: true });
  await writeFile(
    path.join(primaryRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
    primaryMarkerVersion,
    "utf8"
  );
  return { primaryRoot, worktreeRoot };
}

/**
 * Stamp the fake installed Lisa package with the fixture version.
 * @param root - Downstream fixture root.
 */
async function writeVersionedLisaPackageJson(root: string): Promise<void> {
  await writeFile(
    path.join(
      root,
      "node_modules",
      CODYSWANN_SCOPE,
      LISA_PACKAGE_DIR_NAME,
      PACKAGE_JSON_FILE
    ),
    `${JSON.stringify(
      { name: LISA_PACKAGE_NAME, version: FAKE_LISA_VERSION },
      null,
      2
    )}\n`,
    "utf8"
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots.map(root => rm(root, { recursive: true, force: true }))
  );
  tempRoots = [];
});

describe("install-claude-plugins self postinstall path", () => {
  it("removes user-wide Codex plugin surfaces without running full apply", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeSelfProject(projectRoot);
    const selfScriptPath = await writeSelfLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);

    await execFileAsync("bash", [selfScriptPath], {
      env: {
        ...process.env,
        // Sandbox HOME: the script writes the one-time Codex retire marker to
        // $HOME/.codex, which must never leak onto the developer's machine.
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(log).toContain(CODEX_REMOVE_LISA);
    expect(log).toContain("codex plugin remove lisa-harper-fabric@lisa");
    expect(log).toContain("codex plugin marketplace remove lisa");
    expect(log).not.toContain(CODEX_PLUGIN_ADD);
    expect(log).not.toContain(CODEX_MARKETPLACE_ADD);
    expect(log).toContain(CLAUDE_INSTALL_BASE);
    expect(log).toContain(CODEX_SELF_OVERLAY_LOG);
    expect(log).not.toContain("apply self");
  });

  it("runs downstream apply before Codex user-wide cleanup", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeDownstreamProject(projectRoot);
    const installedScriptPath = await writeInstalledLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);

    await execFileAsync("bash", [installedScriptPath], {
      env: {
        ...process.env,
        // Sandbox HOME: the script writes the one-time Codex retire marker to
        // $HOME/.codex, which must never leak onto the developer's machine.
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    const applyIndex = log.indexOf(APPLY_DOWNSTREAM_LOG);
    const codexIndex = log.indexOf(CODEX_REMOVE_LISA);
    expect(applyIndex).toBeGreaterThanOrEqual(0);
    expect(codexIndex).toBeGreaterThan(applyIndex);
    expect(log).toContain(`${APPLY_BOOTSTRAP_LOG}1`);
  });

  it("does not repeat cleanup after the Lisa marketplace is gone", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeSelfProject(projectRoot);
    const selfScriptPath = await writeSelfLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin, false);

    await execFileAsync("bash", [selfScriptPath], {
      env: {
        ...process.env,
        // Sandbox HOME: the script writes the one-time Codex retire marker to
        // $HOME/.codex, which must never leak onto the developer's machine.
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(log).toContain("codex plugin marketplace list --json");
    expect(log).not.toContain(CODEX_REMOVE_LISA);
    expect(log).not.toContain("codex plugin marketplace remove lisa");
  });

  it("ignores leaked package-manager project roots from sibling installs", async () => {
    const projectRoot = await makeTempRoot();
    const leakedRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeDownstreamProject(projectRoot);
    await writeDownstreamProject(leakedRoot);
    const installedScriptPath = await writeInstalledLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);

    await execFileAsync("bash", [installedScriptPath], {
      env: {
        ...process.env,
        // Sandbox HOME: the script writes the one-time Codex retire marker to
        // $HOME/.codex, which must never leak onto the developer's machine.
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        INIT_CWD: leakedRoot,
        npm_config_local_prefix: leakedRoot,
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(log).toContain(APPLY_DOWNSTREAM_LOG);
    expect(log).toContain(CODEX_REMOVE_LISA);
    expect(log).not.toContain(`${CODEX_MARKETPLACE_ADD} ${leakedRoot}`);
    expect(log).not.toContain(CODEX_PLUGIN_ADD);
  });

  it("resolves pnpm virtual-store script paths back to the project root", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeDownstreamProject(projectRoot);
    const pnpmScriptPath = await writePnpmVirtualLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);

    await execFileAsync("bash", [pnpmScriptPath], {
      env: {
        ...process.env,
        // Sandbox HOME: the script writes the one-time Codex retire marker to
        // $HOME/.codex, which must never leak onto the developer's machine.
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(log).toContain(APPLY_DOWNSTREAM_LOG);
    expect(log).toContain(CODEX_REMOVE_LISA);
    expect(log).not.toContain(CODEX_PLUGIN_ADD);
    expect(log).not.toContain(`${projectRoot}/node_modules/.pnpm`);
  });

  it("defers user-wide cleanup while a Codex thread is active", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeSelfProject(projectRoot);
    const selfScriptPath = await writeSelfLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);

    const result = await execFileAsync("bash", [selfScriptPath], {
      env: {
        ...process.env,
        // Sandbox HOME: the script writes the one-time Codex retire marker to
        // $HOME/.codex, which must never leak onto the developer's machine.
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "active-thread",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(result.stderr).toContain("cleanup deferred");
    expect(log).not.toContain(CODEX_REMOVE_LISA);
  });

  it("skips the package-side apply when the host postinstall already invokes Lisa", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeDownstreamProject(projectRoot);
    await writeFile(
      path.join(projectRoot, PACKAGE_JSON_FILE),
      `${JSON.stringify(
        {
          name: "consumer-project",
          scripts: {
            postinstall:
              '[ -n "$CI" ] || LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true',
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const installedScriptPath = await writeInstalledLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);

    const result = await execFileAsync("bash", [installedScriptPath], {
      env: {
        ...process.env,
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(result.stdout).toContain("deferred to the host");
    expect(log).not.toContain(APPLY_DOWNSTREAM_LOG);
    // The rest of the lifecycle (plugin section) still runs.
    expect(log).toContain(CLAUDE_INSTALL_BASE);
  });

  it("skips plugin installs when the same Lisa version is already synced", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeDownstreamProject(projectRoot);
    const installedScriptPath = await writeInstalledLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);
    await writeFile(
      path.join(
        projectRoot,
        "node_modules",
        CODYSWANN_SCOPE,
        LISA_PACKAGE_DIR_NAME,
        PACKAGE_JSON_FILE
      ),
      `${JSON.stringify({ name: LISA_PACKAGE_NAME, version: FAKE_LISA_VERSION }, null, 2)}\n`,
      "utf8"
    );
    await mkdir(path.join(projectRoot, CLAUDE_DIR), { recursive: true });
    await writeFile(
      path.join(projectRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
      FAKE_LISA_VERSION,
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, CLAUDE_DIR, ".lisa-marketplace-heal-v2"),
      "",
      "utf8"
    );
    const installedPlugins = [
      "lisa@lisa",
      "lisa-typescript@lisa",
      "typescript-lsp@claude-plugins-official",
      "code-simplifier@claude-plugins-official",
      "code-review@claude-plugins-official",
      "coderabbit@claude-plugins-official",
      "sentry@claude-plugins-official",
      "skill-creator@claude-plugins-official",
      "atlassian@claude-plugins-official",
      "safety-net@cc-marketplace",
    ].map(id => ({ id, projectPath: projectRoot }));

    await execFileAsync("bash", [installedScriptPath], {
      env: {
        ...process.env,
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        LISA_TEST_INSTALLED_PLUGINS: JSON.stringify(installedPlugins),
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(log).toContain("claude plugin list --json");
    expect(log).not.toContain("claude plugin install");
    expect(log).not.toContain("claude plugin marketplace update");
    expect(log).not.toContain("claude plugin marketplace list");
    // Retirement of curated plugins is version-gated: a same-version run must
    // not spawn the CLI to re-uninstall an already-retired plugin.
    expect(log).not.toContain("claude plugin uninstall sentry");
    expect(log).not.toContain("claude plugin uninstall safety-net");
  });

  it("performs a full plugin sync and records the marker when the Lisa version changes", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeDownstreamProject(projectRoot);
    const installedScriptPath = await writeInstalledLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);
    await writeFile(
      path.join(
        projectRoot,
        "node_modules",
        CODYSWANN_SCOPE,
        LISA_PACKAGE_DIR_NAME,
        PACKAGE_JSON_FILE
      ),
      `${JSON.stringify({ name: LISA_PACKAGE_NAME, version: FAKE_LISA_VERSION }, null, 2)}\n`,
      "utf8"
    );
    await mkdir(path.join(projectRoot, CLAUDE_DIR), { recursive: true });
    await writeFile(
      path.join(projectRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
      "1.0.0",
      "utf8"
    );
    const installedPlugins = [{ id: "lisa@lisa", projectPath: projectRoot }];

    await execFileAsync("bash", [installedScriptPath], {
      env: {
        ...process.env,
        HOME: projectRoot,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        LISA_TEST_INSTALLED_PLUGINS: JSON.stringify(installedPlugins),
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    // Version changed: even already-installed plugins are reinstalled so the
    // refreshed marketplace content is picked up.
    expect(log).toContain(CLAUDE_INSTALL_BASE);
    expect(log).toContain("claude plugin marketplace update lisa");
    // The base lisa plugin bundles the Sentry MCP server, so the upstream
    // sentry plugin is retired on sync instead of installed (issue #1955).
    expect(log).not.toContain(
      "claude plugin install sentry@claude-plugins-official"
    );
    expect(log).toContain(
      "claude plugin uninstall sentry@claude-plugins-official --scope project"
    );
    // The Lisa-native parity-safety-net.sh hook absorbed the upstream
    // safety-net plugin's material guards, so the upstream plugin is retired
    // on sync instead of installed (issue #1960).
    expect(log).not.toContain(
      "claude plugin install safety-net@cc-marketplace"
    );
    expect(log).toContain(
      "claude plugin uninstall safety-net@cc-marketplace --scope project"
    );
    const marker = await readFile(
      path.join(projectRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
      "utf8"
    );
    expect(marker).toBe(FAKE_LISA_VERSION);
  });

  it("inherits the primary checkout's sync marker in a linked worktree and skips all Claude plugin work", async () => {
    const root = await makeTempRoot();
    const { primaryRoot, worktreeRoot } = await writeLinkedWorktreeFixture(
      root,
      FAKE_LISA_VERSION
    );
    const fakeBin = path.join(root, "bin");
    const commandLog = path.join(root, COMMAND_LOG);
    await writeDownstreamProject(worktreeRoot);
    const installedScriptPath = await writeInstalledLisaScript(worktreeRoot);
    await writeVersionedLisaPackageJson(worktreeRoot);
    await writeFakeAgentBins(fakeBin);

    const result = await execFileAsync("bash", [installedScriptPath], {
      env: {
        ...gitCleanEnv(),
        HOME: root,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8").catch(() => "");
    expect(result.stdout).toContain(
      "deferring worktree plugin registration to the coding agent's startup"
    );
    expect(log).not.toContain("claude plugin");
    // The worktree records its own marker so repeat installs (and health's
    // root-confined marker probe) see the settled state.
    const worktreeMarker = await readFile(
      path.join(worktreeRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
      "utf8"
    );
    expect(worktreeMarker.trim()).toBe(FAKE_LISA_VERSION);
    // The primary marker is untouched.
    const primaryMarker = await readFile(
      path.join(primaryRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
      "utf8"
    );
    expect(primaryMarker.trim()).toBe(FAKE_LISA_VERSION);
  });

  it("runs a full sync from a linked worktree with a stale primary marker without recording the primary's marker", async () => {
    const root = await makeTempRoot();
    const { primaryRoot, worktreeRoot } = await writeLinkedWorktreeFixture(
      root,
      "1.0.0"
    );
    const fakeBin = path.join(root, "bin");
    const commandLog = path.join(root, COMMAND_LOG);
    await writeDownstreamProject(worktreeRoot);
    const installedScriptPath = await writeInstalledLisaScript(worktreeRoot);
    await writeVersionedLisaPackageJson(worktreeRoot);
    await writeFakeAgentBins(fakeBin);

    await execFileAsync("bash", [installedScriptPath], {
      env: {
        ...gitCleanEnv(),
        HOME: root,
        CI: "",
        CODEX_THREAD_ID: "",
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    // Version changed: the worktree still performs its own full sync.
    expect(log).toContain(CLAUDE_INSTALL_BASE);
    expect(log).toContain("claude plugin marketplace update lisa");
    // The worktree records its own marker...
    const worktreeMarker = await readFile(
      path.join(worktreeRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
      "utf8"
    );
    expect(worktreeMarker.trim()).toBe(FAKE_LISA_VERSION);
    // ...but never the primary's: this run only reinstalled plugins for the
    // worktree's projectPath, so the primary still needs its own forced
    // reinstall after the version bump.
    const primaryMarker = await readFile(
      path.join(primaryRoot, CLAUDE_DIR, PLUGIN_SYNC_MARKER_FILE),
      "utf8"
    );
    expect(primaryMarker.trim()).toBe("1.0.0");
  });

  it("does not probe codex again once the retire marker exists", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeSelfProject(projectRoot);
    const selfScriptPath = await writeSelfLisaScript(projectRoot);
    await writeFakeAgentBins(fakeBin);
    const env = {
      ...process.env,
      HOME: projectRoot,
      CI: "",
      CODEX_THREAD_ID: "",
      LISA_TEST_COMMAND_LOG: commandLog,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    };

    await execFileAsync("bash", [selfScriptPath], { env });
    const firstLog = await readFile(commandLog, "utf8");
    expect(firstLog).toContain(CODEX_REMOVE_LISA);

    await rm(commandLog);
    await execFileAsync("bash", [selfScriptPath], { env });
    const secondLog = await readFile(commandLog, "utf8");
    expect(secondLog).not.toContain("codex plugin marketplace list");
    expect(secondLog).not.toContain(CODEX_REMOVE_LISA);
  });
});
/* eslint-enable max-lines -- restore the repository default */
