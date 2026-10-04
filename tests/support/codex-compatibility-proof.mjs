/** Replay the exact loaded commands through explicit full apply. */
import {
  readFile,
  writeFile,
  symlink,
  unlink,
  lstat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  root,
  evidence,
  host,
  scratch,
  candidate,
  candidateIdentity,
  commands,
  run,
  hash,
  sourcePaths,
  sourceHashesBefore,
  output,
  checks,
  check,
  ANONYMOUS_HOST,
  INSTALLED_LISA,
} from "./codex-compatibility-state.mjs";
import { seedCompatibilityHost } from "./codex-compatibility-seed.mjs";
try {
  await seedCompatibilityHost();
  const before = commands
    .filter(c => c.event !== "SessionStart")
    .map(c => ({ ...c, ...run("bash", ["-c", c.command], "{}\n") }));
  const applyArgs = [
    path.join(candidate, "dist/index.js"),
    "--no-update-check",
    "apply",
    host,
    "--yes",
    "--skip-git-check",
    "--refresh-templates",
    "--harness",
    "codex",
  ];
  const apply = run("node", applyArgs);
  await writeFile(
    path.join(evidence, "green-apply.txt"),
    apply.stdout + apply.stderr
  );
  check(
    "normal explicit full apply including refresh succeeds",
    apply.status === 0,
    { status: apply.status }
  );
  const after = commands
    .filter(c => c.event !== "SessionStart")
    .map(c => ({ ...c, ...run("bash", ["-c", c.command], "{}\n") }));
  check(
    "all four exact saved Pre/Post commands remain executable",
    before.every(c => c.status === 0) &&
      after.length === 4 &&
      after.every(c => c.status === 0),
    after
  );
  const runHook = (id, payload) =>
    run(
      "bash",
      ["-c", commands.find(c => c.id === id).command],
      JSON.stringify(payload)
    );
  const deny = runHook("block-no-verify", {
    tool_name: "Bash",
    tool_input: { command: "git commit --no-verify -m forbidden" },
  });
  check(
    "legacy policy executes real native deny",
    deny.status === 0 &&
      JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision === "deny",
    deny
  );
  const nudge = runHook("shell-write-nudge", {
    tool_name: "Bash",
    tool_input: { command: "printf changed > sample.rb" },
  });
  check(
    "legacy shell-write notice recognizes tracked writes",
    nudge.status === 0 && nudge.stderr.includes("prefer Edit/Write"),
    nudge
  );
  await output(
    "node_modules/.bin/ast-grep",
    '#!/bin/sh\nprintf "%s\\n" "$*" >> scanner.log\nexit 9\n',
    0o755
  );
  await output(
    "bin/bundle",
    '#!/bin/sh\nprintf "%s\\n" "$*" >> linter.log\nexit 7\n',
    0o755
  );
  const env = {
    PATH: path.join(host, "bin") + path.delimiter + process.env.PATH,
  };
  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: "sample.rb" },
  });
  const scanner = run(
    "bash",
    ["-c", commands.find(c => c.id === "sg-scan-on-edit").command],
    payload,
    env
  );
  const linter = run(
    "bash",
    ["-c", commands.find(c => c.id === "rubocop-on-edit").command],
    payload,
    env
  );
  const scannerLog = await readFile(
    path.join(host, "scanner.log"),
    "utf8"
  ).catch(() => "NOT INVOKED");
  const linterLog = await readFile(path.join(host, "linter.log"), "utf8").catch(
    () => "NOT INVOKED"
  );
  await writeFile(
    path.join(evidence, "green-operation-debug.json"),
    JSON.stringify({ scanner, linter, scannerLog, linterLog }, null, 2)
  );
  check(
    "scanner real dispatch and failure propagation",
    scanner.status === 1 && scannerLog.includes("scan sample.rb"),
    { ...scanner, dispatch: scannerLog }
  );
  check(
    "linter safe correction then check and failure propagation",
    linter.status === 1 &&
      linterLog.includes("exec rubocop -a sample.rb") &&
      linterLog.includes("exec rubocop sample.rb"),
    { ...linter, dispatch: linterLog }
  );
  const injection = runHook("inject-rules", {});
  check(
    "saved SessionStart injects real rules content",
    injection.status === 0 &&
      JSON.parse(injection.stdout).hookSpecificOutput.additionalContext.length >
        0,
    { status: injection.status, context_bytes: injection.stdout.length }
  );
  const hooks = JSON.parse(
    await readFile(path.join(host, ".codex/hooks.json"), "utf8")
  );
  const handlers = Object.values(hooks.hooks).flatMap(groups =>
    groups.flatMap(g => g.hooks)
  );
  const fallback = handlers.filter(h => h._lisaManaged);
  check(
    "fresh configuration uses only current fallback and keeps host handler",
    fallback.length === 1 &&
      fallback[0]._lisaId === "enforcement-fallback" &&
      handlers.some(h => h.command === "printf host-handler-preserved"),
    hooks
  );
  const fallbackDeny = run(
    "bash",
    ["-c", fallback[0].command],
    JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "git commit --no-verify -m forbidden" },
    })
  );
  check(
    "current fallback refuses through real repository guard",
    fallbackDeny.status === 2,
    fallbackDeny
  );
  const manifest = JSON.parse(
    await readFile(path.join(host, ".codex/.lisa-managed.json"), "utf8")
  );
  for (const file of manifest.hookCompatibilityFiles)
    check(
      `regular source-owned copy: ${file}`,
      (await lstat(path.join(host, ".codex", file))).isFile()
    );
  const firstHashes = Object.fromEntries(
    await Promise.all(
      manifest.hookCompatibilityFiles.map(async file => [
        file,
        hash(await readFile(path.join(host, ".codex", file))),
      ])
    )
  );
  await unlink(path.join(host, INSTALLED_LISA));
  const replaced = commands
    .filter(c => c.event !== "SessionStart")
    .map(c => ({ ...c, ...run("bash", ["-c", c.command], "{}\n") }));
  check(
    "copied commands survive actual package unlink",
    replaced.every(c => c.status === 0),
    replaced
  );
  const scannerAfter = run(
    "bash",
    ["-c", commands.find(c => c.id === "sg-scan-on-edit").command],
    payload,
    env
  );
  check(
    "copied helper closure still scans after package unlink",
    scannerAfter.status === 1,
    scannerAfter
  );
  await symlink(candidate, path.join(host, INSTALLED_LISA), "dir");
  const repeat = run("node", applyArgs);
  const second = JSON.parse(
    await readFile(path.join(host, ".codex/.lisa-managed.json"), "utf8")
  );
  const secondHashes = Object.fromEntries(
    await Promise.all(
      second.hookCompatibilityFiles.map(async file => [
        file,
        hash(await readFile(path.join(host, ".codex", file))),
      ])
    )
  );
  check(
    "repeated full apply stable compatibility bytes and paths",
    repeat.status === 0 &&
      JSON.stringify(firstHashes) === JSON.stringify(secondHashes),
    { status: repeat.status, firstHashes, secondHashes }
  );
  check(
    "host-authored script intact",
    (
      await readFile(path.join(host, ".codex/hooks/lisa/host-check.sh"), "utf8")
    ).includes("host-owned")
  );
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async file => [
        file,
        hash(await readFile(path.join(root, file))),
      ])
    )
  );
  check(
    "implementation bytes unchanged during replay",
    JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashes)
  );
  check(
    "original checkout metadata unchanged by private candidate",
    candidateIdentity.originalManifest.equals(
      await readFile(path.join(root, "package.json"))
    )
  );
  const { originalManifest, ...identity } = candidateIdentity;
  const report = {
    captured_at: new Date().toISOString(),
    base_sha: "728d35afbd3de4d522023e0b65fd0f730c94820c",
    host: ANONYMOUS_HOST,
    before,
    apply,
    after,
    repeat,
    checks,
    sourceHashesBefore,
    sourceHashes,
    compatibilityHashes: firstHashes,
    candidateIdentity: identity,
    greenEstablished: checks.every(c => c.passed),
    limitations: [
      "Dispatch spies establish operation/exit contracts. Independent verifier must exercise actual local scanner/linter.",
      "Native fresh-session hook trust/loading requires independent verification.",
      "Private local candidate identity only; public CI/release completion remains pending.",
    ],
  };
  await writeFile(
    path.join(evidence, "green-results.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  await writeFile(
    path.join(evidence, "green-apply.txt"),
    `${apply.stdout + apply.stderr}\nREPEAT\n${repeat.stdout}${repeat.stderr}`
  );
  console.log(
    JSON.stringify({
      greenEstablished: report.greenEstablished,
      candidateIdentity: identity,
      checks: checks.map(({ name, passed, details }) => ({
        name,
        passed,
        ...(!passed ? { details } : {}),
      })),
      ...(!report.greenEstablished ? { apply, repeat } : {}),
    })
  );
  if (!report.greenEstablished) process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
