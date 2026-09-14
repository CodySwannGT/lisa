import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const supervisor = fileURLToPath(
  new URL(
    "../../all/copy-overwrite/scripts/lib/process-tree-runner.mjs",
    import.meta.url
  )
);
const windowsOnly = { skip: process.platform !== "win32", timeout: 60000 };
const windowsRoot = env.SystemRoot || "C:\\Windows";

/**
 * Run a native Windows diagnostic with failures surfaced to the test.
 * @param {string} source PowerShell source, encoded rather than shell quoted.
 * @returns {string} Trimmed diagnostic output.
 */
function powershell(source) {
  const result = spawnSync(
    path.join(
      windowsRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    ),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference = 'Stop'\n${source}`,
        "utf16le"
      ).toString("base64"),
    ],
    { encoding: "utf8", timeout: 15000 }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/**
 * Observe or stop only the process carrying this fixture's unique script path.
 * @param {number} pid Recorded descendant PID.
 * @param {string} childPath Unique script identifying the owned process.
 * @param {boolean} stop Whether to stop the identified process.
 * @returns {string} Liveness marker, or empty output for an absent process.
 */
function fixtureProcess(pid, childPath, stop = false) {
  // Match the fixture's unique path before observing or stopping its PID.
  const encodedPath = Buffer.from(childPath, "utf8").toString("base64");
  return powershell(`
$expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$found = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'
if ($found -and $found.CommandLine.Contains($expected)) {
  ${stop ? "Stop-Process -Id $found.ProcessId -Force -ErrorAction Stop" : "Write-Output 'alive'"}
}
`);
}

/**
 * Create a shell command whose detached descendant outlives its direct shell.
 * @param {import("node:test").TestContext} t Owner of bounded fixture cleanup.
 * @returns {object} Paths and the shell command for this fixture.
 */
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa windows tree "));
  const childPath = path.join(root, "background.cjs");
  const launcherPath = path.join(root, "launcher.cjs");
  const readyPath = path.join(root, "ready.json");
  const shellPath = path.join(root, "shell.json");
  writeFileSync(
    childPath,
    `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid }));
setInterval(() => {}, 1000);
`
  );
  writeFileSync(
    launcherPath,
    `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(shellPath)}, JSON.stringify({ pid: process.ppid }));
console.log('WINDOWS_GATE_SHELL_STARTED', process.ppid);
const child = spawn(process.execPath, [${JSON.stringify(childPath)}], {
  detached: true, stdio: 'ignore'
});
child.unref();
const deadline = Date.now() + 10000;
const waiting = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(readyPath)})) {
    console.log('WINDOWS_GATE_CHILD_READY', child.pid);
    clearInterval(waiting);
  }
  else if (Date.now() > deadline) process.exit(2);
}, 20);
`
  );
  t.after(() => {
    try {
      const { pid } = JSON.parse(readFileSync(readyPath, "utf8"));
      fixtureProcess(pid, childPath, true);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  return {
    root,
    childPath,
    readyPath,
    shellPath,
    command: "node launcher.cjs",
  };
}

/**
 * Require successful shell exit and inspect the descendant immediately.
 * @param {object} f Owned fixture paths.
 * @param {object} result Native shell or supervisor result.
 * @returns {boolean} Whether the uniquely identified descendant remains alive.
 */
function observe(f, result) {
  if (result.error) throw result.error;
  if (result.status !== 0) assert.equal(result.status, 0, result.stderr);
  const child = JSON.parse(readFileSync(f.readyPath, "utf8"));
  const shell = JSON.parse(readFileSync(f.shellPath, "utf8"));
  assert.ok(child.pid > 1);
  assert.ok(shell.pid > 1);
  assert.throws(() => process.kill(shell.pid, 0), { code: "ESRCH" });
  // Probe immediately, before starting the slower identity lookup: delayed
  // cleanup after supervise returns must not pass merely because CIM is slow.
  try {
    process.kill(child.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
  assert.equal(fixtureProcess(child.pid, f.childPath), "alive");
  return true;
}

/**
 * Capture diagnostics without waiting for inherited output pipes to close.
 * @param {object} f Owned fixture paths and command.
 * @returns {object} Actual process result and the captured output files.
 */
function runSupervisor(f) {
  const outputPath = path.join(f.root, "supervisor.stdout");
  const errorPath = path.join(f.root, "supervisor.stderr");
  const output = openSync(outputPath, "w");
  const errors = openSync(errorPath, "w");
  try {
    const result = spawnSync(
      process.execPath,
      [supervisor, "--timeout-ms=20000", "--", f.command],
      { cwd: f.root, stdio: ["ignore", output, errors], timeout: 30000 }
    );
    return {
      ...result,
      stdout: readFileSync(outputPath, "utf8"),
      stderr: readFileSync(errorPath, "utf8"),
    };
  } finally {
    closeSync(output);
    closeSync(errors);
  }
}

test(
  "control: a Windows shell can exit while its detached descendant lives",
  windowsOnly,
  t => {
    const f = fixture(t);
    const result = spawnSync(
      env.ComSpec || path.join(windowsRoot, "System32", "cmd.exe"),
      ["/d", "/s", "/c", f.command],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 30000,
      }
    );
    assert.equal(observe(f, result), true);
  }
);

test(
  "Windows supervisor reaps descendants after the direct shell exits",
  windowsOnly,
  t => {
    const f = fixture(t);
    const result = runSupervisor(f);
    t.diagnostic(
      JSON.stringify({
        status: result.status,
        signal: result.signal,
        error: result.error?.code,
        stdout: result.stdout,
        stderr: result.stderr,
      })
    );
    assert.equal(
      observe(f, result),
      false,
      "supervisor returned while its background descendant remained alive"
    );
  }
);
