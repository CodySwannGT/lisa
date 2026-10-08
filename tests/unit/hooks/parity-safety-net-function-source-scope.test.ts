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

describe("safety-net function and source scope", () => {
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

  it("follows a called function's parent directory change", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`move() { cd ${decoy}; }; move; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a called function's safe copy despite a destructive parent", () => {
    emit(root, DANGEROUS);
    const result = inspect(`move() { cd ${decoy}; }; move; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("does not follow a script in an uncalled function declaration", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `noop() { bash ${path.join(decoy, SCRIPT)}; }; echo safe`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("follows a script inside a called function", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`run() { bash ${path.join(decoy, SCRIPT)}; }; run`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("refuses a relative script after case arms establish differing directories", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `(case x in x) cd ${decoy};; y) cd ${nested};; esac; bash ${SCRIPT})`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it("keeps a case with no directory changes classifiable", () => {
    const result = inspect(
      `case x in x) echo one;; y) echo two;; esac; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("refuses uncertain case cwd inside a followed driver too", () => {
    emit(decoy, DANGEROUS);
    writeFileSync(
      path.join(root, "driver.sh"),
      `case x in x) cd ${decoy};; y) cd ${nested};; esac; bash ${SCRIPT}\n`
    );
    const result = inspect("bash driver.sh");

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it("allows an absolute safe script after an uncertain case cwd", () => {
    const result = inspect(
      `case x in x) cd ${decoy};; y) cd ${nested};; esac; bash ${path.join(root, SCRIPT)}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("does not follow a function's directory change after its return", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `move() { return; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("inspects the parent copy after a function returns before cd", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { return; cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("retains a function declared by a called function", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `define() { move() { cd ${decoy}; }; }; define; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a safe copy selected by a function declared at call time", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `define() { move() { cd ${decoy}; }; }; define; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("does not call a declared function through the command builtin", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { cd ${decoy}; }; command move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it.each(["source", "."])("retains definitions from %s", command => {
    emit(decoy, DANGEROUS);
    writeFileSync(path.join(root, "defs.sh"), `move() { cd ${decoy}; }\n`);
    const result = inspect(`${command} defs.sh; move; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it.each(["source", "."])(
    "allows a safe directory selected by %s definitions",
    command => {
      emit(root, DANGEROUS);
      writeFileSync(path.join(root, "defs.sh"), `move() { cd ${decoy}; }\n`);
      const result = inspect(`${command} defs.sh; move; bash ${SCRIPT}`);

      expect(result.status, result.stderr).toBe(0);
    }
  );

  it("does not export caller functions to an ordinary child script", () => {
    emit(root, DANGEROUS);
    writeFileSync(path.join(root, "driver.sh"), `move; bash ${SCRIPT}\n`);
    const result = inspect(`move() { cd ${decoy}; }; bash driver.sh`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows a safe child script despite an unavailable caller function", () => {
    emit(decoy, DANGEROUS);
    writeFileSync(path.join(root, "driver.sh"), `move; bash ${SCRIPT}\n`);
    const result = inspect(`move() { cd ${decoy}; }; bash driver.sh`);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["false &&", "true ||"])(
    "refuses an uncertain cd after %s",
    prefix => {
      emit(root, DANGEROUS);
      const result = inspect(`${prefix} cd ${decoy}; bash ${SCRIPT}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    }
  );

  it("recovers a known directory with an unconditional absolute cd", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`false && cd ${decoy}; cd ${root}; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["false &&", "true ||"])(
    "does not prove a conditional return after %s",
    prefix => {
      emit(decoy, DANGEROUS);
      const result = inspect(
        `move() { ${prefix} return; cd ${decoy}; }; move; bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    }
  );

  it("bounds total work in an acyclic branching function graph", () => {
    const definitions = ["f0() { :; };"];
    for (let index = 1; index <= 10; index++)
      definitions.push(`f${index}() { f${index - 1}; f${index - 1}; };`);
    const result = inspect(`${definitions.join(" ")} f10`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(
      "function expansion exceeds the inspection budget"
    );
  });

  it.each(["source", "."])("honors an early return in %s", command => {
    emit(root, DANGEROUS);
    writeFileSync(path.join(root, "defs.sh"), `return; cd ${decoy}\n`);
    const result = inspect(`${command} defs.sh; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it.each(["source", "."])(
    "allows the safe parent after %s returns",
    command => {
      emit(decoy, DANGEROUS);
      writeFileSync(path.join(root, "defs.sh"), `return; cd ${decoy}\n`);
      const result = inspect(`${command} defs.sh; bash ${SCRIPT}`);

      expect(result.status, result.stderr).toBe(0);
    }
  );

  it.each(["if false; then", "while false; do"])(
    "refuses a source cwd effect under %s",
    prefix => {
      emit(root, DANGEROUS);
      writeFileSync(path.join(root, "defs.sh"), `cd ${decoy}\n`);
      const closing = prefix.startsWith("if") ? "fi" : "done";
      const result = inspect(
        `${prefix} source defs.sh; ${closing}; bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    }
  );

  it("continues the function after its subshell returns", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `move() { (return); cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a safe directory after a function's subshell returns", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `move() { (return); cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("does not trust a conditionally declared function", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `false && move() { cd ${decoy}; }; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it("does not trust definitions from a source call that may not execute", () => {
    emit(root, DANGEROUS);
    writeFileSync(path.join(root, "defs.sh"), `move() { cd ${decoy}; }\n`);
    const result = inspect(
      `if false; then source defs.sh; fi; move; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });
});
