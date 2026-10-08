/** A subshell's directory changes must never select the parent's script copy. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK = path.resolve("plugins/src/base/hooks/parity-safety-net.sh");
const SCRIPT = "run.sh";
const SAFE = "echo safe";
const DANGEROUS = `${"r"}${"m"} -${"r"}${"f"} /Users/probe/outside-project`;

describe("safety-net compound redirections", () => {
  let root: string;
  let decoy: string;
  let nested: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-subshell-cd-"));
    decoy = path.join(root, "decoy");
    nested = path.join(decoy, "nested");
    mkdirSync(nested, { recursive: true });
    emit(root, SAFE);
    emit(decoy, SAFE);
    emit(nested, SAFE);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /**
   * Write inspected fixture content; the destructive script is never executed.
   * @param directory - Directory containing the inspected fixture.
   * @param content - Synthetic shell source.
   */
  function emit(directory: string, content: string): void {
    writeFileSync(path.join(directory, SCRIPT), `#!/bin/bash\n${content}\n`);
  }

  /**
   * Run the real guard against the proposed shell text.
   * @param command - Proposed text; only the guard executes.
   * @returns Native guard process result.
   */
  function inspect(command: string) {
    return boundedSpawnSync({
      command: "/bin/bash",
      args: [HOOK],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      label: "inspect subshell directory scope",
    });
  }

  it.each(["'>'", String.raw`\>`, "'&>'"])(
    "retains a producer when %s is a literal cat argument",
    literal => {
      emit(root, DANGEROUS);
      const result = inspect(`cat ${SCRIPT} ${literal} /dev/null | bash`);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it.each(["'>'", String.raw`\>`, "'&>'"])(
    "allows safe producer content when %s is an argument",
    literal => {
      const result = inspect(`cat ${SCRIPT} ${literal} /dev/null | bash`);
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it("distinguishes a numeric file operand from an output descriptor", () => {
    const numeric = path.join(root, "2");
    writeFileSync(numeric, DANGEROUS);
    const result = inspect("{ cat 2 >&2; } 2>&1 > /dev/null | bash");
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(numeric);
  });

  it("allows a safe quoted numeric file operand routed through stderr", () => {
    writeFileSync(path.join(root, "2"), SAFE);
    const result = inspect('{ cat "2" >&2; } 2>&1 > /dev/null | bash');
    expect(result.status, result.stderr).toBe(0);
  });

  it("inspects a parenthesized producer with stderr redirection", () => {
    emit(root, DANGEROUS);
    const result = inspect(`( cat ${SCRIPT} ) 2>&1 | bash`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows a safe parenthesized producer with stderr redirection", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`( cat ${SCRIPT} ) 2>&1 | bash`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("preserves non-special backslashes inside a quoted input path", () => {
    const literal = path.join(root, String.raw`literal\path.sh`);
    writeFileSync(literal, DANGEROUS);
    writeFileSync(path.join(root, "literalpath.sh"), SAFE);
    const result = inspect(`{ bash; } < "${literal}"`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(literal);
  });

  it("allows the literal safe input instead of its backslash-stripped decoy", () => {
    const literal = path.join(root, String.raw`literal\path.sh`);
    writeFileSync(literal, SAFE);
    writeFileSync(path.join(root, "literalpath.sh"), DANGEROUS);
    const result = inspect(`{ bash; } < "${literal}"`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("composes nested descriptor routing into the outer pipe", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `{ { cat ${SCRIPT} >&2; } 1>&2; } 2>&1 > /dev/null | bash`
    );
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows nested output routed away from both pipe descriptors", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `{ { cat ${SCRIPT} >&2; } 1>&2; } > /dev/null 2>&1 | bash`
    );
    expect(result.status, result.stderr).toBe(0);
  });
});
