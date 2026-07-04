/**
 * Regression tests for Lisa's postinstall script when it runs inside the Lisa
 * monorepo itself.
 *
 * @module tests/unit/scripts/install-claude-plugins-self
 */
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "install-claude-plugins.sh"
);
const COMMAND_LOG = "commands.log";

let tempRoots: string[] = [];

/**
 * Create a temporary directory and track it for cleanup.
 * @returns Absolute path to the temp directory.
 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-self-postinstall-"));
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
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "@codyswann/lisa" }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, ".lisa.config.json"),
    `${JSON.stringify({ harness: "fleet" }, null, 2)}\n`,
    "utf8"
  );
  await mkdir(path.join(root, ".claude"), { recursive: true });
  await writeFile(
    path.join(root, ".claude", "settings.json"),
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
    path.join(root, "package.json"),
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
    "@codyswann",
    "lisa",
    "dist"
  );
  await mkdir(lisaDist, { recursive: true });
  await writeFile(
    path.join(lisaDist, "index.js"),
    `require("node:fs").appendFileSync(process.env.LISA_TEST_COMMAND_LOG, "apply downstream\\n");\n`,
    "utf8"
  );
}

/**
 * Create fake agent CLIs that log invocations and otherwise succeed.
 * @param binDir - Directory to place fake executables in.
 */
async function writeFakeAgentBins(binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  await writeExecutable(
    path.join(binDir, "codex"),
    `#!/usr/bin/env bash
printf 'codex %s\\n' "$*" >> "$LISA_TEST_COMMAND_LOG"
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
  printf '[]\\n'
fi
exit 0
`
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots.map(root => rm(root, { recursive: true, force: true }))
  );
  tempRoots = [];
});

describe("install-claude-plugins self postinstall path", () => {
  it("installs plugin surfaces for Lisa itself without running full apply", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeSelfProject(projectRoot);
    await writeFakeAgentBins(fakeBin);

    await execFileAsync("bash", [SCRIPT_PATH], {
      env: {
        ...process.env,
        CI: "",
        npm_config_local_prefix: projectRoot,
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    expect(log).toContain(`codex plugin marketplace add ${projectRoot}`);
    expect(log).toContain("codex plugin add lisa@lisa");
    expect(log).toContain("claude plugin install lisa@lisa --scope project");
    expect(log).not.toContain("apply self");
  });

  it("runs downstream apply before Codex plugin registration", async () => {
    const projectRoot = await makeTempRoot();
    const fakeBin = path.join(projectRoot, "bin");
    const commandLog = path.join(projectRoot, COMMAND_LOG);
    await writeDownstreamProject(projectRoot);
    await writeFakeAgentBins(fakeBin);

    await execFileAsync("bash", [SCRIPT_PATH], {
      env: {
        ...process.env,
        CI: "",
        npm_config_local_prefix: projectRoot,
        LISA_TEST_COMMAND_LOG: commandLog,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const log = await readFile(commandLog, "utf8");
    const applyIndex = log.indexOf("apply downstream");
    const codexIndex = log.indexOf(
      `codex plugin marketplace add ${projectRoot}`
    );
    expect(applyIndex).toBeGreaterThanOrEqual(0);
    expect(codexIndex).toBeGreaterThan(applyIndex);
  });
});
