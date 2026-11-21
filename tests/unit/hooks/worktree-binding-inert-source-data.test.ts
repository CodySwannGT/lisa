/** Adjudicate Python source as data while leaving the candidate programs unexecuted. */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  bindTo,
  buildFixture,
  runGuard,
  type Fixture,
} from "./support/worktree-binding.js";

/**
 * Submit the literal invocation to the actual guard with fixture binding state.
 * @param fixture - The disposable linked checkouts and synthetic session
 * @param source - The candidate program, read by the guard only
 * @param basename - The owned scratch file name
 * @returns The hook result
 */
function checkPython(
  fixture: Fixture,
  source: string,
  basename = "preflight.py"
) {
  const file = path.join(path.dirname(fixture.main), basename);
  writeFileSync(file, source);
  return runGuard({
    cwd: fixture.a,
    state: fixture.state,
    input: { command: `python3 ${file}` },
  });
}

/**
 * Compare source bytes and keep one real Git operation in the program text.
 * @param fixture - The synthetic binding and linked checkouts
 * @param directory - The cwd argument of the subprocess in the candidate source
 * @returns The candidate source, supplied only to the classifier
 */
function comparison(fixture: Fixture, directory: string): string {
  return [
    "import subprocess",
    `old = b"subprocess.check_output(['git', 'status'], cwd='${fixture.main}')"`,
    `new = b"subprocess.check_output(['git', 'status'], cwd='${fixture.a}')"`,
    `assert old.replace(b"${fixture.main}", b"${fixture.a}") == new`,
    `subprocess.check_output(['git', 'status'], cwd='${directory}')`,
    "",
  ].join("\n");
}

describe("worktree binding when an executed program reads source as data", () => {
  it("allows a comparison of foreign and bound source bytes alongside a bound Git read", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = checkPython(fixture, comparison(fixture, fixture.a));
    expect(result.status, result.stderr).toBe(ALLOWED);
    expect(result.stderr).not.toContain(fixture.main);
  });

  it("does not attribute a file read by Path.read_bytes to the running program", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const data = path.join(path.dirname(fixture.main), "compared-source.py");
    writeFileSync(
      data,
      `subprocess.check_output(['git', 'status'], cwd='${fixture.main}')\n`
    );
    const result = checkPython(
      fixture,
      `from pathlib import Path\ncode = Path(${JSON.stringify(data)}).read_bytes()\nassert code\n`
    );
    expect(result.status, result.stderr).toBe(ALLOWED);
    expect(result.stderr).not.toContain(fixture.main);
  });

  it("refuses a real foreign subprocess directory even when supplied as bytes", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = checkPython(
      fixture,
      `import subprocess\nroot = b"${fixture.main}"\nsubprocess.check_output(['git', 'status'], cwd=root)\n`
    );
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toMatch(/reaches into\s+another worktree/u);
    expect(result.stderr).toContain(fixture.main);
    expect(result.stderr).toContain(fixture.a);
  });

  it("continues to inspect a foreign Git subprocess alongside the source comparison", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = checkPython(fixture, comparison(fixture, fixture.b));
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain(fixture.b);
  });

  it("allows the same Git operation directed into the bound checkout", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = checkPython(
      fixture,
      `import subprocess\nroot = b"${fixture.a}"\nsubprocess.check_output(['git', 'status'], cwd=root)\n`
    );
    expect(result.status, result.stderr).toBe(ALLOWED);
  });

  it("reports uncertainty for oversized scripts and unknown relative origins", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const oversized = checkPython(
      fixture,
      `# ${"x".repeat(256 * 1024)}\nroot = ${JSON.stringify(fixture.main)}\n`
    );
    expect(oversized.status).toBe(ALLOWED);
    expect(oversized.stderr).toContain(
      "too large to inspect; NOT enforcing on it"
    );
    const unknown = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      input: {
        command: 'cd "$UNKNOWN_DIRECTORY" && python3 relative-preflight.py',
      },
    });
    expect(unknown.status).toBe(ALLOWED);
    expect(unknown.stderr).toContain(
      "cannot tell which directory relative-preflight.py would run from; NOT enforcing on it"
    );
  });
});
