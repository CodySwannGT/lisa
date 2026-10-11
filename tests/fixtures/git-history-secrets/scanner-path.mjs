#!/usr/bin/env node
/**
 * @file scanner-path.mjs
 * @description Genuine emitted CLI witnesses for qualified PATH discovery.
 * @module history-secrets-fixtures
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { createHarness } from "./harness.mjs";
import { emitArtifacts } from "./package.mjs";

const args = process.argv.slice(2);
const h = createHarness(args);
const selected = args.includes("--case") ? h.option("--case") : "all";
const observations = [];
const hash = path =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
try {
  h.requireFact(
    ["all", "success", "refusal", "usability"].includes(selected),
    "Unknown scanner PATH control selector."
  );
  emitArtifacts(h);
  const fixture = h.initialize("scanner-path");
  const clean = h.commit(fixture.cwd, "ordinary.txt", "ordinary change\n");
  const finding = h.commit(fixture.cwd, "credential.txt", h.secret());
  const executable = h.scanner;
  const officialDigest = hash(executable);
  const tools = join(h.scratch, "tools");
  mkdirSync(tools, { mode: 0o700 });
  const actualGit = h.command("which", ["git"], fixture.cwd);
  h.requireFact(actualGit.status === 0, "Native Git discovery failed.");
  symlinkSync(actualGit.stdout.trim(), join(tools, "git"));
  const directory = name => {
    const path = join(h.scratch, name);
    mkdirSync(path, { mode: 0o700 });
    return path;
  };
  const qualified = directory("official");
  symlinkSync(executable, join(qualified, "gitleaks"));
  const poison = directory("unqualified");
  const marker = join(h.scratch, "unqualified-was-executed");
  const bad = join(poison, "gitleaks");
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    bad,
    `#!/bin/sh\nprintf invoked > ${quote(marker)}\nprintf '8.30.1\\n'\n`,
    { mode: 0o700 }
  );
  const scan = (name, directories, expected, head = clean, override = null) => {
    const input = `refs/heads/fixture ${head} refs/heads/fixture ${fixture.base}\n`;
    const result = h.command(
      "env",
      [
        `PATH=${[...directories, tools].join(delimiter)}`,
        process.execPath,
        join(h.emitted, h.SCANNER_ENTRY),
        "pre-push",
        ...(override === null ? [] : ["--scanner", override]),
      ],
      fixture.cwd,
      input
    );
    h.requireFact(
      result.status === expected,
      `${name}: unexpected native exit.`
    );
    h.requireFact(
      !existsSync(marker),
      `${name}: unqualified binary was executed.`
    );
    h.requireFact(
      h.values.every(
        value => !`${result.stdout}${result.stderr}`.includes(value)
      ),
      `${name}: matched value was disclosed.`
    );
    if (expected === 42)
      h.requireFact(
        result.stdout.includes("generic-api-key") &&
          result.stdout.includes('"version":"8.30.1"'),
        `${name}: genuine scanner attribution missing.`
      );
    if (expected === 0)
      h.requireFact(
        result.stdout.includes('"version":"8.30.1"') && result.stderr === "",
        `${name}: genuine clean scanner report missing.`
      );
    if (expected === 1)
      h.requireFact(
        result.stderr.includes("provision") && result.stdout === "",
        `${name}: actionable scanner refusal missing.`
      );
    observations.push({
      name,
      exit: result.status,
      unqualifiedNotExecuted: true,
    });
    return result;
  };
  if (["all", "success"].includes(selected)) {
    scan("official-only-clean", [qualified], 0);
    scan("unqualified-first-official-later-clean", [poison, qualified], 0);
    scan(
      "unqualified-first-official-later-finding",
      [poison, qualified],
      42,
      finding
    );
    const later = directory("later-unqualified");
    symlinkSync(bad, join(later, "gitleaks"));
    scan("official-first-poison-later", [qualified, later], 0);
    const secondQualified = directory("second-official");
    symlinkSync(executable, join(secondQualified, "gitleaks"));
    const selection = h.command(
      "env",
      [
        `PATH=${[qualified, secondQualified, later, tools].join(delimiter)}`,
        process.execPath,
        "--input-type=module",
        "-e",
        `import {pathToFileURL} from 'node:url';
const {qualifyScanner}=await import(pathToFileURL(process.argv[1]));
console.log(qualifyScanner());`,
        join(h.emitted, "scripts/lib/history-secret-scanner.mjs"),
      ],
      fixture.cwd
    );
    h.requireFact(
      selection.status === 0 &&
        selection.stdout.trim() === join(qualified, "gitleaks") &&
        !existsSync(marker),
      "First qualified PATH ordering was not preserved."
    );
  }
  if (["all", "refusal"].includes(selected)) {
    for (const [name, paths, override] of [
      ["only-unqualified", [poison], null],
      ["explicit-unqualified-no-fallback", [qualified], bad],
    ]) {
      const result = scan(name, paths, 1, clean, override);
      h.requireFact(
        result.stderr.includes(bad) &&
          result.stderr.includes(officialDigest) &&
          result.stderr.includes(hash(bad)) &&
          /checksum mismatch/i.test(result.stderr) &&
          /version (?:was )?not checked/i.test(result.stderr),
        `${name}: checksum-specific digest diagnosis missing.`
      );
      h.requireFact(
        !result.stderr.includes("checksum/version mismatch"),
        `${name}: ambiguous mismatch diagnosis remained.`
      );
    }
    scan(
      "missing-explicit-no-fallback",
      [qualified],
      1,
      clean,
      join(h.scratch, "absent")
    );
    scan("no-scanner-on-path", [], 1);
  }
  if (["all", "usability"].includes(selected)) {
    const missing = join(h.scratch, "missing-directory");
    const nonregular = directory("nonregular");
    mkdirSync(join(nonregular, "gitleaks"), { mode: 0o700 });
    const nonexecutable = directory("nonexecutable");
    cpSync(executable, join(nonexecutable, "gitleaks"));
    chmodSync(join(nonexecutable, "gitleaks"), 0o600);
    const unreadable = directory("unreadable");
    cpSync(executable, join(unreadable, "gitleaks"));
    chmodSync(join(unreadable, "gitleaks"), 0o100);
    const broken = directory("broken-symlink");
    symlinkSync(join(h.scratch, "absent-target"), join(broken, "gitleaks"));
    for (const [name, first] of [
      ["missing-candidate", missing],
      ["directory-candidate", nonregular],
      ["nonexecutable-candidate", nonexecutable],
      ["unreadable-candidate", unreadable],
      ["broken-symlink-candidate", broken],
    ])
      scan(name, [first, qualified], 0);
    for (const [name, first] of [
      ["explicit-directory", nonregular],
      ["explicit-nonexecutable", nonexecutable],
      ["explicit-unreadable", unreadable],
      ["explicit-broken-symlink", broken],
    ])
      scan(name, [qualified], 1, clean, join(first, "gitleaks"));
    h.write(
      fixture.cwd,
      ".gitleaksignore",
      `${finding}:credential.txt:generic-api-key:1\n`
    );
    h.write(fixture.cwd, ".gitleaks.toml", "[allowlist]\nregexes=['.*']\n");
    scan(
      "qualified-path-caller-ignore-still-blocks",
      [poison, qualified],
      42,
      finding
    );
  }
  console.log(
    JSON.stringify({
      scannerVersion: "8.30.1",
      scannerSha256: officialDigest,
      emittedSourceSha256: hash(
        join(h.emitted, "scripts/lib/history-secret-scanner.mjs")
      ),
      observations,
      redaction: true,
      cleanup: "owned scratch removed on exit",
    })
  );
} catch (error) {
  // Fixed fixture messages contain no native report or matched value.
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(h.scratch, { recursive: true, force: true });
}
