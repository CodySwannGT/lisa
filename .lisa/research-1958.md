# Research 1958 - heredoc classifier false positives (T1)

Verified at HEAD 209af4609 (merge of PR #1981) on branch feat/1958-heredoc-classifier-fps, 2026-07-22.
Sources of truth: plugins/src/base/hooks/parity-safety-net.sh (472 lines) and
plugins/src/base/hooks/parity-safety-net-heredoc.py (417 lines). Fanned copies in
plugins/lisa/hooks/, plugins/lisa-agy|cursor|copilot/hooks/, dist/opencode/plugin-templates/
are byte-identical today (md5 verified). Builder edits ONLY plugins/src/base/hooks, then
runs: bun run build:plugins (scripts/build-plugins.sh removes and re-copies from src/base -
artifact-only edits are silently discarded), bun run check:plugins to assert sync, and
bun run build:upstream-evidence-manifest in the SAME commit (CI stale-manifest gate).

## 1. Current anchors at HEAD

### block_heredoc() - parity-safety-net.sh:102-108
Wraps block() and appends remediation UNCONDITIONALLY to every heredoc denial, commit or not:

    block_heredoc() {
      block "$1
    Heredoc commit invocations are blocked (the payload is executable shell).
    Fix: write the commit message to a file and run  git commit -F <file> .
    Every commit must also carry a Co-authored-by trailer for a supported agent
    (Claude/Codex/OpenCode) - the commit-msg hook enforces this."
    }

Scope item 3 makes this conditional: keep the commit -F text when the command contains a
git commit invocation; otherwise recommend writing the payload to a file with the Write
tool and executing the file. Note block() itself (lines 82-91) appends the generic
matched-a-guard paragraph; block_heredoc adds the commit text on top.

### Parser invocation protocol - parity-safety-net.sh:110-136
- Trigger: case "$command_str" in *'<<'* (any << substring anywhere).
- Parser resolved as $hook_dir/parity-safety-net-heredoc.py next to the hook.
- Gate A (line 115): python3 missing or parser unreadable -> block_heredoc
  "cannot safely classify heredoc command because its parser runtime is unavailable".
- Gate B (line 118): printf %s(cmd+newline) | /bin/bash -n fails -> block_heredoc
  "malformed heredoc command failed shell syntax validation".
- Parse (line 123): printf %s "$command_str" | python3 parser, stderr discarded.
  Protocol: RAW COMMAND ON STDIN, sanitized text (exit 0 only) on STDOUT. No argv.
- Exit-code vocabulary (heredoc.py:11-13): SAFE=0, UNSUPPORTED=10, MALFORMED=20.
  Hook dispatch (lines 129-134):
    0  -> command_for_guards = parser stdout (payload STRIPPED before guards)
    10 -> command_for_guards = raw command (payload fully visible to all guards)
    20 -> block_heredoc "malformed or ambiguous heredoc command cannot be safely classified"
    *  -> block_heredoc "heredoc parser failed; command was denied fail-closed"
- ERR-trap subtlety (lines 59-66): the hook deliberately does NOT set -E because errtrace
  would rewrite the parser exit codes to 2 inside the command substitution. Preserve.

### gh allowlist path - heredoc.py:16-22, 77-98 (scope: DO NOT WIDEN)
- ALLOWED_GROUPS = {issue, pr}; ALLOWED_ACTIONS = {create, edit, comment} (lines 21-22).
- is_allowed_gh (77-83): tokens[0]==gh, tokens[1] in groups, tokens[2] in actions.
- BODY_CAT_MARKER regex (16-20): the exact  --body "$(cat <<'DELIM'  header form.
- classify_safe (119-155): the ONLY exit-0 path. Two grammars: body-cat form and the
  direct  --body-file -  form; direct form demands raw_marker == <<'delim' exactly
  (line 144, single quotes only), nothing after the marker on the header line, exact
  terminator line, only whitespace after; violations inside a recognized writer raise
  ValueError -> MALFORMED.

### has_active_command_substitution - heredoc.py:296-331 (THE F1 mechanism)
Character-level quote-state scan over the ENTIRE command string INCLUDING heredoc bodies.
Returns True on a backtick or $( outside single quotes and outside comments. Because the
body of a fully-quoted heredoc is literal data to bash but plain text to this scanner,
backticks or $( inside a string literal in the payload flip the verdict.

### main() decision ladder - heredoc.py:373-413 (marker-count rule at 409)
1. No << in command -> echo unchanged, SAFE.
2. classify_safe: ValueError -> MALFORMED; sanitized -> SAFE (gh writers only).
3. collapse_line_continuations (235-265), top_level_markers (158-194).
4. writer_has_commented_marker_and_following_code -> MALFORMED (282-293).
5. writer_owns_real_marker -> MALFORMED (268-279).
6. line 394: NO markers and NO active substitution -> UNSUPPORTED (quoted-prose operators).
7. line 400: first line has an allowed gh writer (but failed exact grammar) -> MALFORMED.
8. line 407: has_active_command_substitution -> MALFORMED   <- F1 dies HERE.
9. line 409: len(markers) > 1 -> MALFORMED                  <- chained heredocs die here.
10. line 411: single marker unclosed (marker_is_closed 363-370) -> MALFORMED.
11. else UNSUPPORTED (raw text through guards).

## 2. Parser delimiter-quoting capability today

parse_marker (heredoc.py:334-360) DOES read quoting while parsing:
- Handles <<- strip-tabs, skips whitespace, then:
      quote = line[index] if line[index] in "..." else None
  For a quoted delimiter it takes everything to the matching close quote (BOTH single and
  double quotes handled identically); for unquoted it regex-matches [A-Za-z_][A-Za-z0-9_]*.
- BUT the quoting decision is DISCARDED: Marker (25-30) stores only
  (start, end, delimiter, strip_tabs). No quoted field survives.
- Backslash form <<\EOF: parse_marker returns None (backslash is not a quote char and
  the identifier regex rejects it) - the marker is INVISIBLE, no Marker is recorded.
- Partial quoting <<EO'F': parsed as UNQUOTED delimiter "EO" (stops at the quote), which
  mismatches the real bash delimiter EOF after quote removal -> terminator never found.

The only quoting check in the file is classify_safe line 144: raw-slice equality
header[start:end] == <<'delim' - single-quote-only, exact, gh-grammar-only.

POSIX note: ANY quoting of ANY part of the delimiter (single, double, or backslash escape)
makes the body non-expanding. What the parser can prove TODAY: fully-single-quoted (raw
slice compare) and fully-double-quoted (parse_marker consumed a quote pair - recoverable by
re-checking the raw slice or by extending Marker). It can NOT currently see <<\EOF at all
and it mis-tokenizes partial quoting.
F4 recommended conservative line: extend Marker with a quoted flag set ONLY when the whole
delimiter token was wrapped in one quote pair (<<'EOF' or <<"EOF"); treat only that as
non-expanding. Leave <<\EOF (invisible marker -> UNSUPPORTED -> body raw-scanned by guards,
fail-safe) and partial quoting (terminator mismatch -> MALFORMED) exactly as they behave
today, and document the divergence from POSIX as deliberate fail-closed conservatism.

## 3. Test suite

There is NO python-side unit harness anywhere in the repo (no *.py tests, no pytest);
heredoc.py is exercised ONLY through the shell hook as a subprocess of vitest suites.
Runner: vitest (package.json test = vitest run), jest-style globals, describe/it/it.each.

- tests/unit/hooks/parity-safety-net.test.ts - MAIN heredoc coverage (lines 52-242):
  allowed prose payloads (quoting every destructive form), the exact body-cat form,
  executable bash/python3 quoted heredocs BLOCKED (line 77-86 - F1 currently sits in this
  expectation set via the substitution-token path), quoted fake markers, unquoted expanding
  heredoc, it.each fail-closed table (multiple heredocs, unclosed, trailing command, piped
  writer, chained writer, destructive-before-writer), parser-missing/crash tempdir fixture,
  custom-rules interplay, bash -n syntax pin.
- tests/unit/hooks/parity-safety-net-heredoc.test.ts - adversarial grammar (89 lines):
  quote-concatenated writers, commented markers, line continuations. runHook returns only
  status here; the .test.ts above also captures stderr (use THAT helper style for F6
  remediation-text assertions).
- tests/unit/hooks/parity-safety-net-guards.test.ts - smoke pins only (HD-A1 exempt,
  HD-B1 block); header states deep heredoc coverage lives in the two files above.
  Uses tests/helpers/safety-net-guard-harness.ts + safety-net-guard-fixtures.ts.
- Parity mirrors: tests/unit/agy/parity-safety-net-agy.test.ts,
  tests/unit/opencode/parity-safety-net-plugin.test.ts.
- Convention: HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh") - the
  FANNED copy. Run bun run build:plugins after editing src/base or tests exercise stale code.
- runHook: spawnSync(/bin/bash, [hook], stdin = JSON {tool_name: Bash, tool_input:{command}}),
  assert status 2 (blocked) / 0 (allowed); EXIT_BLOCKED/EXIT_ALLOWED constants.
- Placement for F1-F7: new rows in the parity-safety-net.test.ts heredoc describe (flip the
  python3-backtick expectation, add F2 control with substitution tokens in payload, keep F3
  in the unquoted set, F5 already covered by unclosed row); F4 partial/escaped forms fit
  parity-safety-net-heredoc.test.ts; F6 asserts stderr content in parity-safety-net.test.ts;
  add one HD smoke pin in guards.test.ts. If the builder wants isolated classifier tests,
  precedent is subprocess drive: spawnSync python3 with the command on stdin asserting the
  0/10/20 code - a new file like tests/unit/hooks/parity-safety-net-heredoc-parser.test.ts
  would be a new (but consistent) convention.

## 4. Empirical repro at HEAD 209af4609 (real hook drives, stdin JSON; parser driven directly too)

| Probe | Command shape | parser exit | hook exit | message |
|---|---|---|---|---|
| F1 | python3 <<'EOF' ; body: s = "triple-backtick markdown triple-backtick" | 20 MALFORMED | 2 BLOCKED | malformed or ambiguous heredoc command cannot be safely classified + git commit -F text |
| F1b | python3 <<'EOF' ; body: print("hello") - no substitution tokens | 10 UNSUPPORTED | 0 ALLOWED | - |
| F2 | python3 <<'EOF' ; body: import os; os.system("rm -rf /") | 10 UNSUPPORTED | 2 BLOCKED | recursive forced delete of a root, home, or wildcard path (rm -rf) |
| F3 | gh issue create --body-file - <<EOF (UNQUOTED); body: $(rm -rf /) | 20 MALFORMED | 2 BLOCKED | malformed-or-ambiguous + commit -F text |
| F6 | git commit -m "$(cat <<'EOF' ... EOF )" | 20 MALFORMED | 2 BLOCKED | malformed-or-ambiguous + commit -F text (appropriate HERE, wrong for F1/F3) |
| F4a | python3 <<\EOF ; harmless body | 10 UNSUPPORTED | 0 ALLOWED | marker invisible; body raw-scanned |
| F4b | python3 <<EO'F' ; harmless body, EOF terminator | 20 MALFORMED | 2 BLOCKED | delimiter tokenized as EO, never closed |

Key readings for the builder:
- F1b proves plain quoted interpreter heredocs ALREADY pass as UNSUPPORTED. The bug is
  narrowly: substitution TOKENS inside the quoted BODY flip UNSUPPORTED to MALFORMED at
  main() line 407 because has_active_command_substitution scans body text. The fix is a
  body-aware scan (exclude the single quoted-heredoc body window: lines header+1 through
  the first exact terminator line), NOT a new exit code. Target class stays UNSUPPORTED(10)
  so the raw payload keeps flowing to the content guards.
- F2 proves the content-guard pass-through requirement is ALREADY satisfied for the
  UNSUPPORTED class (hook blocked via the rm guard, not the heredoc wall). CRITICAL: the
  F2 fixture must ALSO be run in a variant whose guarded payload contains $( or backticks
  (e.g. $(rm -rf /) inside the quoted body) - today that variant exits 20; post-fix it must
  exit 10 AND still be blocked by the guards. That is the bypass-proof control.
- F3 stays MALFORMED via the same line-407 check because its marker is unquoted - the
  body-window exclusion must apply ONLY when the single marker is provably fully quoted
  (mutation-proofing per T2: treating unquoted as quoted must fail this fixture).
- The bash -n gate (hook line 118) runs BEFORE the parser: truly unparseable heredocs are
  blocked with the shell-syntax-validation message, so F5 fixtures should use shapes that
  survive bash -n (bash -n accepts an unclosed heredoc with a warning on some bash
  versions - verify empirically which message F5 lands on).

## 5. Multi-heredoc (chained, all-quoted) feasibility - RECOMMEND OUT OF SCOPE

Not a natural extension; it multiplies parse states. Specific obstacles:
1. No body-region model exists. top_level_markers only locates marker tokens;
   marker_is_closed (363-370) searches ALL lines after the marker line for the terminator.
   With two markers, body one containing a line equal to delimiter two falsely closes
   marker two (and vice versa). Correct chained parsing needs ordered body segmentation -
   bash consumes bodies in marker order starting on the line after the header - including
   the same-line case (cat <<'A' <<'B') and markers on different lines with commands
   between, which is exactly the ambiguity the classifier exists to refuse.
2. The substitution scanner would need multiple disjoint exclusion windows, one per body,
   each dependent on correct segmentation of the previous body - errors compound.
3. len(markers) > 1 -> MALFORMED (line 409) is a one-line rule, but every downstream
   assumption (single terminator search, single body window for the F1 fix) is single-
   marker. Relaxing it without a real segmentation pass invites exactly the parser-
   soundness attacks T3 will probe (overlapping delimiters, delimiter-in-body, CRLF).
The single-heredoc F1 fix needs exactly one body window and zero new states - cheap and
provable. Recommendation: ship single-heredoc only; document chained as out-of-scope,
citing the marker_is_closed cross-closure defect as the concrete blocker (it must be fixed
before chaining could ever be sound).

## 6. History and do-not-disturb list

parity-safety-net.sh (all 2026-07-22 except last two):
- 15d5ee8fb feat: conditional git rebase --abort/--quit guard (issue #1956, merged via PR #1979)
- 29818e25f fix: pair any recursive form with any force form in rm split gate (PR #1976)
- 8ab54c7e6 fix: close git global-option and path-prefixed rm bypasses (PR #1976)
- f02715fa7 feat: absorb upstream safety-net 1.0.6 guards (PR #1976)
- c0f3ee290 2026-07-19: git commit -F remediation text in heredoc denials (gardener #1789, PR #1791)
heredoc.py: untouched since 2026-07-17 (5450387ee fail-closed #1594; 267757aee CodeRabbit fixes).

MUST NOT DISTURB (fresh from #1976/#1979, under their own test pins):
- GIT_GLOBAL_OPTS + GIT_CMD anchor (lines 160-169) and every guard built on them.
- RM_CMD / RM_RF_CLUSTER / RM_RF_SPLIT (170-183) and the per-statement rm loop (211-280).
- Guard 3b rebase --abort/--quit AUTO_MERGE discriminator (320-354).
- The ERR trap WITHOUT set -E (59-66) - errtrace would destroy the parser exit-code
  protocol the heredoc dispatch depends on.
- Guard-2 force-push statement splitting (282-305).
The heredoc work surface is disjoint: block_heredoc() (102-108), the dispatch case
(110-136, only if the remediation conditional needs command_str context), and heredoc.py
(Marker, parse_marker, has_active_command_substitution, main). No custom rules file exists
in this checkout (.claude/safety-net-rules.txt absent), so rules-file interplay is
covered only by the tempdir fixtures in the tests.
