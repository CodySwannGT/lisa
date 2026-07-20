/**
 * Remote AWS setup wrapper regression coverage.
 * @module tests/unit/strategies/remote-agent-aws-setup-wrapper
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const REMOTE_SETUP_WRAPPER_PATH =
  "all/create-only/scripts/remote-agent-aws-setup.sh";
const temporaryDirectories: string[] = [];

/**
 * Create and register a disposable project directory.
 * @returns Absolute path to the disposable directory
 */
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lisa-remote-aws-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("remote AWS setup wrapper", () => {
  it("prints installation guidance when npm is unavailable", () => {
    const emptyPath = temporaryDirectory();
    const result = spawnSync("/bin/bash", [REMOTE_SETUP_WRAPPER_PATH], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "remote-agent-aws-setup: install @codyswann/lisa before running this setup script\n"
    );
  });

  it("delegates to the installed Lisa script with every argument unchanged", () => {
    const root = temporaryDirectory();
    const binaryDirectory = path.join(root, "bin");
    const packageRoot = path.join(root, "node_modules");
    const installedScript = path.join(
      packageRoot,
      "@codyswann/lisa/plugins/lisa/scripts/remote-agent-aws-setup.sh"
    );
    const argumentLog = path.join(root, "arguments.log");
    mkdirSync(binaryDirectory, { recursive: true });
    mkdirSync(path.dirname(installedScript), { recursive: true });
    writeFileSync(
      path.join(binaryDirectory, "npm"),
      `#!/bin/bash\nprintf '%s\\n' "${packageRoot}"\n`
    );
    writeFileSync(
      installedScript,
      '#!/bin/bash\nprintf \'%s\\0\' "$@" > "$FAKE_ARGUMENT_LOG"\nexit 23\n'
    );
    chmodSync(path.join(binaryDirectory, "npm"), 0o700);
    chmodSync(installedScript, 0o700);
    const argumentsToForward = ["plain", "two words", "--flag=value"];

    const result = spawnSync(
      "/bin/bash",
      [REMOTE_SETUP_WRAPPER_PATH, ...argumentsToForward],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: binaryDirectory,
          FAKE_ARGUMENT_LOG: argumentLog,
        },
      }
    );

    expect(result.status).toBe(23);
    expect(readFileSync(argumentLog, "utf8").split("\0").slice(0, -1)).toEqual(
      argumentsToForward
    );
  });
});
