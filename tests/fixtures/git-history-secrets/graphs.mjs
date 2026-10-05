/**
 * @file graphs.mjs
 * @description Actual synthetic history journey boundary witnesses.
 * @module history-secrets-fixtures
 */
/**
 * Exercise introduced commit graphs with the actual supported scanner.
 * @param harness - Private disposable fixture operations
 * @returns Git boundaries reused by the failure and event controls
 */
export const graphCases = harness => {
  const { git, commit, secret, initialize, scan } = harness;
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
