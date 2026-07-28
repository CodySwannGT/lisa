# Security RE-VERIFICATION — Finding-1 RCE fix (CodySwannGT/lisa#1958)

Re-verification of fix commit `224ed78b9` ("reject fake heredocs nested in open quotes").
Predecessor findings: `.lisa/security-review-1958.md`. All payloads assembled from files and
driven against the REAL fanned hook (`plugins/lisa/hooks/parity-safety-net.sh`, JSON on stdin)
+ parser, and every candidate was ALSO executed under a sandboxed `bash` with `touch` sentinels
so "ALLOWED **and** bash actually ran the substitution" is the ground-truth RCE test.
Harness: `/tmp/hd1958rv/{gen.py,run.py,confirm.py,breadth.py,mech.py}`; reproducer
`/tmp/hd1958rv/REPRO_ansic.txt`.

## VERDICT: **VETO** — the three known kill-shots are dead, but the RCE **class is still open**.

A new, executable reproducer classifies **UNSUPPORTED(10) → hook ALLOWED**, and bash **creates
the sentinel** (arbitrary command execution) through the exact wall #1958 exists to defend.

---

## 1. Originals re-run (the fix works for what it targeted) — PASS

| id | payload file | new parser | hook | bash exec | result |
|----|--------------|-----------|------|-----------|--------|
| A2 | p_a2_dq.txt | 20 MALFORMED | BLOCKED (exit 2) | (would exec) | ✅ dead |
| A3 | p_a3_curl.txt | 20 MALFORMED | BLOCKED (exit 2) | — | ✅ dead |
| A4 | p_a4_assign.txt | 20 MALFORMED | BLOCKED (exit 2) | (would exec) | ✅ dead |

No sentinel was created for any original. `cross_line_quote_state` correctly reports `double` at
the marker for the A2/A3/A4 shape → strip refuses → `has_active_command_substitution` sees the
live `$(...)` → MALFORMED. The per-line-reset regression is genuinely fixed.

Positive controls also held (no over-block regression): **F1**, **F_agent** (realistic agent
inline-python posting a Linear comment, with `$(...)` and backticks inside a quoted body),
and **N_tabdash_legit** all → UNSUPPORTED/ALLOWED and bash did **not** execute. ✔

---

## Security (proven)

### FINDING R1 — CRITICAL (VETO): ANSI-C `$'...'` desync smuggles a live `$(...)` past the wall
`plugins/*/hooks/parity-safety-net-heredoc.py` — the shared quote model used by
`has_active_command_substitution` (L301-336), `cross_line_quote_state` (L381-419),
`top_level_markers` (L163-199) and `shell_tokens` (L38-79) does **not** understand bash
ANSI-C `$'...'` quoting.

- **Reproducer** (`/tmp/hd1958rv/REPRO_ansic.txt`, executable, end-to-end through the real hook):
  ```
  x=$'\''"
  cat <<'EOF'
  $(touch /tmp/hd1958rv/sbx/REPRO)
  EOF
  "
  ```
  `bash -n` PASS → parser consulted → **parser exit 10 (UNSUPPORTED)** → **hook exit 0 (ALLOWED)**
  → running under bash **created the sentinel** → the `$(touch …)` really executed.
  Also proven for `echo $'\''…` (no assignment) and for the `$(rm …)` position (touch proxy).
