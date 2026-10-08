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

describe("safety-net brace scope", () => {
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

  it("restores the parent after a background brace group", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `{ cd ${decoy}; echo done; } & wait; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows the safe parent despite a background brace group's cd", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `{ cd ${decoy}; echo done; } & wait; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("continues a function after a background brace group returns", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `move() { { :; return; } & wait; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a safe function cwd after a background brace group's return", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { { :; return; } & wait; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["false &&", "true ||"])(
    "retains the condition throughout a brace group after %s",
    prefix => {
      emit(root, DANGEROUS);
      const result = inspect(
        `${prefix} { echo safe; cd ${decoy}; }; bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    }
  );

  it("recovers after a conditional brace with an unconditional absolute cd", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `false && { echo safe; cd ${decoy}; }; cd ${root}; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("does not prove a function's cwd after a conditional brace return", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { true && { return; }; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it("keeps unquoted brace arguments as data before a destructive parent", () => {
    emit(root, DANGEROUS);
    const result = inspect(`echo { cd ${decoy} }; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows the safe parent despite unquoted brace arguments", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`echo { cd ${decoy} }; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("restores the parent after a brace pipeline component", () => {
    emit(root, DANGEROUS);
    const result = inspect(`{ cd ${decoy}; echo done; } | cat; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows the safe parent after a brace pipeline component", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`{ cd ${decoy}; echo done; } | cat; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("continues a function after its brace pipeline returns", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `move() { { return; } | cat; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows the safe cwd after a function's brace pipeline returns", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { { return; } | cat; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("inspects a brace pipeline producer in its own directory", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`{ cd ${decoy}; cat ${SCRIPT}; } | bash`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a safe brace pipeline producer despite the parent copy", () => {
    emit(root, DANGEROUS);
    const result = inspect(`{ cd ${decoy}; cat ${SCRIPT}; } | bash`);

    expect(result.status, result.stderr).toBe(0);
  });
});
