/** Actual delivered registration/handler probes. Proposed commands are data. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TARGET = "rm -rf /";
export const CONTROL = "git commit --no-verify -m x";
export const ORDINARY = "git status --short";
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const load = file => JSON.parse(readFileSync(file, "utf8"));

/** Run a bounded actual process and retain its full result. */
export function run(proof, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: proof.root,
    encoding: "utf8",
    timeout: 15 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  const row = {
    command,
    args,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  proof.commands.push(row);
  assert.equal(result.error, undefined, JSON.stringify(row));
  assert.equal(result.signal, null, JSON.stringify(row));
  return row;
}

/** Require process success, without interpreting it as a native session. */
export function ok(proof, command, args, options = {}) {
  const result = run(proof, command, args, options);
  assert.equal(result.status, 0, JSON.stringify(result));
  return result;
}

/** Enumerate real command registrations rather than reconstructing commands. */
export function commands(value, needle, trail = []) {
  if (Array.isArray(value))
    return value.flatMap((entry, index) =>
      commands(entry, needle, [...trail, index])
    );
  if (value && typeof value === "object") {
    const own =
      typeof value.command === "string" && value.command.includes(needle)
        ? [{ path: trail, registration: value, command: value.command }]
        : [];
    return [
      ...own,
      ...Object.entries(value)
        .filter(([key]) => key !== "command")
        .flatMap(([key, entry]) => commands(entry, needle, [...trail, key])),
    ];
  }
  return [];
}

/** Each runtime receives its actual native tool-input envelope. */
function envelope(agent, command) {
  return JSON.stringify(
    agent === "agy"
      ? { toolCall: { name: "run_command", args: { CommandLine: command } } }
      : {
          tool_name: agent === "devin" ? "exec" : "Bash",
          tool_input: { command },
        }
  );
}

/** Execute the trusted registered hook command, never the proposed tool text. */
function invoke(proof, agent, registration, pluginRoot, proposal) {
  return run(proof, "/bin/bash", ["-c", registration.command], {
    input: envelope(agent, proposal),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: proof.root,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      PLUGIN_ROOT: pluginRoot,
      CURSOR_PLUGIN_ROOT: pluginRoot,
    },
  });
}

/** Assert target transition and an unrelated real refusal on one plugin port. */
export function pluginProbe(
  proof,
  agent,
  manifest,
  pluginRoot,
  retired,
  scope
) {
  const data = load(manifest);
  const target = commands(
    data,
    agent === "agy" ? "parity-safety-net.agy.sh" : "parity-safety-net.sh"
  );
  const control = commands(
    data,
    agent === "agy" ? "block-no-verify.agy.sh" : "block-no-verify.sh"
  );
  assert.equal(target.length, 1, `${agent} target registration`);
  assert.equal(control.length, 1, `${agent} control registration`);
  const result = invoke(proof, agent, target[0], pluginRoot, TARGET);
  const unrelated = invoke(proof, agent, control[0], pluginRoot, CONTROL);
  const ordinary = invoke(proof, agent, target[0], pluginRoot, ORDINARY);
  if (agent === "agy") {
    assert.equal(result.status, 0);
    assert.equal(
      JSON.parse(result.stdout).decision,
      retired ? "allow" : "deny"
    );
    assert.equal(unrelated.status, 0);
    assert.equal(JSON.parse(unrelated.stdout).decision, "deny");
    assert.match(JSON.parse(unrelated.stdout).reason, /no.verify/i);
    assert.equal(JSON.parse(ordinary.stdout).decision, "allow");
  } else {
    assert.equal(result.status, retired ? 0 : 2, JSON.stringify(result));
    if (!retired)
      assert.match(result.stderr, /safety.net|recursive forced delete/i);
    assert.equal(unrelated.status, 2);
    assert.match(unrelated.stderr, /no.verify/i);
    assert.equal(ordinary.status, 0);
  }
  return {
    agent,
    scope,
    manifest,
    target: target[0],
    control: control[0],
    result,
    unrelated,
    ordinary,
    retirement_assertion_passes: retired,
  };
}

/** Invoke real full-apply OpenCode modules under their Bun runtime. */
export function openCodeProbe(proof, retired) {
  const dir = path.join(proof.root, ".opencode/plugin");
  const invokeModule = (name, factory, proposal) =>
    ok(proof, "bun", [
      "/proof/invoke-opencode.mjs",
      pathToFileURL(path.join(dir, name)).href,
      factory,
      proposal,
    ]);
  const result = invokeModule(
    "lisa-parity-safety-net.ts",
    "LisaParitySafetyNet",
    TARGET
  );
  const unrelated = invokeModule(
    "lisa-block-no-verify.ts",
    "LisaBlockNoVerify",
    CONTROL
  );
  const ordinary = invokeModule(
    "lisa-parity-safety-net.ts",
    "LisaParitySafetyNet",
    ORDINARY
  );
  assert.equal(JSON.parse(result.stdout).decision, retired ? "allow" : "deny");
  assert.equal(JSON.parse(unrelated.stdout).decision, "deny");
  assert.match(JSON.parse(unrelated.stdout).reason, /no.verify/i);
  assert.equal(JSON.parse(ordinary.stdout).decision, "allow");
  return {
    agent: "opencode",
    scope: "actual emitted modules",
    result,
    unrelated,
    ordinary,
    retirement_assertion_passes: retired,
  };
}

/** Select each actual repository group matching its native shell tool. */
export function repositoryProbe(proof, agent, file, retired) {
  const data = load(file);
  const matches = commands(data, "lisa-enforcement-fallback.sh").filter(row => {
    const group = row.path
      .slice(0, -2)
      .reduce((value, key) => value[key], data);
    return (
      typeof group.matcher === "string" &&
      new RegExp(group.matcher).test(agent === "devin" ? "exec" : "Bash")
    );
  });
  assert.equal(matches.length, 1);
  const results = [TARGET, CONTROL, ORDINARY].map(proposal =>
    invoke(proof, agent, matches[0], "", proposal)
  );
  assert.deepEqual(
    results.map(row => row.status),
    [retired ? 0 : 2, 2, 0]
  );
  assert.match(results[1].stderr, /no.verify/i);
  return { agent, file, registration: matches[0], results };
}
