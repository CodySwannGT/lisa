#!/usr/bin/env node
/**
 * @file rails-prepush-hook.mjs
 * @description Execute the shipped Rails shell command and optional native Lefthook boundary.
 * @module history-secrets-fixtures
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load } from "js-yaml";

const args = process.argv.slice(2);
const nativeRequested = args.includes("--lefthook");
const option = name => args[args.indexOf(name) + 1];
const selected = option("--case");
if (!["healthy", "returned", "throw", "missing", "scanner"].includes(selected))
  throw new Error("Select a supported Rails hook control.");
const root = resolve(import.meta.dirname, "../../..");
const cwd = mkdtempSync(join(tmpdir(), "lisa-rails-hook-"));
const missingSelected = selected === "missing";
const traceInput = join(cwd, "trace-input");
const traceArgs = join(cwd, "trace-args");
const captures = [];
const value = randomBytes(32).toString("hex");
const execute = (command, argv, options = {}) => {
  const result = spawnSync(command, argv, {
    cwd,
    ...options,
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.error || result.signal)
    throw new Error("Rails hook control did not complete.");
  captures.push({
    command,
    argv,
    input: options.input ?? "",
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return result;
};
try {
  const yaml = readFileSync(
    join(root, "rails/copy-overwrite/lefthook.yml"),
    "utf8"
  );
  writeFileSync(join(cwd, "lefthook.yml"), yaml, { mode: 0o600 });
  const commands = load(yaml)["pre-push"].commands;
  // Reach the original defective command during RED, so failure demonstrates behavior.
  const name = commands["rails-prepush"] ? "rails-prepush" : "work-item";
  mkdirSync(join(cwd, "scripts"), { mode: 0o700 });
  const trace =
    "import{readFileSync,writeFileSync}from'node:fs';writeFileSync('trace-input',readFileSync(0),{mode:0o600});writeFileSync('trace-args',JSON.stringify(process.argv.slice(2)),{mode:0o600});";
  if (selected === "scanner") {
    cpSync(join(root, "all/copy-overwrite/scripts"), join(cwd, "scripts"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, ".lisa.config.json"),
      JSON.stringify({
        gates: {
          "introduced-history-credential-leakage": { push: "required" },
        },
      }),
      { mode: 0o600 }
    );
    writeFileSync(join(cwd, "scripts/lisa-work-item.mjs"), trace, {
      mode: 0o600,
    });
  } else if (!missingSelected) {
    const result =
      selected === "throw"
        ? `throw new Error(${JSON.stringify(value)});`
        : `return ${selected === "returned" ? 7 : 0};`;
    writeFileSync(
      join(cwd, "scripts/lisa-rails-prepush.mjs"),
      `import{readFileSync,writeFileSync}from'node:fs';export const main=async(args)=>{writeFileSync('trace-input',readFileSync(0),{mode:0o600});writeFileSync('trace-args',JSON.stringify(args),{mode:0o600});${result}};`,
      { mode: 0o600 }
    );
  }
  execute("git", ["-c", "core.hooksPath=/dev/null", "init", "-q"]);
  const commit = content => {
    writeFileSync(join(cwd, "clean.txt"), content, { mode: 0o600 });
    execute("git", ["add", "clean.txt"]);
    execute("git", [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture change",
    ]);
    return execute("git", ["rev-parse", "HEAD"]).stdout.trim();
  };
  const before = commit("clean baseline\n");
  const after = commit("clean introduced change\n");
  const input = `refs/heads/fixture ${after} refs/heads/fixture ${before}\n`;
  const scannerEnvironment = () => {
    const tools = join(cwd, "tools");
    mkdirSync(tools, { mode: 0o700 });
    symlinkSync(process.execPath, join(tools, "node"));
    for (const tool of ["git", "bash", "sh"])
      symlinkSync(execute("which", [tool]).stdout.trim(), join(tools, tool));
    // Real managed scanner must refuse an unavailable required vendor, offline.
    return { PATH: tools };
  };
  const options = {
    input,
    env: selected === "scanner" ? scannerEnvironment() : undefined,
  };
  const shell = execute(
    "bash",
    ["-c", commands[name].run.replace("{1}", "origin")],
    options
  );
  const preserved = () =>
    missingSelected ||
    (readFileSync(traceInput, "utf8") === input &&
      readFileSync(traceArgs, "utf8") ===
        JSON.stringify(
          selected === "scanner" ? ["validate-push", "origin"] : ["origin"]
        ));
  if (!preserved())
    throw new Error("Rails shell command lost Git stdin or remote arguments.");
  const nativeTracesCleared = nativeRequested && !missingSelected;
  if (nativeTracesCleared) {
    // Native forwarding must create fresh evidence, not reuse the shell trace.
    rmSync(traceInput);
    rmSync(traceArgs);
  }
  const native = nativeRequested
    ? execute(
        resolve(option("--lefthook")),
        [
          "run",
          "pre-push",
          "origin",
          "--command",
          name,
          "--no-auto-install",
          "--no-tty",
          "--colors",
          "off",
        ],
        options
      )
    : null;
  if (native) {
    if (
      native.status !== (shell.status === 0 ? 0 : 1) ||
      !native.stdout.includes(`${name} ❯`)
    )
      throw new Error(
        "Native Lefthook did not execute the selected shipped command."
      );
    if (
      shell.stderr &&
      !(native.stdout + native.stderr).includes(shell.stderr.trim())
    )
      throw new Error(
        "Native Lefthook did not preserve the shipped refusal explanation."
      );
    if (!preserved())
      throw new Error("Native Lefthook lost Git stdin or remote arguments.");
  }
  if (
    captures.some(capture => (capture.stdout + capture.stderr).includes(value))
  )
    throw new Error("Rails hook disclosed a raw bootstrap error.");
  const report = {
    selected,
    name,
    commandCount: Object.keys(commands).filter(key =>
      ["rails-prepush", "work-item"].includes(key)
    ).length,
    stdinAndRemotePreserved: !missingSelected,
    nativeForwarding:
      nativeTracesCleared && native
        ? {
            previousTracesRemoved: true,
            input: readFileSync(traceInput, "utf8"),
            args: JSON.parse(readFileSync(traceArgs, "utf8")),
          }
        : null,
    redaction: true,
    shell: { status: shell.status, stdout: shell.stdout, stderr: shell.stderr },
    native: native && {
      status: native.status,
      stdout: native.stdout,
      stderr: native.stderr,
    },
  };
  if (args.includes("--proof-dir")) {
    const proof = resolve(option("--proof-dir"));
    if (proof === root || proof.startsWith(`${root}/`))
      throw new Error("Proof must remain outside the source root.");
    mkdirSync(proof, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(proof, `${selected}.json`),
      JSON.stringify(
        { ...report, captured_at: new Date().toISOString(), captures },
        null,
        2
      ),
      { mode: 0o600 }
    );
  }
  console.log(JSON.stringify(report));
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
