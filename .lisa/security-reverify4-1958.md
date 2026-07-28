# Security RE-VERIFICATION round 4 — #1958 heredoc classifier (R3-fix attack + convergence)

Re-verification at HEAD `271ba9399` (R3 unquoted-body fix) atop `eedc02aff` (R2),
`a2fae713a` (R1 ANSI-C), `224ed78b9` (per-line reset). Predecessors:
`.lisa/security-review-1958.md` (Finding 1), `-reverify-1958.md` (R1),
`-reverify2-1958.md` (R2), `-reverify3-1958.md` (R3 VETO). Every payload assembled
from bytes in Python (base64, never inline in Bash), driven JSON-on-stdin through the
REAL fanned hook (`plugins/lisa/hooks/parity-safety-net.sh` → `parity-safety-net-heredoc.py`),
and every executed case run under the same `/bin/bash` 3.2.57 the hook's `bash -n` gate
uses, with `touch`/`id` sentinels. Harness `/tmp/hd1958rv4/` (`drive.py`, `gen1..4.py`,
`mech.py`).

## VERDICT: **VETO** — a FIFTH, distinct, executable desync is live (Finding R4).

The R3 fix is real: the direct apostrophe/`#` reproducers (UQ_sq_inline `it's $(…)`,
UQ_squote, UQ_hash_line, UQ_hash_after) and UQ_plain now all classify **20 → BLOCKED**,
and legit forms (apostrophe prose, quoted-delimiter bodies, `<<-`+tabs, `$HOME`-only,
legit trailing-backslash prose) stay ALLOWED — no over-block. **But R3's own new logic
is defeated by a bash line-continuation the wall never joins.**

`unquoted_heredoc_body_has_substitution` scans the body **after**
`collapse_line_continuations` has run, and scans it **per body line**. Both assumptions
are wrong for an unquoted heredoc body:

1. `collapse_line_continuations` (L343) applies a **flat** shell quote state. Its
   `state == "single"` branch (L354-357) **refuses to collapse a `\<newline>`**. But an
   unquoted heredoc body performs NO quote processing — a body `'` is a literal byte, not
   a string opener — while bash STILL removes `\<newline>` (bash manual: unquoted
   here-doc, "the character sequence `\newline` is ignored"). So one apostrophe in the
   body flips the collapser into phantom single-quote state and it leaves a
   `$\<newline>(` split **un-joined**.
