/** Reached AND branches and joined continuations resolve different cwd states. */
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

describe("safety-net reached AND branch directory", () => {
  let root: string;
  let decoy: string;
  let nested: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-and-cd-"));
    decoy = path.join(root, "decoy");
    nested = path.join(decoy, "nested");
    mkdirSync(nested, { recursive: true });
    emit(root, SAFE);
    emit(decoy, SAFE);
    emit(nested, SAFE);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /**
   * Write inspected source; the destructive fixture is never executed.
   * @param directory - Directory containing the inspected fixture.
   * @param content - Synthetic shell source.
   */
  function emit(directory: string, content: string): void {
    writeFileSync(path.join(directory, SCRIPT), `#!/bin/bash\n${content}\n`);
  }

  /**
   * Run the real guard against proposed text, without executing that text.
   * @param command - Proposed shell source.
   * @returns Native classifier process result.
   */
  function inspect(command: string) {
    return boundedSpawnSync({
      command: "/bin/bash",
      args: [HOOK],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      label: "inspect reached AND branch directory",
    });
  }

  it.each([
    "cd ROOT && cd DECOY && bash run.sh",
    "cd ROOT && cd DECOY && echo ready && bash run.sh",
    'cd "$SOMEWHERE" && cd DECOY && bash run.sh',
  ])("inspects the reached successful branch in %s", command => {
    emit(decoy, DANGEROUS);
    const result = inspect(
      command.replaceAll("ROOT", root).replaceAll("DECOY", decoy)
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(decoy, SCRIPT));
    expect(result.stderr).not.toContain(UNCLASSIFIABLE);
  });

  it.each([
    "cd ROOT && cd DECOY && bash run.sh",
    "cd ROOT && cd DECOY && echo ready && bash run.sh",
    'cd "$SOMEWHERE" && cd DECOY && bash run.sh',
  ])("allows the safe reached branch in %s", command => {
    emit(root, DANGEROUS);
    const result = inspect(
      command.replaceAll("ROOT", root).replaceAll("DECOY", decoy)
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    "false && cd DECOY; bash run.sh",
    "false && cd DECOY && echo ready; bash run.sh",
    "cd ROOT || cd DECOY && echo ready && bash run.sh",
    "false && cd DECOY; (echo ready); bash run.sh",
  ])("preserves unresolved continuation paths in %s", command => {
    emit(root, DANGEROUS);
    const result = inspect(
      command.replaceAll("ROOT", root).replaceAll("DECOY", decoy)
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(UNCLASSIFIABLE);
  });

  it.each([
    "cd DECOY && cd nested & wait; bash run.sh",
    "(cd DECOY && cd nested); echo ready && bash run.sh",
    "echo $(cd DECOY && cd nested); echo ready && bash run.sh",
  ])("restores the actual parent across %s", command => {
    emit(root, DANGEROUS);
    const result = inspect(command.replaceAll("DECOY", decoy));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(path.join(root, SCRIPT));
    expect(result.stderr).not.toContain(UNCLASSIFIABLE);
  });

  it("recovers an unresolved continuation with an unconditional absolute cd", () => {
    emit(root, DANGEROUS);
    const result = inspect(
      `false && cd ${nested}; cd ${decoy}; bash ${SCRIPT}`
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
