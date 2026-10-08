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
const UNCLASSIFIABLE = "cannot classify the file this command executes";

describe("safety-net inline and asynchronous scope", () => {
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

  it("does not export caller functions to an inline child shell", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { cd ${decoy}; }; bash -c 'move'; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("restores the parent after an inline child changes directory", () => {
    emit(root, DANGEROUS);
    const result = inspect(`bash -c 'cd ${decoy}'; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("inspects the copy executed after an inline child's cd", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`bash -c 'cd ${decoy}; bash ${SCRIPT}'`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows the safe copy executed by an inline child", () => {
    emit(root, DANGEROUS);
    const result = inspect(`bash -c 'cd ${decoy}; bash ${SCRIPT}'`);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["'bash 'run.sh", "'echo safe''; bash run.sh'"])(
    "refuses unsupported concatenated inline operand %s",
    operand => {
      emit(root, DANGEROUS);
      const result = inspect(`bash -c ${operand}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    }
  );

  it("does not execute an inline shell's trailing positional arguments", () => {
    emit(root, DANGEROUS);
    const result = inspect(`bash -c 'echo safe' bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["cd DECOY & wait;", "cd DECOY && echo done & wait;"])(
    "restores the parent after the asynchronous list %s",
    prefix => {
      emit(root, DANGEROUS);
      const result = inspect(
        `${prefix.replace("DECOY", decoy)} bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it("allows the safe parent despite a background directory change", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`cd ${decoy} & wait; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("inspects the destructive copy executed by an asynchronous list", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`cd ${decoy} && bash ${SCRIPT} & wait`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("does not trust functions defined by a conditional call", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `define() { move() { cd ${decoy}; }; }; false && define; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it("restores parent flow certainty after a child branch", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `(if true; then echo safe; fi); cd ${decoy}; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["&>", "&>>"])(
    "keeps the parent cwd across %s redirection",
    operator => {
      emit(decoy, DANGEROUS);
      const result = inspect(
        `cd ${decoy} ${operator} /dev/null; bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(decoy, SCRIPT));
    }
  );

  it("allows a safe directory selected before a combined redirection", () => {
    emit(root, DANGEROUS);
    const result = inspect(`cd ${decoy} &> /dev/null; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["echo' safe; bash run.sh'", "bash' run.sh'"])(
    "refuses the bare-leading concatenated inline operand %s",
    operand => {
      emit(root, DANGEROUS);
      const result = inspect(`bash -c ${operand}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    }
  );

  it("allows an ordinary bare inline operand", () => {
    const result = inspect("bash -c true");

    expect(result.status, result.stderr).toBe(0);
  });

  it("continues a function after its background return", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `move() { return & wait; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a safe cwd selected after a function's background return", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { return & wait; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("bounds lexical lookahead through deeply nested scopes", () => {
    const result = inspect(`${"( ".repeat(256)}echo safe${") ".repeat(256)}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(
      "scope parsing exceeds the inspection budget"
    );
  });
});
