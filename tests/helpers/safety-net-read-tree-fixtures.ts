/**
 * Fixture rows for the plumbing-discard guard (issue #3978).
 *
 * `git read-tree` with an update flag AND `--reset` rewrites the working tree
 * from the index and throws tracked modifications away — the same destruction
 * `git reset --hard` is refused for, reached through a command carrying neither
 * `--hard` nor the `reset` subcommand, so every reset row misses it.
 *
 * Both verdicts matter equally here. A blanket `read-tree` block would close
 * the hole and break an ordinary safe operation, so the allow rows below are
 * the anti-overblocking half of the contract rather than filler: the
 * discriminator is `--reset` TOGETHER WITH an update flag, and each allow row
 * fails if either half of that conjunction is dropped.
 *
 * Split out of safety-net-guard-fixtures.ts only to keep that module inside the
 * file-length budget, following the STDIN_DELETER_FIXTURES precedent there.
 * @module tests/helpers/safety-net-read-tree-fixtures
 */
import type { GitStateFixture, Verdict } from "./safety-net-guard-harness.js";

const BLOCK: Verdict = "block";
const ALLOW: Verdict = "allow";

/** Guard identifier the rows exercise. */
const READ_TREE_DIRTY = "read-tree-dirty";

/**
 * Builds a {@link GitStateFixture} row for the read-tree-dirty guard.
 * @param id - Matrix row id (e.g. "RT-B1").
 * @param repo - Which fixture repo the hook runs in.
 * @param command - Bash command the hook screens.
 * @param expected - Verdict the hook must produce.
 * @returns The fixture row.
 */
const rt = (
  id: string,
  repo: "clean" | "dirty",
  command: string,
  expected: Verdict
): GitStateFixture => ({
  id,
  repo,
  command,
  expected,
  guard: READ_TREE_DIRTY,
});

/** The plumbing spelling of the hard-reset discard, and its near misses. */
export const READ_TREE_FIXTURES: readonly GitStateFixture[] = [
  rt("RT-B1", "dirty", "git read-tree -u --reset HEAD", BLOCK),
  // Flag order is not a bypass.
  rt("RT-B2", "dirty", "git read-tree --reset -u HEAD", BLOCK),
  // Neither is the long spelling of the update flag, nor a bundled short one.
  rt("RT-B3", "dirty", "git read-tree --reset --update HEAD", BLOCK),
  rt("RT-B4", "dirty", "git read-tree --reset -iu HEAD", BLOCK),
  // Nor a git global option ahead of the subcommand (security review F1).
  rt("RT-B5", "dirty", "git -C . read-tree -u --reset HEAD", BLOCK),
  // Index-only: no update flag, so the working tree is never written.
  rt("RT-A1", "dirty", "git read-tree HEAD", ALLOW),
  rt("RT-A2", "dirty", "git read-tree --reset HEAD", ALLOW),
  // `-m -u` without `--reset` is safe by git's own construction: it refuses
  // rather than overwrite a locally modified file. `--reset` is the flag that
  // switches that refusal off, which is why it — not `-u` — is the trigger.
  rt("RT-A3", "dirty", "git read-tree -m -u HEAD", ALLOW),
  // A clean tree has nothing to discard, exactly as for the reset guard.
  rt("RT-A4", "clean", "git read-tree -u --reset HEAD", ALLOW),
  // The update flag must be a token of its own: a value that merely ENDS in
  // `-u` is not the flag, and must not be read as one.
  rt(
    "RT-A5",
    "dirty",
    "git read-tree --index-output=/tmp/idx-u --reset HEAD",
    ALLOW
  ),
];
