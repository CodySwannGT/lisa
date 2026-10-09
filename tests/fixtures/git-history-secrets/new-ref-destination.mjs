/**
 * @file new-ref-destination.mjs
 * @description A new ref is bounded by what the push destination already holds (CodySwannGT/lisa#4393).
 * @module history-secrets-fixtures
 */
import { join } from "node:path";

/**
 * Real-scanner cases for new-branch pushes against a destination that already
 * holds the credential-bearing history: history the destination published is
 * not reintroduced by a new branch name, and a commit it lacks is still
 * scanned and still blocks.
 * @param {object} harness The shared fixture harness.
 * @param {{ cwd: string, zero: string, second: string }} graph The multiref graph: its repo, the zero ID, and a tip whose history holds a credential.
 */
export const newRefDestinationCases = (harness, { cwd, zero, second }) => {
  const { git, commit, secret, scan } = harness;
  const published = join(cwd, "..", "published-remote.git");
  const remoteArgs = ["published", published];
  const introduceCredential = () => {
    git(cwd, "checkout", "-qb", "published-feature", second);
    commit(cwd, "introduced.txt", secret());
    return commit(cwd, "introduced.txt", "clean feature tip\n");
  };
  git(cwd, "init", "--bare", "-q", published);
  git(cwd, "remote", "add", "published", published);
  git(cwd, "push", "-q", "published", `${second}:refs/heads/second`);
  scan(
    cwd,
    "new-ref-at-published-history",
    [{ before: zero, after: second }],
    0,
    remoteArgs
  );
  scan(
    cwd,
    "new-ref-at-published-history-by-url",
    [{ before: zero, after: second }],
    0,
    [published, published]
  );
  scan(
    cwd,
    "new-ref-introducing-credential-past-published",
    [{ before: zero, after: introduceCredential() }],
    42,
    remoteArgs
  );
  scan(
    cwd,
    "new-ref-unknown-remote-scans-everything",
    [{ before: zero, after: second }],
    42,
    ["unconfigured"]
  );
};
