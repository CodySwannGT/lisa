/** A subshell's directory changes must never select the parent's script copy. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK = path.resolve("plugins/src/base/hooks/parity-safety-net.sh");
const SCRIPT = "run.sh";
const NON_CONSUMING = ["echo preparing", ":", "cd /tmp"];
const SAFE = "echo safe";
const DANGEROUS = `${"r"}${"m"} -${"r"}${"f"} /Users/probe/outside-project`;
const UNCLASSIFIABLE = "cannot classify the file this command executes";

describe("safety-net compound pipelines", () => {
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

  it.each(["> /dev/null", "2>&1", '> "pipe|data"'])(
    "restores the parent after a brace pipeline with %s redirection",
    redirection => {
      emit(root, DANGEROUS);
      const result = inspect(
        `{ cd ${decoy}; echo done; } ${redirection} | cat; bash ${SCRIPT}`
      );
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it.each(["> /dev/null", "2>&1", '> "pipe|data"'])(
    "allows the safe parent after a redirected brace pipeline with %s",
    redirection => {
      emit(decoy, DANGEROUS);
      const result = inspect(
        `{ cd ${decoy}; echo done; } ${redirection} | cat; bash ${SCRIPT}`
      );
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it("inspects a brace pipeline consumer after its own cd", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`echo safe | { cd ${decoy}; bash ${SCRIPT}; }`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a safe brace pipeline consumer despite the parent copy", () => {
    emit(root, DANGEROUS);
    const result = inspect(`echo safe | { cd ${decoy}; bash ${SCRIPT}; }`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("inspects incoming file content consumed by a brace shell", () => {
    emit(root, DANGEROUS);
    const result = inspect(`cat ${SCRIPT} | { bash; }`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows safe incoming file content consumed by a brace shell", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`cat ${SCRIPT} | { bash; }`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("shares cwd after a synchronous brace with quoted operator data", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `{ cd ${decoy}; echo done; } > "pipe|data"; bash ${SCRIPT}`
    );
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows safe cwd after a synchronous brace with quoted operator data", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `{ cd ${decoy}; echo done; } > "pipe|data"; bash ${SCRIPT}`
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["2>&1", "2>/dev/null"])(
    "inspects a brace producer with %s stderr redirection",
    redirection => {
      emit(decoy, DANGEROUS);
      const result = inspect(
        `{ cd ${decoy}; cat ${SCRIPT}; } ${redirection} | bash`
      );
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(decoy, SCRIPT));
    }
  );

  it.each(["2>&1", "2>/dev/null"])(
    "allows a safe brace producer with %s stderr redirection",
    redirection => {
      emit(root, DANGEROUS);
      const result = inspect(
        `{ cd ${decoy}; cat ${SCRIPT}; } ${redirection} | bash`
      );
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it.each(NON_CONSUMING)("keeps incoming brace stdin after %s", prefix => {
    emit(root, DANGEROUS);
    const result = inspect(`cat ${SCRIPT} | { ${prefix}; bash; }`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it.each(NON_CONSUMING)(
    "allows safe incoming brace stdin after %s",
    prefix => {
      emit(decoy, DANGEROUS);
      const result = inspect(`cat ${SCRIPT} | { ${prefix}; bash; }`);
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it("does not inspect producer bytes redirected away from the pipe", () => {
    emit(root, DANGEROUS);
    const result = inspect(`{ cat ${SCRIPT}; } > /dev/null | bash`);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(NON_CONSUMING)("keeps subshell pipeline stdin after %s", prefix => {
    emit(root, DANGEROUS);
    const result = inspect(`cat ${SCRIPT} | ( ${prefix}; bash; )`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it.each(NON_CONSUMING)(
    "allows safe subshell pipeline stdin after %s",
    prefix => {
      emit(decoy, DANGEROUS);
      const result = inspect(`cat ${SCRIPT} | ( ${prefix}; bash; )`);
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it.each(["2>&1 > /dev/null 1>&2", "3>&1 > /dev/null 1>&3"])(
    "inspects a producer whose output is restored through %s",
    redirection => {
      emit(root, DANGEROUS);
      const result = inspect(`{ cat ${SCRIPT}; } ${redirection} | bash`);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it.each(["{ bash; }", "( bash )"])(
    "inspects the literal input redirection that overrides a pipe for %s",
    group => {
      emit(decoy, DANGEROUS);
      const result = inspect(
        `cat ${SCRIPT} | ${group} < ${path.join(decoy, SCRIPT)}`
      );
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(decoy, SCRIPT));
    }
  );

  it.each(["{ bash; }", "( bash )"])(
    "allows literal safe input overriding a destructive producer for %s",
    group => {
      emit(root, DANGEROUS);
      const result = inspect(
        `cat ${SCRIPT} | ${group} < ${path.join(decoy, SCRIPT)}`
      );
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it("inspects a brace producer routed through stderr into the pipe", () => {
    emit(root, DANGEROUS);
    const result = inspect(`{ cat ${SCRIPT} >&2; } 2>&1 > /dev/null | bash`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows a producer whose stdout and stderr are both redirected away", () => {
    emit(root, DANGEROUS);
    const result = inspect(`{ cat ${SCRIPT} >&2; } > /dev/null 2>&1 | bash`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("resolves compound input before the brace changes directory", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `cat ${path.join(decoy, SCRIPT)} | { cd ${decoy}; bash; } < ${SCRIPT}`
    );
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("allows safe compound input despite a later destructive cwd", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      `cat ${path.join(decoy, SCRIPT)} | { cd ${decoy}; bash; } < ${SCRIPT}`
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it("refuses an unknown inherited descriptor instead of dropping its content", () => {
    const result = inspect(`{ cat ${SCRIPT}; } 1>&9 | bash`);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
    expect(result.stderr).toContain(
      "input or pipeline output could not be determined"
    );
  });
});
