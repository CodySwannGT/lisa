/**
 * Classify-step fixtures for parity-safety-net.sh (issue #3494).
 *
 * Split out of safety-net-guard-fixtures.ts to keep each fixture module under
 * the max-lines budget — the same precedent safety-net-subst-fixtures.ts set —
 * and spread into STATELESS_FIXTURES there so the guards test consumes them
 * with no test-file change.
 *
 * #3320 fixed the SPLIT step of this classifier: the control-plane guard stopped
 * cutting a pipeline apart before it could pair a protected target with a
 * recursive forced delete. These rows cover the CLASSIFY step, which that fix
 * did not reach — four ways a recursive forced delete on unaudited stdin was
 * spelled past the guard rather than hidden from it.
 *
 * Guiding invariant, one per arm: HOW THE DELETER IS SPELLED AND HOW THE FLAGS
 * ARE SPELLED MUST NOT CHANGE THE VERDICT. A path-prefixed `xargs` is an
 * `xargs`; `--recursive --force` is `-rf`; `parallel` is an `xargs`; and a
 * subshell-parenthesised pipeline is its brace-wrapped twin. Every block row is
 * paired with a near-miss allow row, because the value of this guard is
 * destroyed the day it starts refusing ordinary cleanups.
 * @module tests/helpers/safety-net-stdin-deleter-fixtures
 */
import type { GuardFixture, Verdict } from "./safety-net-guard-harness";

const BLOCK: Verdict = "block";
const ALLOW: Verdict = "allow";
const STDIN_DELETER = "stdin-deleter";
const SUBSHELL_BOUNDARY = "subshell-boundary";

/**
 * Builds a classify-step {@link GuardFixture} row.
 * @param id - Matrix row id (e.g. "SD-B1").
 * @param command - Bash command the hook screens.
 * @param expected - Verdict the hook must produce.
 * @param guard - Guard identifier the row exercises.
 * @returns The fixture row.
 */
const dfx = (
  id: string,
  command: string,
  expected: Verdict,
  guard: string
): GuardFixture => ({ id, command, expected, guard });

/**
 * Recursive forced deletes fed by unaudited stdin, across every spelling of the
 * feeding command and of the delete flags, plus the near-miss cleanups that
 * must stay allowed.
 *
 * Each `SD-B*` row was measured ALLOW against the shipped hook before this
 * change and BLOCK after it; each `SD-A*` row was ALLOW both times.
 */
export const STDIN_DELETER_FIXTURES: readonly GuardFixture[] = [
  // Arm 1 — the deleter reached by a PATH or a VENDOR prefix. The old rule
  // opened with `(^|[^[:alnum:]_./-])xargs`, whose excluded class contains `/`,
  // so the `/` in `/usr/bin/xargs` was itself disqualifying.
  dfx("SD-B1", "find . -type d | /usr/bin/xargs rm -rf", BLOCK, STDIN_DELETER),
  dfx("SD-B2", "find . -type d | gxargs rm -rf", BLOCK, STDIN_DELETER),
  dfx(
    "SD-B3",
    "find . -type d | /usr/local/bin/parallel rm -rf",
    BLOCK,
    STDIN_DELETER
  ),
  // Arm 2 — LONG-OPTION deletes, refused wherever the short cluster already is.
  dfx(
    "SD-B4",
    "find . -type d | xargs -0 -- rm --recursive --force",
    BLOCK,
    STDIN_DELETER
  ),
  dfx(
    "SD-B5",
    "find . -type d | parallel rm --recursive --force",
    BLOCK,
    STDIN_DELETER
  ),
  // Mixed short/long, the pairing PR #1976 taught the rm walk and this rule
  // never inherited.
  dfx("SD-B6", "find . -type d | xargs rm -r --force", BLOCK, STDIN_DELETER),
  // Arm 3 — GNU `parallel`, a drop-in xargs substitute reaching the same delete
  // on the same unaudited stdin.
  dfx("SD-B7", "find . -type d | parallel rm -rf", BLOCK, STDIN_DELETER),
  // The one spelling that always worked — pinned so the rewrite cannot lose it.
  dfx("SD-B8", "find . -type d | xargs rm -rf", BLOCK, STDIN_DELETER),
  // Near-miss ALLOWs. A non-recursive delete on find/xargs output is the
  // ordinary cleanup this guard has always permitted (compare FX-A5), and the
  // new spellings must not quietly widen that.
  dfx(
    "SD-A1",
    "find . -name '*.log' | /usr/bin/xargs rm -f",
    ALLOW,
    STDIN_DELETER
  ),
  dfx("SD-A2", "cat list.txt | xargs rm -r", ALLOW, STDIN_DELETER),
  dfx("SD-A3", "cat list.txt | parallel rm -f", ALLOW, STDIN_DELETER),
  dfx("SD-A4", "find . -type f | gxargs grep pattern", ALLOW, STDIN_DELETER),
  dfx("SD-A5", "find . -name '*.log' | parallel gzip {}", ALLOW, STDIN_DELETER),
  dfx("SD-A6", "echo x | parallel ls", ALLOW, STDIN_DELETER),
  // `parallel` as an English word, and a deleter whose basename merely ENDS in
  // one — the same discipline `confirm`/`rmdir` get from RM_CMD.
  dfx("SD-A7", 'echo "run the suites in parallel"', ALLOW, STDIN_DELETER),
  dfx("SD-A8", "cat list.txt | myxargs rm -rf", ALLOW, STDIN_DELETER),
  // The deleter and the delete in SEPARATE statements must not be paired: the
  // intra-statement `[^;&|]*` constraint is what prevents that, and dropping it
  // would turn both of these into refusals.
  dfx("SD-A9", "cat list.txt | xargs ls ; rm -rf build", ALLOW, STDIN_DELETER),
  dfx("SD-A10", "parallel echo ::: a b && rm -rf build", ALLOW, STDIN_DELETER),
  // Arm 4 — a SUBSHELL-parenthesised pipeline classified exactly as its
  // brace-wrapped twin. The brace form matched only because its `;` supplied
  // the boundary the closing paren did not.
  dfx(
    "SD-B9",
    "(find .git -type d | parallel rm -rf)",
    BLOCK,
    SUBSHELL_BOUNDARY
  ),
  dfx(
    "SD-B10",
    "(find .git -type d | /usr/bin/xargs rm -rf)",
    BLOCK,
    SUBSHELL_BOUNDARY
  ),
  // The twin, pinned alongside it so the pair can never drift apart again.
  dfx(
    "SD-B11",
    "{ find .git -type d | parallel rm -rf; }",
    BLOCK,
    SUBSHELL_BOUNDARY
  ),
  dfx("SD-B12", "(rm -rf .git)", BLOCK, SUBSHELL_BOUNDARY),
  // Paren near-misses. Widening the flag-cluster boundary to accept `)` must
  // not start refusing in-project cleanups that happen to be parenthesised, nor
  // prose that quotes one, nor a `case` arm whose `)` precedes the delete.
  dfx("SD-A11", "(rm -rf build)", ALLOW, SUBSHELL_BOUNDARY),
  dfx("SD-A12", "(cd packages && rm -rf dist)", ALLOW, SUBSHELL_BOUNDARY),
  dfx(
    "SD-A13",
    'echo "cleanup (rm -rf build) is safe"',
    ALLOW,
    SUBSHELL_BOUNDARY
  ),
];
