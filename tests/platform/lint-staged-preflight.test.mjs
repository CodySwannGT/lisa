import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL(
    "../../all/copy-overwrite/scripts/lisa-lint-staged-preflight.mjs",
    import.meta.url
  )
);

// Exercise the actual CLI on Windows without installing the POSIX test toolchain.
const fixture = t => {
  const cwd = mkdtempSync(path.join(tmpdir(), "lisa preflight "));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, "node_modules", ".bin"), { recursive: true });
  return cwd;
};

const run = (cwd, command) => {
  writeFileSync(
    path.join(cwd, ".lintstagedrc.json"),
    JSON.stringify({ "*.ts": [command] })
  );
  try {
    return {
      status: 0,
      output: execFileSync(process.execPath, [script], {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 20000,
      }),
    };
  } catch (error) {
    return {
      status: error.status,
      output: String(error.stdout) + String(error.stderr),
    };
  }
};

test("missing requested tool is refused even when a shell is available", t => {
  const result = run(fixture(t), "lisa-missing-tool-2736-no-install --fix");
  assert.equal(result.status, 1);
  assert.match(result.output, /lisa-missing-tool-2736-no-install/);
});

test("native executable can start", t => {
  assert.equal(run(fixture(t), "node --version").status, 0);
});

for (const exitCode of [0, 3]) {
  test(
    `Windows local cmd shim remains available with exit ${exitCode}`,
    { skip: process.platform !== "win32" },
    t => {
      const cwd = fixture(t);
      writeFileSync(
        path.join(cwd, "node_modules", ".bin", "lisa-fixture-tool.cmd"),
        `@echo off\r\nexit /b ${exitCode}\r\n`
      );
      assert.equal(run(cwd, "lisa-fixture-tool --fix").status, 0);
    }
  );
}

test(
  "Windows missing explicit executable path is refused",
  { skip: process.platform !== "win32" },
  t => {
    const cwd = fixture(t);
    assert.equal(
      run(cwd, `"${path.join(cwd, "absent tool.cmd")}" --fix`).status,
      1
    );
  }
);
