/**
 * @file native-push.mjs
 * @description Real disposable bare pushes qualify Git's actual source labels and hook environment.
 * @module history-secrets-fixtures
 */
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
export const nativePushCases = harness => {
  const {
    initialize,
    scratch,
    git,
    command,
    write,
    commit,
    secret,
    emitted,
    scanner,
    SCANNER_ENTRY,
    requireFact,
    observations,
  } = harness;
  try {
    const { cwd, base } = initialize("native-push");
    const remote = join(scratch, "disposable-remote.git");
    git(scratch, "init", "--bare", "-q", remote);
    const head = commit(cwd, "clean.txt", "clean second\n");
    const receipt = join(cwd, "hook-input");
    write(
      cwd,
      ".git/hooks/pre-push",
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const input = readFileSync(0);
writeFileSync(${JSON.stringify(receipt)}, input, { mode: 0o600 });
const result = spawnSync(process.execPath, ${JSON.stringify([join(emitted, SCANNER_ENTRY), "pre-push", "--scanner", scanner])}, { input, stdio: ['pipe', 'inherit', 'inherit'] });
process.exitCode = result.status === 0 ? 0 : 1;
`
    );
    chmodSync(join(cwd, ".git/hooks/pre-push"), 0o700);
    for (const [source, destination] of [
      ["HEAD", "head"],
      ["HEAD~1", "ancestor"],
      [head, "object"],
    ]) {
      const result = command(
        "git",
        ["push", remote, `${source}:refs/heads/${destination}`],
        cwd
      );
      if (harness.proof)
        write(
          harness.proof,
          `native-${destination}-input`,
          readFileSync(receipt)
        );
      requireFact(
        result.status === 0,
        "Actual clean source-expression push failed."
      );
      const input = readFileSync(receipt, "utf8");
      requireFact(
        input.startsWith(`${source} `),
        "Git source-expression receipt differs."
      );
      observations.push({
        name: `native-clean-${destination}`,
        exit: result.status,
      });
    }
    git(cwd, "checkout", "-qb", "first");
    const first = commit(cwd, "first.txt", "clean first\n");
    git(cwd, "checkout", "-qb", "second", base);
    commit(cwd, "credential.txt", secret());
    git(cwd, "rm", "-q", "credential.txt");
    git(cwd, "commit", "-qm", "clean tip");
    git(cwd, "checkout", "-q", "--detach", first);
    const result = command(
      "git",
      [
        "push",
        remote,
        "refs/heads/first:refs/heads/first",
        "refs/heads/second:refs/heads/second",
      ],
      cwd
    );
    requireFact(
      result.status === 1 && result.stdout.includes("generic-api-key"),
      "Actual native multiref push did not block with scanner attribution."
    );
    requireFact(
      readFileSync(receipt, "utf8").trim().split("\n").length === 2,
      "Actual native push did not supply both records."
    );
    observations.push({
      name: "native-two-ref-earlier-secret-block",
      exit: result.status,
    });
  } catch {
    throw new Error(
      "Native disposable push witness failed; private receipt retained."
    );
  }
};
