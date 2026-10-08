/**
 * @file graphs.mjs
 * @description Actual synthetic history journey boundary witnesses.
 * @module history-secrets-fixtures
 */
import { cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
export const graphCases = harness => {
  const {
    args,
    option,
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
    const zero = "0".repeat(40);
    const fixture = initialize("multiref");
    const { cwd, base } = fixture;
    git(cwd, "checkout", "-qb", "first");
    const first = commit(cwd, "first.txt", "clean first\n");
    git(cwd, "checkout", "-qb", "second", base);
    const earlier = commit(cwd, "credential.txt", secret());
    git(cwd, "rm", "-q", "credential.txt");
    git(cwd, "commit", "-qm", "clean tip");
    const second = git(cwd, "rev-parse", "HEAD");
    git(cwd, "checkout", "-q", "--detach", base);
    const multi = scan(
      cwd,
      "two-ref-neither-HEAD",
      [
        { before: base, after: first },
        { before: base, after: second },
      ],
      42
    );
    scan(
      cwd,
      "new-ref-earlier-secret-clean-tip",
      [{ before: zero, after: second }],
      42
    );
    scan(
      cwd,
      "cross-ref-exclusion",
      [
        { before: base, after: second },
        { before: earlier, after: first },
      ],
      42
    );
    scan(
      cwd,
      "already-reachable-excluded",
      [{ before: earlier, after: second }],
      0
    );
    scan(
      cwd,
      "unrelated-dirty-ref-clean-update",
      [{ before: base, after: first }],
      0
    );
    scan(cwd, "deleted-only", [{ before: second, after: zero }], 0);
    scan(
      cwd,
      "mixed-deletion-update",
      [
        { before: second, after: zero },
        { before: base, after: second },
      ],
      42
    );
    scan(cwd, "empty", [], 0);

    // A new ref is bounded by what the push remote already holds (#4393):
    // history the remote published is not reintroduced by a new branch name,
    // and a commit the remote lacks is still scanned and still blocks.
    const published = join(cwd, "..", "published-remote.git");
    git(cwd, "init", "--bare", "-q", published);
    git(cwd, "remote", "add", "published", published);
    git(cwd, "push", "-q", "published", `${second}:refs/heads/second`);
    scan(
      cwd,
      "new-ref-at-published-history",
      [{ before: zero, after: second }],
      0,
      ["published", published]
    );
    scan(
      cwd,
      "new-ref-at-published-history-by-url",
      [{ before: zero, after: second }],
      0,
      [published, published]
    );
    git(cwd, "checkout", "-qb", "published-feature", second);
    commit(cwd, "introduced.txt", secret());
    const introduced = commit(cwd, "introduced.txt", "clean feature tip\n");
    scan(
      cwd,
      "new-ref-introducing-credential-past-published",
      [{ before: zero, after: introduced }],
      42,
      ["published", published]
    );
    scan(
      cwd,
      "new-ref-unknown-remote-scans-everything",
      [{ before: zero, after: second }],
      42,
      ["unconfigured"]
    );

    write(
      cwd,
      ".lisa.config.json",
      JSON.stringify({
        gates: {
          "introduced-history-credential-leakage": { push: "required" },
        },
      })
    );
    const trace = join(cwd, "scripts");
    cpSync(join(emitted, "scripts"), trace, { recursive: true });
    write(
      cwd,
      "scripts/lisa-work-item.mjs",
      `import{readFileSync,writeFileSync}from'node:fs';writeFileSync('trace-input',readFileSync(0),{mode:0o600});console.error(${JSON.stringify(harness.values[0])});process.exitCode=1;\n`
    );
    const wrapper = command(
      process.execPath,
      [join(trace, "lisa-rails-prepush.mjs"), "origin"],
      cwd,
      multi.input
    );
    requireFact(
      wrapper.status === 1 &&
        readFileSync(join(cwd, "trace-input"), "utf8") === multi.input,
      "Traceability fan-out on finding failed."
    );
    observations.push({
      name: "buffered-stdin-fan-out-even-on-finding",
      exit: wrapper.status,
    });
    const lefthook = args.includes("--lefthook")
      ? resolve(option("--lefthook"))
      : "lefthook";
    cpSync(join(emitted, "lefthook.yml"), join(cwd, "lefthook.yml"));
    const hook = command(
      lefthook,
      [
        "run",
        "pre-push",
        "origin",
        "--command",
        "work-item",
        "--no-auto-install",
        "--no-tty",
        "--colors",
        "off",
      ],
      cwd,
      multi.input
    );
    requireFact(
      hook.status === 1 &&
        readFileSync(join(cwd, "trace-input"), "utf8") === multi.input &&
        hook.stdout.includes("generic-api-key"),
      "Actual emitted Lefthook stdin route failed."
    );
    observations.push({
      name: "actual-emitted-lefthook-multiref",
      exit: hook.status,
    });
    git(cwd, "checkout", "-q", "first");
    git(cwd, "merge", "--no-ff", "second", "-m", "merge fixture");
    const merged = git(cwd, "rev-parse", "HEAD");
    scan(cwd, "merge-side-history", [{ before: first, after: merged }], 42);
    const resolution = initialize("merge-resolution");
    git(resolution.cwd, "checkout", "-qb", "side");
    commit(resolution.cwd, "side.txt", "clean side\n");
    git(resolution.cwd, "checkout", "-q", "main");
    const main = commit(resolution.cwd, "main.txt", "clean main\n");
    git(resolution.cwd, "merge", "--no-ff", "--no-commit", "side");
    const mergeSecret = commit(resolution.cwd, "resolution.txt", secret());
    scan(
      resolution.cwd,
      "merge-resolution-secret",
      [{ before: main, after: mergeSecret }],
      42
    );
    git(cwd, "checkout", "-qb", "divergent", base);
    commit(cwd, "force.txt", secret());
    const force = commit(cwd, "force.txt", "clean force tip\n");
    scan(cwd, "force-update", [{ before: first, after: force }], 42);

    return { zero, cwd, base, first, earlier, second, multi };
  } catch {
    throw new Error(
      "graphs.mjs: actual fixture boundary failed; raw vendor metadata is withheld."
    );
  }
};
