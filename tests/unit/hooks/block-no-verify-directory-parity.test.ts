/** Run static sibling reach through every shipped agent protocol. */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { scratchDir, script } from "./support/executed-script-reach.js";

const root = scratchDir("directory-agent-parity");
const lib = path.join(root, "lib");
mkdirSync(lib);
script(lib, "safe.sh", ["echo safe"]);
const bypass = script(lib, "bypass.sh", ["git push --no-verify"]);
const bindings = [
  'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
  'SCRIPT_DIR="$(dirname "$0")"',
  'SCRIPT_DIR="${BASH_SOURCE[0]%/*}"',
] as const;
const copies = [
  ["plugins/src/base/hooks/block-no-verify.sh", "exit"],
  ["plugins/lisa/hooks/block-no-verify.sh", "exit"],
  ["plugins/lisa-cursor/hooks/block-no-verify.sh", "exit"],
  ["plugins/lisa-copilot/hooks/block-no-verify.sh", "exit"],
  ["all/copy-overwrite/scripts/lisa-hooks/block-no-verify.sh", "exit"],
  ["plugins/src/base/hooks/block-no-verify.agy.sh", "agy"],
  ["plugins/lisa/hooks/block-no-verify.agy.sh", "agy"],
  ["plugins/lisa-agy/hooks/block-no-verify.agy.sh", "agy"],
  ["src/codex/scripts/block-no-verify.sh", "codex"],
] as const;

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.each(copies)("directory reach through %s", (copy, protocol) => {
  it.each(bindings)("allows an inspected sibling using %s", binding => {
    const entry = script(root, "safe-entry.sh", [
      binding,
      '. "$SCRIPT_DIR/lib/safe.sh"',
    ]);
    const command = `bash "${entry}"`;
    const input =
      protocol === "agy"
        ? { toolCall: { name: "run_command", args: { CommandLine: command } } }
        : { tool_name: "Bash", tool_input: { command } };
    const result = boundedSpawnSync({
      label: copy,
      command: "/bin/bash",
      args: [path.resolve(copy)],
      input: JSON.stringify(input),
    });
    expect(result.status, result.stderr).toBe(0);
    if (protocol === "agy") {
      expect(JSON.parse(result.stdout)).toEqual({ decision: "allow" });
    } else if (protocol === "codex") {
      expect(result.stdout.trim()).toBe("");
    }
  });

  it.each(bindings)("inspects and refuses a sibling using %s", binding => {
    const entry = script(root, "bypass-entry.sh", [
      binding,
      '. "$SCRIPT_DIR/lib/bypass.sh"',
    ]);
    const command = `bash "${entry}"`;
    const input =
      protocol === "agy"
        ? { toolCall: { name: "run_command", args: { CommandLine: command } } }
        : { tool_name: "Bash", tool_input: { command } };
    const result = boundedSpawnSync({
      label: copy,
      command: "/bin/bash",
      args: [path.resolve(copy)],
      input: JSON.stringify(input),
    });
    expect(result.stderr).toContain(bypass);
    expect(result.stderr).not.toContain("a computed path");
    if (protocol === "exit") {
      expect(result.status).toBe(2);
    } else {
      expect(result.status, result.stderr).toBe(0);
      const decision = JSON.parse(result.stdout) as {
        decision?: string;
        hookSpecificOutput?: { permissionDecision: string };
      };
      expect(
        protocol === "agy"
          ? decision.decision
          : decision.hookSpecificOutput?.permissionDecision
      ).toBe("deny");
    }
  });
});
