#!/usr/bin/env node
/**
 * @file harness.mjs
 * @description Actual default-rule scanner witnesses on private disposable Git graphs.
 * @module history-secrets-fixtures
 */
import { randomInt } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keep generated values and captured vendor output inside one private fixture lease.
 * @param args - Supported journey options
 * @returns Owned scratch and bounded fixture operations
 */
export function createHarness(args) {
  const option = name => args[args.indexOf(name) + 1];
  const scanner = args.includes("--scanner")
    ? resolve(option("--scanner"))
    : "gitleaks";
  const archive = args.includes("--package")
    ? resolve(option("--package"))
    : null;
  const upstream = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const proof = args.includes("--proof-dir")
    ? resolve(option("--proof-dir"))
    : null;
  if (proof) {
    if (proof === upstream || proof.startsWith(`${upstream}/`))
      throw new Error(
        "Private fixture proof must remain outside the source root."
      );
    mkdirSync(proof, { mode: 0o700 });
  }
  const scratch = mkdtempSync(join(tmpdir(), "lisa-history-journey-"));

  const values = [];
  const outputs = [];
  const observations = [];
  const command = (binary, argv, cwd, input) => {
    const result = spawnSync(binary, argv, {
      cwd,
      input,
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 32 * 1024 * 1024,
    });
    outputs.push((result.stdout ?? "") + (result.stderr ?? ""));
    if (proof)
      writeFileSync(
        join(proof, `${outputs.length}.json`),
        JSON.stringify({
          binary,
          argv,
          cwd,
          input,
          status: result.status,
          signal: result.signal,
          error: result.error?.code,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
        { mode: 0o600 }
      );
    if (result.error || result.signal)
      throw new Error(
        "Fixture subprocess did not complete; no scanner proof is claimed."
      );
    return result;
  };
  const requireFact = (condition, explanation) => {
    if (!condition) throw new Error(explanation);
  };
  const git = (cwd, ...argv) => {
    const result = command(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...argv],
      cwd
    );
    requireFact(
      result.status === 0,
      "Synthetic Git graph construction failed."
    );
    return result.stdout.trim();
  };
  const write = (cwd, file, content) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true, mode: 0o700 });
    writeFileSync(join(cwd, file), content, { mode: 0o600 });
  };
  const commit = (cwd, file, content, message = "fixture change") => {
    write(cwd, file, content);
    git(cwd, "add", "--", file);
    git(cwd, "commit", "-qm", message);
    return git(cwd, "rev-parse", "HEAD");
  };
  const secret = () => {
    // Random hex bytes can fall below Gitleaks' 3.5-bit entropy floor.
    // Shuffle a balanced alphabet: every fixture remains a random
    // nonce while its measured symbol entropy is always four bits.
    const value = (() => {
      const symbols = "0123456789abcdef".repeat(4).split("");
      symbols.forEach((_, offset) => {
        const index = symbols.length - 1 - offset;
        if (index === 0) return;
        const selected = randomInt(index + 1);
        [symbols[index], symbols[selected]] = [
          symbols[selected],
          symbols[index],
        ];
      });
      return symbols.join("");
    })();
    values.push(value);
    if (proof)
      writeFileSync(
        join(proof, "synthetic-values.json"),
        JSON.stringify(values),
        {
          mode: 0o600,
        }
      );
    return `api_key = "${value}"\n`;
  };
  const initialize = name => {
    const cwd = join(scratch, name);
    mkdirSync(cwd, { mode: 0o700 });
    git(cwd, "init", "-q", "--initial-branch=main");
    git(cwd, "config", "user.name", "Fixture");
    git(cwd, "config", "user.email", "fixture@example.invalid");
    return { cwd, base: commit(cwd, "clean.txt", "clean\n") };
  };
  const emitted = join(scratch, "emitted");
  const SCANNER_ENTRY = "scripts/lisa-history-secrets.mjs";
  const scan = (cwd, name, pairs, expected, remoteArgs = []) => {
    const input = pairs
      .map(
        ({ before, after }) =>
          `refs/heads/fixture ${after} refs/heads/fixture ${before}\n`
      )
      .join("");
    const result = command(
      process.execPath,
      [
        join(emitted, SCANNER_ENTRY),
        "pre-push",
        ...remoteArgs,
        "--scanner",
        scanner,
      ],
      cwd,
      input
    );
    requireFact(
      result.status === expected,
      `${name}: unexpected scanner exit; raw outputs are withheld.`
    );
    if (expected === 42)
      requireFact(
        result.stdout.includes("generic-api-key") &&
          result.stdout.includes('"version":"8.30.1"'),
        `${name}: actual scanner attribution missing.`
      );
    if (expected === 1)
      requireFact(
        /[Rr]epair|[Ff]etch|[Ss]upply|[Pp]rovision|[Uu]se|[Rr]un/.test(
          result.stderr
        ),
        `${name}: actionable fail-closed explanation missing.`
      );
    observations.push({ name, exit: result.status });
    return { result, input };
  };
  chmodSync(scratch, 0o700);
  return {
    SCANNER_ENTRY,
    args,
    option,
    scanner,
    archive,
    proof,
    upstream,
    scratch,
    values,
    outputs,
    observations,
    command,
    requireFact,
    git,
    write,
    commit,
    secret,
    initialize,
    emitted,
    scan,
  };
}
