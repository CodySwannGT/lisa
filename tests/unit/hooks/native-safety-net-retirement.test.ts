/** Retired native registrations remain callable without classifying tool input. */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots = [
  "plugins/src/base/hooks",
  "plugins/lisa/hooks",
  "plugins/lisa-cursor/hooks",
  "plugins/lisa-agy/hooks",
  "plugins/lisa-copilot/hooks",
  "plugins/lisa-devin/hooks",
  "all/copy-overwrite/scripts/lisa-hooks",
];
const proposed = "rm -rf /";

describe("native safety-net retirement", () => {
  it.each(roots)("keeps %s harmless for stale registrations", root => {
    const result = boundedSpawnSync({
      label: "retired safety-net compatibility entry",
      command: "/bin/bash",
      args: [path.resolve(root, "parity-safety-net.sh")],
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: proposed },
      }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  it("keeps the unrelated no-verify guard active", () => {
    const result = boundedSpawnSync({
      label: "unrelated guard negative control",
      command: "/bin/bash",
      args: [path.resolve("plugins/lisa/hooks/block-no-verify.sh")],
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "git commit --no-verify -m x" },
      }),
    });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("--no-verify");
  });

  it("drains large hook input even when external interpreters are absent", () => {
    const result = boundedSpawnSync({
      label: "large retired-hook input",
      command: "/bin/bash",
      args: [path.resolve("plugins/src/base/hooks/parity-safety-net.sh")],
      input: JSON.stringify({ command: "content".repeat(32_768) }),
      env: { PATH: "/nonexistent" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
