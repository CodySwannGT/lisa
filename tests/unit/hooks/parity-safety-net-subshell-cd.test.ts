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

describe("safety-net subshell directory scope", () => {
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

  it.each(["(cd DECOY);", "( cd DECOY );", "( (cd DECOY) );"])(
    "blocks the parent's destructive copy after %s",
    prefix => {
      emit(root, DANGEROUS);
      const result = inspect(
        `${prefix.replace("DECOY", decoy)} bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it("allows the parent's safe copy despite a destructive decoy", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`(cd ${decoy}); bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("allows the safe script actually executed inside the subshell", () => {
    emit(root, DANGEROUS);
    const result = inspect(`(cd ${decoy}; bash ${SCRIPT})`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("blocks the destructive copy actually executed inside the subshell", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`(cd ${decoy}; bash ${SCRIPT})`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("restores the outer subshell directory after a nested subshell", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`(cd ${decoy}; (cd nested); bash ${SCRIPT})`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("restores a parent's prior literal cd rather than the hook's PWD", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`cd ${decoy}; (cd nested); bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("restores a known parent directory after an unknown subshell cd", () => {
    emit(root, DANGEROUS);
    const result = inspect(`(cd "$UNKNOWN"); bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("keeps an unknown directory unknown through a relative cd", () => {
    const result = inspect(`cd "$UNKNOWN"; cd decoy; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it("allows an absolute cd to establish a directory after an unknown one", () => {
    const result = inspect(`cd "$UNKNOWN"; cd ${decoy}; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["quoted", "unquoted"])(
    "still follows a %s cat substitution executed by eval",
    quoting => {
      emit(root, DANGEROUS);
      const substitution = `$(cat ${path.join(root, SCRIPT)})`;
      const argument =
        quoting === "quoted" ? `"${substitution}"` : substitution;
      const result = inspect(`eval ${argument}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it("leaves parentheses quoted as ordinary argument data alone", () => {
    const result = inspect(`echo '(cd ${decoy})'; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("still inspects a subshell cat pipeline executed by bash", () => {
    emit(root, DANGEROUS);
    const result = inspect(`(cat ${SCRIPT}) | bash`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("does not treat a logical OR as a cat pipeline", () => {
    emit(root, DANGEROUS);
    const result = inspect(`cat ${SCRIPT} || bash`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("restores an unknown parent after a subshell establishes a literal cwd", () => {
    const result = inspect(`cd "$UNKNOWN"; (cd ${decoy}); bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it("also restores scope while following a shell script", () => {
    emit(root, DANGEROUS);
    writeFileSync(
      path.join(root, "driver.sh"),
      `#!/bin/bash\n(cd ${decoy}); bash ${SCRIPT}\n`
    );
    const result = inspect("bash driver.sh");

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it("inspects a pipeline's destructive producer in its original cwd", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`(cd ${decoy}; cat ${SCRIPT}) | bash`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it("allows a safe pipeline producer despite a destructive parent copy", () => {
    emit(root, DANGEROUS);
    const result = inspect(`(cd ${decoy}; cat ${SCRIPT}) | bash`);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    "noop () { cd DECOY; };",
    "noop() { cd DECOY; };",
    "function noop { cd DECOY; };",
    "(case x in x) cd DECOY;; esac);",
    "(case x in x|y) cd DECOY;; esac);",
    "(case x in (x) cd DECOY;; esac);",
    "(case x in x) cd DECOY;; y) cd DECOY;; esac);",
    "echo $(true; cd DECOY);",
  ])("blocks the parent script after isolated syntax %s", prefix => {
    emit(root, DANGEROUS);
    const result = inspect(`${prefix.replace("DECOY", decoy)} bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
  });

  it.each([
    "noop () { cd DECOY; };",
    "noop() { cd DECOY; };",
    "function noop { cd DECOY; };",
    "(case x in x) cd DECOY;; esac);",
    "(case x in x|y) cd DECOY;; esac);",
    "(case x in (x) cd DECOY;; esac);",
    "(case x in x) cd DECOY;; y) cd DECOY;; esac);",
    "echo $(true; cd DECOY);",
  ])("allows the parent script after isolated syntax %s", prefix => {
    emit(decoy, DANGEROUS);
    const result = inspect(`${prefix.replace("DECOY", decoy)} bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps an ordinary brace group's cd in the parent", () => {
    emit(decoy, DANGEROUS);
    const result = inspect(`{ cd ${decoy}; }; bash ${SCRIPT}`);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
  });

  it.each(["unquoted", "quoted"])(
    "blocks a destructive script executed in a %s substitution",
    quoting => {
      emit(decoy, DANGEROUS);
      const substitution = `$(cd ${decoy}; bash ${SCRIPT})`;
      const argument =
        quoting === "quoted" ? `"${substitution}"` : substitution;
      const result = inspect(`echo ${argument}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(decoy, SCRIPT));
    }
  );

  it.each(["unquoted", "quoted"])(
    "allows a safe script executed in a %s substitution",
    quoting => {
      emit(root, DANGEROUS);
      const substitution = `$(cd ${decoy}; bash ${SCRIPT})`;
      const argument =
        quoting === "quoted" ? `"${substitution}"` : substitution;
      const result = inspect(`echo ${argument}`);

      expect(result.status, result.stderr).toBe(0);
    }
  );

  it.each(["cd DECOY | true;", "echo `true; cd DECOY; true`;"])(
    "blocks the destructive parent after %s",
    prefix => {
      emit(root, DANGEROUS);
      const result = inspect(
        `${prefix.replace("DECOY", decoy)} bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(path.join(root, SCRIPT));
    }
  );

  it.each(["cd DECOY | true;", "echo `true; cd DECOY; true`;"])(
    "allows the safe parent after %s",
    prefix => {
      emit(decoy, DANGEROUS);
      const result = inspect(
        `${prefix.replace("DECOY", decoy)} bash ${SCRIPT}`
      );

      expect(result.status, result.stderr).toBe(0);
    }
  );
});