- **Mechanism** (proved via `mech.py`): to bash, `$'\''` is a *complete* ANSI-C string — the
  `\'` is an escaped literal quote, the string closes, net quote state **plain** — and the
  following `"` opens a real double-quoted string that spans the heredoc-shaped lines, so
  `$(...)` inside it is **executed**. The parser's model treats `$` as ordinary and then sees
  three bare `'` (`'` `\'…'` `'`) → single→plain→single, ending in a **phantom open single-quote**
  that swallows the `"` and the entire remainder. Concretely at the marker:
  `cross_line_quote_state = 'single'` (bash's real state = **double/expanding**), and
  `has_active_command_substitution(command) = False` — the scanner is **blind** to the live
  substitution. Parser falls through to UNSUPPORTED(10); hook allows.
- **Why the fix does not stop it:** the fix hardened the *strip exclusion* (cross_line gate),
  and that gate behaves correctly here — it declines to strip (`single ≠ plain`). But the
  actual wall, `has_active_command_substitution`, is **independently blind** for the same
  root reason (ANSI-C ignorance). A perfect strip gate cannot save a scanner that cannot see
  the substitution. So the fix patched the three per-line kill-shots without closing the class.
- **Delta / provenance:** the payload classifies **10 on BOTH** the pre-#1958 parser
  (`/tmp/hd1958/old_heredoc.py`, which blocks A2 at 20) **and** the fixed parser — i.e. this is
  a **pre-existing** member of the RCE class, orthogonal to Finding 1's per-line bug, that
  neither the regression nor the fix touched. It is in scope: the merge would ship a live RCE
  in the same class the PR claims to wall off.
- **Impact:** arbitrary expanding `$(…)` / `` `…` `` executes while the hook reports the command
  safe — RCE / exfil (`$(curl …|sh)`) / destructive (`$(rm …)`, which per predecessor Finding 2
  the content guards also miss inside `$("`). Precondition is only "the agent emits this
  string," which is the guard's whole threat model.
- **reason:** reproducer (bash executed the sentinel end-to-end through the real hook) +
  bounded impact (arbitrary substitution in the ANSI-C-wrapped shape) + old==new==10 delta.

**Fix direction (not applied):** teach the *shared* quote model ANSI-C `$'…'` (and `$"…"`):
when an unquoted `$` is immediately followed by `'`, consume a `$'…'` token with C-style
escape decoding (`\'`, `\"`, `\xHH`, `\NNN`, `\\`) so parity matches bash, then re-derive
`has_active_command_substitution` / `cross_line_quote_state` / `top_level_markers` from it.
Add `x=$'\''"…$(…)…"` (esc, and confirm `\x27`/`\047` already fail-closed at 20) as RED fixtures.

---

## Attack surface covered (all BLOCKED or safe unless noted)

`<<-` tab-dash nested-in-quote (N_tabdash_dq) BLOCKED · backtick payload (N_backtick) BLOCKED ·
subshell/pipeline wrappers BLOCKED · two-marker/multi-heredoc (N_multi, N_twoquote) BLOCKED ·
here-string `<<<` (N_herestring) BLOCKED · arithmetic `$(( ))` BLOCKED · nested-sub inner
quotes (N_nestedsub) BLOCKED · escaped `\"` then marker (N_escq) BLOCKED · `;#`/`(#` comment
word-boundary (N_hashsemi, N_hashparen) BLOCKED · backslash-newline continuation (N_contquote,
N_contmarker) BLOCKED · CRLF heredoc (N_crlf) fails `bash -n`→ classified but bash won't build
the heredoc (no exec) · bare `\r` / NEL `\x85` / VT `\x0b` / U+2028 / form-feed windows
(N_cr_*, N_nel, N_vt, N_u2028, N_ff_*) — none produced ALLOWED+executed (Finding-3 line-model
desync did not yield an executable case; the `bash -n` gate + cross_line raw-char walk hold).

**Only ANSI-C `$'\''` (R1) produced ALLOWED + executed.**

## Recommendations
- **CRITICAL / VETO** — do not merge as "RCE fixed." R1 ships a live RCE in the same class.
  Close the class at the source: make the shared quote model ANSI-C-aware (fix direction above).
- **WARNING** — predecessor Finding 2 (content guards miss `$(…)` in double quotes) remains the
  reason R1 is CRITICAL rather than defence-in-depth-contained; keep the follow-up ticket.
- The three known kill-shots (A2/A3/A4) are correctly fixed — that part of `224ed78b9` is sound
  and should be retained; R1 is an additional, independent hole in the same wall.

### Reproducers (under `/tmp/hd1958rv/`)
| id | file | parser (old→new) | hook | bash exec | class |
|----|------|------------------|------|-----------|-------|
| R1 esc | REPRO_ansic.txt / pl/N_ansic1 | 10 → 10 | **ALLOWED** | **YES** | **VETO — RCE live** |
| R1 hex | breadth `$'\x27'` | 20 → 20 | BLOCKED | (would exec) | fail-closed |
| R1 oct | breadth `$'\047'` | 20 → 20 | BLOCKED | (would exec) | fail-closed |
| A2 ctl | pl/ctl_A2 | 20 → 20 | BLOCKED | (would exec) | fixed ✓ |
| F1 / F_agent | pl/F1, pl/F_agent | 10 → 10 | ALLOWED | no | legit preserved ✓ |
