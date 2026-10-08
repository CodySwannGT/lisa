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

describe("safety-net nested pipelines", () => {
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

  it.each([`cat ${SCRIPT}`, `{ cat ${SCRIPT}; }`, `( cat ${SCRIPT} )`])(
    "inspects an internal brace pipeline producer %s despite outer stdout redirection",
    producer => {
      emit(root, DANGEROUS);
      const result = inspect(`{ ${producer} | bash; } > /dev/null`);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it.each([`cat ${SCRIPT}`, `{ cat ${SCRIPT}; }`, `( cat ${SCRIPT} )`])(
    "allows a safe internal brace pipeline producer %s",
    producer => {
      emit(decoy, DANGEROUS);
      const result = inspect(`{ ${producer} | bash; } > /dev/null`);
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it("inspects an internal parenthesized pipeline despite redirected stdout", () => {
    emit(root, DANGEROUS);
    const result = inspect(`( cat ${SCRIPT} | bash ) > /dev/null`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows a safe internal parenthesized pipeline with redirected stdout", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`( cat ${SCRIPT} | bash ) > /dev/null`);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["{ cat; }", "( cat )", "{ cat -; }", "( cat - )"])(
    "inspects named stdin forwarded through %s",
    group => {
      emit(root, DANGEROUS);
      const result = inspect(`${group} < ${SCRIPT} | bash`);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it.each(["{ cat; }", "( cat )", "{ cat -; }", "( cat - )"])(
    "allows safe named stdin forwarded through %s",
    group => {
      emit(decoy, DANGEROUS);
      const result = inspect(`${group} < ${SCRIPT} | bash`);
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it("follows named input through a non-consuming cat pipeline stage", () => {
    emit(root, DANGEROUS);
    const result = inspect(`cat ${SCRIPT} | cat | bash`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows safe input through a non-consuming cat pipeline stage", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`cat ${SCRIPT} | cat | bash`);
    expect(result.status, result.stderr).toBe(0);
  });
});