2. `body_line_has_substitution` (L460) flags a bare backtick (single char) but requires
   `$(` to be **two contiguous bytes** on one line. With the continuation left un-joined,
   `$` sits at the end of body line N and `(` at the start of body line N+1, so the
   per-line scan sees `'$\` (no `$(`) and `(touch…)` (no `$(`) — **neither triggers**.

Net: `has_active_command_substitution` returns False (it too thinks it is inside an open
single-quoted string), `unquoted_heredoc_body_has_substitution` returns False, parser
falls to **UNSUPPORTED(10)**, hook **exits 0 (ALLOWED)** — and real bash joins the
continuation and executes the `$(...)`.

---

## Security (proven)

### FINDING R4 — CRITICAL (VETO): `\`-newline continuation splits `$(` past the unquoted-body scan

`plugins/*/hooks/parity-safety-net-heredoc.py` — `collapse_line_continuations` L354-357
(single-state short-circuit) + `body_line_has_substitution` L460-484 (per-line, contiguous
`$(` only). Prevent by making the body scan **continuation-aware and heredoc-body-aware**
(fix direction below).

- **Reproducers** (end-to-end through the real hook; `bash -n` PASS → parser 10 →
  hook ALLOWED(0) → bash created the sentinel). Bytes shown escaped; `⏎`=newline,
  `\`=one backslash:

  | id | payload (raw) | parser | hook | bash_exec |
  |----|---------------|--------|------|-----------|
  | A_contsplit_sq | `cat <<EOF⏎'$\⏎(touch SENT_A)⏎EOF⏎` | 10 | **ALLOWED(0)** | **True** |
  | W_weaponized_id | `cat <<EOF⏎'$\⏎(touch SENT_W && id)⏎EOF⏎` | 10 | **ALLOWED(0)** | **True** (`id` ran) |
  | P_realistic_prose | `cat <<EOF⏎notes: it's the rollout plan.⏎cleanup step $\⏎(touch SENT_P)⏎EOF⏎` | 10 | **ALLOWED(0)** | **True** |
  | R_destructive_shape | `cat <<EOF⏎'$\⏎(rm -rf ~/…)⏎EOF⏎` | 10 | **ALLOWED(0)** | (not run) |

  `mech.py` isolated introspection for W:
  ```
  after collapse_line_continuations: "cat <<EOF\n'$\\\n(touch SENT_A && id)\nEOF\n"   # \<newline> NOT joined
  has_active_command_substitution : False
  unquoted_heredoc_body_has_substitution : False
  body lines seen by scan: "'$\\" -> sub? False ; '(touch SENT_A && id)' -> sub? False
  bash stdout: 'uid=501(cody) gid=20(staff) …'      # id executed
  SENT_A made: True
  ```

- **Controls that HELD (isolate the defect precisely):**
  | id | payload | parser | hook | note |
  |----|---------|--------|------|------|
  | B_contsplit_nosq | `cat <<EOF⏎$\⏎(touch)⏎EOF` | 20 | BLOCKED | no `'` → collapse joins `$(` → caught (proves the `'` is the trigger) |
  | Q_doublequote | `cat <<EOF⏎"$\⏎(touch)⏎EOF` | 20 | BLOCKED | `"` does NOT defeat collapse (joins in double-state) → isolates the bug to the **single-state** branch |
  | C_contsplit_backtick | `cat <<EOF⏎'`\⏎touch…`⏎EOF` | 20 | BLOCKED | backtick is a 1-char trigger, immune to the split — only `$(` is split-hideable |

- **Impact:** arbitrary `$(…)`/exfil (`$(curl…|sh)`, proven via `$(touch && id)`) executes
  while the hook reports the command safe. The trigger is a single apostrophe anywhere
  earlier in the body (ordinary English prose — `it's`) plus a `$` at end-of-line followed
  by `(` on the next line — a plausible line-wrapped `cat <<EOF` file-write. Same RCE class
  the PR claims to wall off; destructive `rm -rf` in this position is also guard-blind
  (R_destructive_shape ALLOWED).

- **reason:** reproducer (bash executed `id` + the sentinel end-to-end through the real
  hook; B/Q/C controls prove parity elsewhere and pin the root cause to the single-state
  branch) + bounded impact (arbitrary substitution in any unquoted heredoc body via
  apostrophe + `\`-newline-split `$(`).

**Fix direction (not applied):** the body scan must not depend on
`collapse_line_continuations` (whose flat single-quote state is wrong for a body). In
`unquoted_heredoc_body_has_substitution`, walk the body window on the **raw** lines and,
before applying `body_line_has_substitution`, **join any body line ending in an unescaped
`\` with the next line** (bash's unquoted-here-doc `\newline` removal) — equivalently, feed
the whole body window as one continuation-collapsed string to a body-semantics scanner that
honours only backslash-escaping and flags `$(`/backtick. Verify OB_trailbs (legit trailing
`\` prose, no `$(`) stays ALLOWED under the fix, and add A/W/P/T as RED fixtures with
B/Q/C as the isolating controls. This is the same "model diverges from bash inside an
unquoted heredoc body" root as R3 — the R3 scan closed the quote/comment desync but not the
line-continuation desync feeding it.

---

## Convergence sweep (prior findings) — all HELD

- Findings 1 / R1 / R2 / **R3**: UQ_sq_inline, UQ_squote, UQ_hash_line, UQ_hash_after,
  UQ_plain all → **20 / BLOCKED** (R3 fix confirmed effective for the direct forms).
- Over-block controls all → **ALLOWED**: apostrophe prose (OB_prose), quoted-delimiter
  literal body with `$(` (OB_quoted), `<<-`+tabs (OB_tabdash), legit trailing-backslash
  prose (OB_trailbs), `$HOME`-only expansion (OB_var). No false positive.
- Multiple heredocs: `len(markers) > 1` → MALFORMED (L710); a second unquoted heredoc
  carrying the payload is BLOCKED by that rule, not a bypass.
- `${…:-$(cmd)}` / `$((…))` forms: contain a contiguous `$(`, so
  `body_line_has_substitution` flags them (unless split by the R4 continuation trick, which
  is the finding). Backtick is 1-char and split-immune (C control).

## Recommendations
- **CRITICAL / VETO** — do not merge as "RCE fixed". R4 ships a live RCE in the same class
  via `apostrophe + \`-newline-split `$(``. Make the body scan continuation-aware (fix
  direction above); keep the sound per-line/ANSI-C/blank-set/R3 fixes.
- **WARNING** — predecessor Finding 2 (content guards miss `$(…)` at the `/)` boundary /
  in double quotes) remains why R4 is CRITICAL rather than defence-in-depth-contained.
</content>
</invoke>
