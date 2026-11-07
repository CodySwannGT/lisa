/** Real reduced-core apply, separately from the normal package-update journey. */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONTROL, TARGET, ok, run, sha } from "./probes.mjs";

const [pkg, projectDir] = process.argv.slice(2);
assert.equal(process.platform, "linux");
assert.ok(existsSync("/.dockerenv"));
const { Lisa } = await import(
  pathToFileURL(path.join(pkg, "dist/core/lisa.js")).href
);
const { createDependencies } = await import(
  pathToFileURL(path.join(pkg, "dist/cli/shared-options.js")).href
);
const { ConsoleLogger } = await import(
  pathToFileURL(path.join(pkg, "dist/logging/index.js")).href
);
const proof = { root: projectDir, commands: [] };
const hooks = path.join(projectDir, "scripts/lisa-hooks");
const CANONICAL = "parity-safety-net.sh";
const CONTROL_HANDLER = "block-no-verify.sh";
const invoke = (name, command, agy = false) =>
  run(proof, "/bin/bash", [path.join(hooks, name)], {
    input: JSON.stringify(
      agy
        ? { toolCall: { name: "run_command", args: { CommandLine: command } } }
        : { tool_name: "Bash", tool_input: { command } }
    ),
  });
const config = {
  lisaDir: pkg,
  destDir: projectDir,
  dryRun: false,
  yesMode: true,
  validateOnly: false,
  skipGitCheck: false,
  postinstall: true,
  harness: "fleet",
};
const packageHash = sha(readFileSync(path.join(projectDir, "package.json")));
const controlHash = sha(readFileSync(path.join(hooks, CONTROL_HANDLER)));
assert.equal(invoke(CANONICAL, TARGET).status, 2);
assert.equal(
  JSON.parse(invoke("parity-safety-net.agy.sh", TARGET, true).stdout).decision,
  "deny"
);
assert.equal(invoke(CONTROL_HANDLER, CONTROL).status, 2);
for (const args of [
  ["init", "--initial-branch=main"],
  ["config", "user.name", "Lisa verification"],
  ["config", "user.email", "verification@example.invalid"],
  ["add", "--all"],
  ["commit", "-m", "Initialize reduced-core fixture"],
])
  ok(proof, "git", args);
const lisa = new Lisa(
  config,
  createDependencies(false, true, new ConsoleLogger())
);
const result = await lisa.apply();
assert.equal(result.success, true, JSON.stringify(result));
assert.equal(invoke(CANONICAL, TARGET).status, 0);
assert.equal(
  JSON.parse(invoke("parity-safety-net.agy.sh", TARGET, true).stdout).decision,
  "allow"
);
assert.equal(invoke(CONTROL_HANDLER, CONTROL).status, 2);
assert.equal(sha(readFileSync(path.join(hooks, CONTROL_HANDLER))), controlHash);
assert.equal(
  sha(readFileSync(path.join(projectDir, "package.json"))),
  packageHash
);
for (const entry of [
  ".opencode/plugin/lisa-parity-safety-net.ts",
  ".codex/hooks.json",
  ".devin/hooks.v1.json",
  ".lisa/apply-receipt.json",
])
  assert.equal(existsSync(path.join(projectDir, entry)), false, entry);
console.log(
  JSON.stringify({
    phase: "real-reduced-core-apply",
    outcome: "PASS",
    apply_mode: "postinstall-safe",
    target: "allowed",
    unrelated: "refused",
    package_preserved: true,
    no_agent_emit_or_counterfeit_receipt: true,
    commands: proof.commands,
  })
);
