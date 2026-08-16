/**
 * Tests the guard that refuses agent writes to Lisa-managed templates.
 *
 * The load-bearing case is `.lisaignore`. `lisa apply` SKIPS an ignored path —
 * it reports `Kept (.lisaignore)` rather than overwriting — so the file is the
 * project's, its edits survive, and refusing them would lock someone out of
 * their own file. The guard shipped without consulting that list, which a peer
 * caught against two real files in one repository pointing opposite ways:
 * `scripts/bdd/render.mjs`, where local fixes revert and the change belongs
 * upstream, and `scripts/classify-maestro-failures.mjs`, a deliberate fork that
 * must be edited locally and never upstreamed.
 *
 * Both are copy-overwrite. Only `.lisaignore` distinguishes them, and without
 * it the guard gave the fork exactly the wrong instruction.
 * @module tests/unit/hooks/block-managed-file-edits
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GUARD = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "hooks",
  "block-managed-file-edits.sh"
);

/** Absolute interpreter path; resolving `bash` through PATH is not permitted. */
const BASH = "/bin/bash";

/** A copy-overwrite template used across the cases. */
const MANAGED = "scripts/classify-maestro-failures.mjs";

let project: string;

/**
 * Run the guard against a tool payload.
 * @param filePath - Target the tool would write
 * @returns Exit status; 2 means refused
 */
function runGuard(filePath: string): number {
  try {
    execFileSync(BASH, [GUARD], {
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: filePath },
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      stdio: "pipe",
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

/**
 * Write a `.lisaignore` for the fixture project.
 * @param body - File contents
 * @returns Nothing.
 */
const ignoreFile = (body: string): void =>
  writeFileSync(path.join(project, ".lisaignore"), body, "utf8");

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "lisa-guard-"));
  const shipped = path.join(
    project,
    "node_modules/@codyswann/lisa/all/copy-overwrite/scripts"
  );
  mkdirSync(shipped, { recursive: true });
  writeFileSync(path.join(shipped, "classify-maestro-failures.mjs"), "x");
  writeFileSync(path.join(shipped, "render.mjs"), "y");
  mkdirSync(
    path.join(project, "node_modules/@codyswann/lisa/typescript/create-only"),
    {
      recursive: true,
    }
  );
  writeFileSync(
    path.join(
      project,
      "node_modules/@codyswann/lisa/typescript/create-only/eslint.config.local.ts"
    ),
    "z"
  );
  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "host-project" })
  );
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("what the guard refuses", () => {
  it("refuses a copy-overwrite template", () => {
    expect(runGuard(MANAGED)).toBe(2);
  });

  it("allows a create-only file, which the host owns", () => {
    expect(runGuard("eslint.config.local.ts")).toBe(0);
  });

  it("allows a file Lisa does not ship", () => {
    expect(runGuard("src/app.ts")).toBe(0);
  });
});

describe(".lisaignore declares project ownership", () => {
  it("allows an ignored template, because apply will not overwrite it", () => {
    // The fork case. Without this the guard told a deliberate fork to go
    // upstream, which is the one place its change must never go.
    ignoreFile(`${MANAGED}\n`);
    expect(runGuard(MANAGED)).toBe(0);
  });

  it("still refuses a DIFFERENT managed file in the same project", () => {
    // The two-directions case: one file forked, one not, in one repository.
    ignoreFile(`${MANAGED}\n`);
    expect(runGuard("scripts/render.mjs")).toBe(2);
  });

  it.each([
    ["a directory pattern", "scripts/\n"],
    ["a glob", "*.mjs\n"],
    ["a bare basename", "classify-maestro-failures.mjs\n"],
  ])("honours %s", (_label, body) => {
    ignoreFile(body);
    expect(runGuard(MANAGED)).toBe(0);
  });

  it.each([
    ["comments and blank lines only", "# nothing here\n\n"],
    ["an unrelated entry", "scripts/other.mjs\n"],
  ])("still refuses with %s", (_label, body) => {
    // The exemption has to be earned. A `.lisaignore` that exists but does not
    // name this path must not read as blanket ownership.
    ignoreFile(body);
    expect(runGuard(MANAGED)).toBe(2);
  });
});

describe("the refusal explains the fork route", () => {
  it("names .lisaignore, so a genuine fork is not told to go upstream", () => {
    let stderr = "";
    try {
      execFileSync(BASH, [GUARD], {
        input: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: MANAGED },
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: project },
        stdio: "pipe",
      });
    } catch (error) {
      stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    }
    expect(stderr).toContain(".lisaignore");
    expect(stderr).toContain("LISA_ALLOW_MANAGED_FILE_WRITE");
  });
});
