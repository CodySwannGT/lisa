/**
 * Command-substitution boundary fixtures for parity-safety-net.sh (issue #1982).
 *
 * Split out of safety-net-guard-fixtures.ts to keep each fixture module under
 * the max-lines budget; spread into STATELESS_FIXTURES there so the guards test
 * consumes them with no test-file change. Guiding invariant: substitution-
 * wrapping is verdict-neutral for the rm guard — a wrapped catastrophic delete
 * blocks iff its unwrapped twin blocks, while inert or benign substitutions
 * (arithmetic, non-rm/non-recursive/project-relative/tmp targets) stay allowed.
 * @module tests/helpers/safety-net-subst-fixtures
 */
import type { GuardFixture, Verdict } from "./safety-net-guard-harness";

const BLOCK: Verdict = "block";
const ALLOW: Verdict = "allow";
const SUBST_BOUNDARY = "subst-boundary";

/**
 * Builds a subst-boundary {@link GuardFixture} row.
 * @param id - Matrix row id (e.g. "SB-B1").
 * @param command - Bash command the hook screens.
 * @param expected - Verdict the hook must produce.
 * @returns The fixture row.
 */
const sfx = (id: string, command: string, expected: Verdict): GuardFixture => ({
  id,
  command,
  expected,
  guard: SUBST_BOUNDARY,
});

/**
 * Command-substitution boundary rows (issue #1982). BLOCK rows are executable
 * recursive-forced deletes of a root/home path nested in `$(…)`, backticks,
 * `<(…)`, or a `${VAR:-…}` default; ALLOW rows are inert or benign substitutions
 * the guard must not over-block. Single-quoted and backslash-escaped inert twins
 * are intentionally omitted — they MAY block within the documented accepted
 * text-scan false-positive class (no quote-context awareness).
 */
export const SUBST_BOUNDARY_FIXTURES: readonly GuardFixture[] = [
  sfx("SB-B1", 'echo "$(rm -rf /)"', BLOCK),
  sfx("SB-B2", "echo $(rm -rf /)", BLOCK),
  sfx("SB-B3", "echo `rm -rf /`", BLOCK),
  sfx("SB-B4", 'echo "`rm -rf /`"', BLOCK),
  sfx("SB-B5", 'echo "$(echo $(rm -rf ~))"', BLOCK),
  sfx("SB-B6", 'echo "${VAR:-$(rm -rf /)}"', BLOCK),
  sfx("SB-B7", 'echo "$(rm -rf ~)"', BLOCK),
  sfx("SB-B8", 'echo "$(\\rm -rf /)"', BLOCK),
  sfx("SB-B9", "cat <(rm -rf /)", BLOCK),
  sfx("SB-B10", "$(rm -rf /)", BLOCK),
  // Absolute non-catastrophic root — exercises the token-walk path (fix 1b),
  // which fix 1a's catastrophic-target class does not reach.
  sfx("SB-B11", 'echo "$(rm -rf /etc)"', BLOCK),
  sfx("SB-B12", 'echo "$(rm -rf /*)"', BLOCK),
  // Bare top-level `*` inside a subst. The catastrophic-target class must NOT let
  // `)` bound the bare-`*` alternative (or a `case … in *)` default arm would
  // read as `rm -rf *`), so this blocks via the token-walk (fix 1b), not 1a.
  sfx("SB-B16", 'echo "$(rm -rf *)"', BLOCK),
  // Backslash-escaped rm (`\rm`, an alias-bypass spelling) to a non-catastrophic
  // absolute path — the leading `\` must normalize away so 1b classifies /etc.
  sfx("SB-B17", 'echo "$(\\rm -rf /etc)"', BLOCK),
  // Write-side process substitution executes its body, so a nested delete blocks.
  sfx("SB-B18", "tee >(rm -rf /)", BLOCK),
  // Arithmetic-break pin: `$((HOME))` must keep its `$` for the variable-target
  // guard (blocked as an unsanctioned dynamic target). Deleting the `$((` break
  // in strip_subst_wrappers would peel it to the bareword `HOME` and wrongly
  // ALLOW this — so this BLOCK row fails if that break is removed.
  sfx("SB-B19", "rm -rf $((HOME))", BLOCK),
  // Already-blocking edges — preserved so the fix never relaxes them.
  sfx("SB-B13", 'echo "$( rm -rf /)"', BLOCK),
  sfx("SB-B14", 'echo "$(command rm -rf /)"', BLOCK),
  sfx("SB-B15", 'echo "$(env rm -rf /)"', BLOCK),
  sfx("SB-A1", 'echo "$(date)"', ALLOW),
  sfx("SB-A2", 'echo "$(basename /)"', ALLOW),
  sfx("SB-A3", 'echo "$(ls /)"', ALLOW),
  sfx("SB-A4", 'echo "$(du -sh /)"', ALLOW),
  sfx("SB-A5", "echo $((10 / 2))", ALLOW),
  sfx("SB-A6", "x=$((2 * 3))", ALLOW),
  sfx("SB-A7", 'echo "$(rm foo.txt)"', ALLOW),
  sfx("SB-A8", 'echo "$(rm -rf build)"', ALLOW),
  sfx("SB-A9", 'echo "$(rm -rf /tmp/scratch)"', ALLOW),
  // Near-miss ALLOW pairs: benign substitutions whose only difference from the
  // BLOCK rows is a non-destructive command — the guard must not over-block.
  sfx("SB-A10", 'case "$x" in *) rm -rf /tmp/build;; esac', ALLOW),
  sfx("SB-A11", "echo `ls /`", ALLOW),
  sfx("SB-A12", "diff <(ls /) <(ls /tmp)", ALLOW),
  sfx("SB-A13", 'echo "${VAR:-/}"', ALLOW),
];
