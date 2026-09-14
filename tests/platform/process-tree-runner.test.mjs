import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fixture,
  fixtureProcess,
  observe,
  runSupervisor,
  supervisor,
  windowsOnly,
  windowsRoot,
  SUPERVISOR_DEADLINE,
} from "./windows-process-fixture.mjs";

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

for (const code of [0, 17, 124, 128, 143, 255]) {
  test(
    `Windows supervisor preserves ordinary exit ${code}`,
    windowsOnly,
    () => {
      const result = spawnSync(
        process.execPath,
        [supervisor, SUPERVISOR_DEADLINE, "--", `exit /b ${code}`],
        { encoding: "utf8", timeout: 30000 }
      );
      assert.ifError(result.error);
      assert.equal(result.status, code, result.stderr);
      assert.equal(result.signal, null);
    }
  );
}

for (const absent of [0, -1]) {
  test(
    `Windows native job accepts absent standard handles (${absent})`,
    windowsOnly,
    t => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-windows-handles-"));
      t.after(() => rmSync(root, { recursive: true, force: true }));
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
          "-File",
          fileURLToPath(
            new URL("./windows-missing-handles.ps1", import.meta.url)
          ),
          "-NativeSource",
          path.join(path.dirname(supervisor), "windows-process-job.cs"),
          "-ControlDirectory",
          root,
          "-AbsentHandle",
          String(absent),
        ],
        {
          encoding: "utf8",
          timeout: 30000,
          env: { ...env, TEMP: root, TMP: root },
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(path.join(root, "result.txt"), "utf8"), "17");
      assert.equal(
        readFileSync(path.join(root, "launch.txt"), "utf8").trim(),
        "launched"
      );
    }
  );
}

test(
  "Windows supervisor preserves quoted arguments and inherited input/output",
  windowsOnly,
  t => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa windows io "));
    const input = "native input with Unicode Ω\r\n";
    const command = `"${process.execPath}" "io fixture.cjs" "words & spaces"`;
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(
      path.join(root, "io fixture.cjs"),
      `
process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ input, args: process.argv.slice(2), temp: process.env.TEMP, marker: process.env.LISA_TEST_JOB_MARKER }));
  process.stderr.write('native stderr');
  process.exitCode = 17;
});
`
    );
    const result = spawnSync(
      process.execPath,
      [supervisor, SUPERVISOR_DEADLINE, "--", command],
      {
        cwd: root,
        encoding: "utf8",
        input,
        timeout: 30000,
        env: { ...env, TEMP: root, LISA_TEST_JOB_MARKER: "preserved" },
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      input,
      args: ["words & spaces"],
      temp: root,
      marker: "preserved",
    });
    assert.equal(result.stderr, "native stderr");
  }
);

test(
  "Windows timeout reaps the job before reporting exit 255",
  windowsOnly,
  t => {
    const f = fixture(t, true);
    const result = spawnSync(
      process.execPath,
      [supervisor, "--timeout-ms=10000", "--", f.command],
      { cwd: f.root, encoding: "utf8", timeout: 45000 }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 255, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(observe(f, result, 255), false);
  }
);

test(
  "Windows supervise promise resolves only after the descendant exits",
  windowsOnly,
  t => {
    const f = fixture(t);
    const receipt = path.join(f.root, "promise.json");
    const probe = path.join(f.root, "promise.mjs");
    writeFileSync(
      probe,
      `
import { supervise } from ${JSON.stringify(pathToFileURL(supervisor).href)};
import { readFileSync, writeFileSync } from 'node:fs';
const result = await supervise('node launcher.cjs', 20000);
const { pid } = JSON.parse(readFileSync(${JSON.stringify(f.readyPath)}, 'utf8'));
let alive = true;
try { process.kill(pid, 0); }
catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ result, alive }));
`
    );
    const result = spawnSync(process.execPath, [probe], {
      cwd: f.root,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), {
      result: { code: 0, signal: null },
      alive: false,
    });
  }
);

test(
  "Windows watched-owner exit reaps the job and reports interruption",
  windowsOnly,
  t => {
    const f = fixture(t, true);
    const ownerPath = path.join(f.root, "owner.cjs");
    writeFileSync(
      ownerPath,
      `
const fs = require('node:fs');
const deadline = Date.now() + 15000;
setInterval(() => {
  if (fs.existsSync(${JSON.stringify(f.readyPath)}) || Date.now() >= deadline) process.exit(0);
}, 25);
`
    );
    const owner = spawn(process.execPath, [ownerPath], { stdio: "ignore" });
    assert.ok(owner.pid > 1);
    t.after(() => fixtureProcess(owner.pid, ownerPath, true));
    const result = spawnSync(
      process.execPath,
      [
        supervisor,
        SUPERVISOR_DEADLINE,
        `--watch-pid=${owner.pid}`,
        "--",
        f.command,
      ],
      { cwd: f.root, encoding: "utf8", timeout: 30000 }
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /INTERRUPTED/u);
    assert.equal(observe(f, result, result.status), false);
  }
);
