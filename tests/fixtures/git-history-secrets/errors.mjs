/**
 * @file errors.mjs
 * @description Actual synthetic history journey boundary witnesses.
 * @module history-secrets-fixtures
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vendorErrorCases } from "./vendor-errors.mjs";
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
    for (const [name, event, eventName] of [
      [
        "PR-event",
        { pull_request: { base: { sha: base }, head: { sha: second } } },
        "pull_request",
      ],
      ["push-event", { before: base, after: second }, "push"],
      ["newbranch-event", { before: zero, after: second }, "push"],
      [
        "deletion-event",
        { before: second, after: zero, deleted: true },
        "push",
      ],
      [
        "inconsistent-deletion-event",
        { before: second, after: second, deleted: true },
        "push",
      ],
      ["absent-deletion-ID", { before: second, deleted: true }, "push"],
      [
        "malformed-deletion-ID",
        { before: second, after: values[0], deleted: true },
        "push",
      ],
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
    scan(cwd, "unsupported-blob-ref", [{ before: zero, after: blob }], 1);
    write(cwd, ".gitleaks.toml", "[allowlist]\nregexes=['.*']\n");
    write(
      cwd,
      ".gitleaksignore",
      `${earlier}:credential.txt:generic-api-key:1\n`
    );
    write(
      cwd,
      ".git/.gitleaksignore",
      `${earlier}:credential.txt:generic-api-key:1\n`
    );
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
