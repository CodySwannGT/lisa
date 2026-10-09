/**
 * @file vendor-errors.mjs
 * @description Native vendor, event and transport refusals retain actual attribution.
 * @module history-secrets-fixtures
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fault only the actual vendor Git log after proving real default-rule detection.
 * @param harness - Private disposable fixture operations
 */
export function vendorErrorCases(harness) {
  try {
    const {
      initialize,
      commit,
      secret,
      values,
      scan,
      scratch,
      command,
      requireFact,
      emitted,
      SCANNER_ENTRY,
      scanner,
      observations,
    } = harness;
    const fixture = initialize("vendor-errors");
    const zero = "0".repeat(40);
    scan(
      fixture.cwd,
      "vendor-clean-control",
      [{ before: zero, after: fixture.base }],
      0
    );
    const finding = commit(fixture.cwd, "credential.txt", secret());
    scan(
      fixture.cwd,
      "vendor-default-rule-control",
      [{ before: fixture.base, after: finding }],
      42
    );
    const directory = join(scratch, "vendor-fault");
    mkdirSync(directory, { mode: 0o700 });
    const valueFile = join(directory, "value");
    writeFileSync(valueFile, values.at(-1), { mode: 0o600 });
    const realGit = command("which", ["git"], fixture.cwd);
    requireFact(realGit.status === 0, "Actual Git executable is unavailable.");
    const adapter = join(directory, "adapter.mjs");
    writeFileSync(
      adapter,
      `import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "-C" && args[2] === "log") {
  appendFileSync(process.env.LISA_VENDOR_TRACE, "invoked\\n", { mode: 0o600 });
  if (process.env.LISA_VENDOR_MODE === "hostile")
    process.stderr.write(readFileSync(${JSON.stringify(valueFile)}));
  process.exitCode = 1;
} else {
  const result = spawnSync(${JSON.stringify(realGit.stdout.trim())}, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
`,
      { mode: 0o600 }
    );
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    writeFileSync(
      join(directory, "git"),
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(adapter)} "$@"\n`,
      { mode: 0o700 }
    );
    const input = `refs/heads/fixture ${finding} refs/heads/fixture ${fixture.base}\n`;
    for (const mode of ["hostile", "silent"]) {
      const trace = join(directory, `${mode}.trace`);
      writeFileSync(trace, "", { mode: 0o600 });
      const program = `import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ${JSON.stringify([join(emitted, SCANNER_ENTRY), "pre-push", "--scanner", scanner])}, {
  input: ${JSON.stringify(input)}, encoding: "utf8", timeout: 150000,
  env: { ...process.env, PATH: ${JSON.stringify(directory)} + ":" + process.env.PATH,
    LISA_VENDOR_TRACE: ${JSON.stringify(trace)}, LISA_VENDOR_MODE: ${JSON.stringify(mode)} }
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;`;
      const result = command(
        process.execPath,
        ["--input-type=module", "-e", program],
        fixture.cwd
      );
      requireFact(
        result.status === 1,
        "Actual vendor child failure became a clean result."
      );
      requireFact(
        readFileSync(trace, "utf8") === "invoked\n",
        "Actual scanner Git log was not exercised."
      );
      requireFact(
        result.stderr.includes("Repair"),
        "Vendor failure lacks actionable remediation."
      );
      requireFact(
        !`${result.stdout}${result.stderr}`.includes(values.at(-1)),
        "Vendor failure output was not redacted."
      );
      observations.push({
        name: `actual-vendor-${mode}-git-failure`,
        exit: result.status,
      });
    }
  } catch {
    throw new Error(
      "Actual vendor error fixture failed; private synthetic diagnostics are withheld."
    );
  }
}

export const errorCases = (harness, fixture) => {
  const {
    SCANNER_ENTRY,
    scanner,
    scratch,
    values,
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
  } = harness;
  try {
    vendorErrorCases(harness);
    const { zero, cwd, base, earlier, second, multi } = fixture;
    const deletion = { before: second, deleted: true };
    const endpoints = { base: { sha: base }, head: { sha: second } };
    for (const [name, event, eventName] of [
      ["PR-event", { pull_request: endpoints }, "pull_request"],
      ["push-event", { before: base, after: second }, "push"],
      ["newbranch-event", { before: zero, after: second }, "push"],
      ["deletion-event", { ...deletion, after: zero }, "push"],
      ["inconsistent-deletion-event", { ...deletion, after: second }, "push"],
      ["absent-deletion-ID", deletion, "push"],
      ["malformed-deletion-ID", { ...deletion, after: values[0] }, "push"],
    ]) {
      const eventFile = join(scratch, `${name}.json`);
      writeFileSync(eventFile, JSON.stringify(event), { mode: 0o600 });
      const result = command(
        process.execPath,
        [
          join(emitted, SCANNER_ENTRY),
          "ci",
          "--event",
          eventFile,
          "--event-name",
          eventName,
          "--scanner",
          scanner,
        ],
        cwd
      );
      requireFact(
        result.status === (event.deleted ? (event.after === zero ? 0 : 1) : 42),
        `${name}: actual event range failed.`
      );
      observations.push({ name, exit: result.status });
    }
    for (const [name, input] of [
      ["malformed-stream", "bad input\n"],
      ["malformed-ID", `refs/heads/a bad refs/heads/a ${base}\n`],
      [
        "missing-object",
        `refs/heads/a ${"a".repeat(40)} refs/heads/a ${base}\n`,
      ],
    ]) {
      const result = command(
        process.execPath,
        [join(emitted, SCANNER_ENTRY), "pre-push", "--scanner", scanner],
        cwd,
        input
      );
      requireFact(
        result.status === 1,
        `${name}: history was not failed closed.`
      );
      observations.push({ name, exit: result.status });
    }
    for (const [name, binary] of [
      ["missing-scanner", join(scratch, "unavailable")],
      ["broken-scanner", process.execPath],
    ]) {
      const result = command(
        process.execPath,
        [join(emitted, SCANNER_ENTRY), "pre-push", "--scanner", binary],
        cwd,
        multi.input
      );
      requireFact(
        result.status === 1,
        `${name}: tooling was not failed closed.`
      );
      observations.push({ name, exit: result.status });
    }
    const blob = git(cwd, "rev-parse", `${base}:clean.txt`);
    const fingerprint = `${earlier}:credential.txt:generic-api-key:1\n`;
    scan(cwd, "unsupported-blob-ref", [{ before: zero, after: blob }], 1);
    write(cwd, ".gitleaks.toml", "[allowlist]\nregexes=['.*']\n");
    write(cwd, ".gitleaksignore", fingerprint);
    write(cwd, ".git/.gitleaksignore", fingerprint);
    scan(
      cwd,
      "caller-config-ignore-cannot-bypass",
      [{ before: zero, after: second }],
      42
    );
    const allow = initialize("allow-comment");
    const allowedSecret = commit(
      allow.cwd,
      "allow.txt",
      `${secret().trimEnd()} # gitleaks:allow\n`
    );
    scan(
      allow.cwd,
      "allow-comment-cannot-bypass",
      [{ before: allow.base, after: allowedSecret }],
      42
    );
    const metadata = initialize("metadata");
    const metadataSource = secret();
    const metadataValue = values.at(-1);
    const metadataCommit = commit(
      metadata.cwd,
      `${metadataValue}.txt`,
      metadataSource,
      metadataValue
    );
    scan(
      metadata.cwd,
      "filename-commit-message-redacted",
      [{ before: metadata.base, after: metadataCommit }],
      42
    );
    for (const kind of ["tree", "blob"]) {
      const missing = initialize(`missing-${kind}`);
      const target = git(
        missing.cwd,
        "rev-parse",
        kind === "tree" ? `${missing.base}^{tree}` : `${missing.base}:clean.txt`
      );
      const path = join(
        missing.cwd,
        ".git/objects",
        target.slice(0, 2),
        target.slice(2)
      );
      renameSync(path, `${path}.retained`);
      scan(
        missing.cwd,
        `missing-${kind}`,
        [{ before: zero, after: missing.base }],
        1
      );
    }
    git(cwd, "tag", "-a", "fixture-tag", "-m", "anonymous tag", second);
    scan(
      cwd,
      "annotated-tag-peeling",
      [{ before: zero, after: git(cwd, "rev-parse", "fixture-tag") }],
      42
    );
    const sha = join(scratch, "sha256");
    mkdirSync(sha, { mode: 0o700 });
    git(sha, "init", "-q", "--object-format=sha256");
    git(sha, "config", "user.name", "Fixture");
    git(sha, "config", "user.email", "fixture@example.invalid");
    const shaCommit = commit(sha, "sha.txt", secret());
    scan(
      sha,
      "sha256-root-detection",
      [{ before: "0".repeat(64), after: shaCommit }],
      42
    );
    const shallow = join(scratch, "shallow");
    const clone = command(
      "git",
      ["clone", "--depth", "1", `file://${cwd}`, shallow],
      scratch
    );
    requireFact(clone.status === 0, "Shallow fixture construction failed.");
    scan(
      shallow,
      "shallow-fail-closed",
      [{ before: zero, after: git(shallow, "rev-parse", "HEAD") }],
      1
    );
  } catch {
    throw new Error(
      "errors.mjs: actual fixture boundary failed; raw vendor metadata is withheld."
    );
  }
};
