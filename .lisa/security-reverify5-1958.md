# Security RE-VERIFICATION round 5 (FINAL) — #1958 heredoc classifier

Re-verification at HEAD `dcb271a75` (R4 `collapse_body_continuations`) atop `271ba9399`
(R3), `eedc02aff` (R2), `a2fae713a` (R1 ANSI-C), `224ed78b9` (per-line reset).
Predecessors: `.lisa/security-review-1958.md` (Finding 1), `-reverify-1958.md` (R1),
`-reverify2-1958.md` (R2), `-reverify3-1958.md` (R3), `-reverify4-1958.md` (R4). No code
changes this round. Every payload built from bytes in Python (`@SENT@` sentinel token
substituted at exec time; never inline in a Bash string), driven JSON-on-stdin through the
REAL fanned hook (`plugins/lisa/hooks/parity-safety-net.sh` → `parity-safety-net-heredoc.py`)
and executed under the same `/bin/bash` 3.2.57 the hook's `bash -n` gate uses, with
`touch`/`id` sentinels. Harness `/tmp/hd1958rv5/` (`harness.py`).

## VERDICT: **VETO** — two distinct, executable, ALLOWED+EXECUTED bypasses survive all five fixes.

The five landed fixes are each sound *for the shape they targeted* — every prior reproducer
(Finding-1 A2, R1, R2, R3 apostrophe/`#`, R4 `$\`-newline-split) now classifies **20 →
BLOCKED**, and every legit form (quoted-delimiter literal body, apostrophe prose, trailing-`\`
prose, `$HOME`-only, `<<-`+tabs) stays **ALLOWED with no execution** (no over-block). **But
R4's own new logic rests on a false invariant about bash, and R3's body scanner never
neutralised the flat scanner — so two live RCEs in the exact class the PR claims to wall off
remain.**

Both were proven end-to-end: `bash -n` PASS → parser **10 (UNSUPPORTED)** → hook **exit 0
(ALLOWED)** → real bash **created the sentinel**.

---

## Security (proven)

### FINDING R5a — CRITICAL (VETO): trailing `\` on the last body line swallows the terminator, pushing `$(…)` past R4's body window

`plugins/*/hooks/parity-safety-net-heredoc.py` — `unquoted_heredoc_body_has_substitution`
(L549-575) extracts the body window by matching the delimiter **per physical line**
(`candidate == marker.delimiter`, L561) and its comment (L564-571) asserts *"the terminator
was matched per physical line above (bash matches the delimiter before continuation
processing), so continuations are joined only WITHIN the body window, never across the
delimiter."* **That invariant is false.** A `\<newline>` at the end of the last body line is a
bash line-continuation that **consumes the delimiter line into the body**, extending bash's
real here-doc past the terminator the parser stops at.

- **Empirical proof of the bash semantics** (no parser involved):
  `cat <<EOF⏎foo\⏎EOF⏎bar⏎` under `/bin/bash` prints `fooEOF\nbar\n` — the `\<newline>`
  joined `foo`+`EOF` and `bar` was swallowed as body too. Bash does continuation processing
  that eats the delimiter; the parser's "per physical line" match does not.

- **Reproducers** (raw bytes; `⏎`=newline, `\`=one backslash; all end-to-end through the real hook):

  | id | payload (raw) | parser | hook | bash_exec |
  |----|---------------|--------|------|-----------|
  | R5a (X1) | `cat <<EOF⏎'foo\⏎EOF⏎$(touch @SENT@)⏎` | **10** | **ALLOWED(0)** | **True** |
  | R5a-id (X1w) | `cat <<EOF⏎'foo\⏎EOF⏎$(id > @SENT@)⏎` | **10** | **ALLOWED(0)** | **True** (`id` ran, output captured) |
  | R5a-bt (X3) | `cat <<EOF⏎'foo\⏎EOF⏎` `` `touch @SENT@` `` `⏎` | **10** | **ALLOWED(0)** | **True** |
  | R5a-rm (X4) | `cat <<EOF⏎'foo\⏎EOF⏎$(rm -rf @SENT@)⏎` | **10** | **ALLOWED(0)** | (not run — guard-blind at `/)` boundary) |

- **Mechanism (three desyncs stack):** the apostrophe `'foo` (an *odd* single quote in the
  unquoted body) (1) flips the FLAT `collapse_line_continuations` into phantom single-quote
  state, so it **refuses to remove** the `\<newline>` — leaving `'foo\` and `EOF` as separate
  lines in `logical_command`; (2) flips the FLAT `has_active_command_substitution` into the
  same phantom single-quote state, so it goes **blind** to the trailing `$(touch)`; (3) R4's
  body-window extraction matches the physical `EOF` line and stops, so the `$(touch)` sits
  *after* the window and the body scanner never scans it. `marker_is_closed` finds the physical
  `EOF` and reports "closed". Parser → UNSUPPORTED(10) → hook ALLOWED. Bash, ignoring the
  apostrophe, honours the `\<newline>`, swallows `EOF`, and runs `$(touch)` inside the extended
  body.

- **Isolating controls (HELD — pin the root cause):**
  | id | payload | parser | hook | note |
  |----|---------|--------|------|------|
  | C1 (no apostrophe) | `cat <<EOF⏎foo\⏎EOF⏎$(touch)⏎` | 20 | BLOCKED | flat collapse removes the continuation → marker unterminated → MALFORMED. Proves the apostrophe is the trigger. |
  | C3 (balanced apostrophes) | `cat <<EOF⏎'foo'\⏎EOF⏎$(touch)⏎` | 20 | BLOCKED | even `'` count → flat scanner not blinded → caught. |

- **reason:** reproducer (bash created the sentinel and ran `id` end-to-end through the real
  hook; C1/C3 controls prove parity elsewhere and pin the trigger to the odd-apostrophe +
  trailing-`\` combination) + bounded impact (arbitrary `$(…)`/backtick execution in the
  swallowed region). Directly falsifies R4's stated invariant — this is R4's own new logic.

### FINDING R5b — CRITICAL (VETO): an odd apostrophe in an unquoted body poisons the flat scanner *past* the terminator, hiding a command-proper `$(…)`

`plugins/*/hooks/parity-safety-net-heredoc.py` — `has_active_command_substitution` (L416-457)
runs one FLAT single/double-quote state machine over the whole `logical_command`, including
the unquoted here-doc body. R3 added a *separate* body-window scanner
(`unquoted_heredoc_body_has_substitution`) but **never stopped the flat scanner from
mis-reading the body**: an odd apostrophe in the body opens a phantom single-quote that
persists **after the here-doc terminator**, blinding the flat scan to a `$(…)` on the ordinary
command line that follows. `strip_provably_literal_body` only removes *quoted*-delimiter
bodies, so an unquoted body's apostrophe is never neutralised. **No trailing backslash
needed.**

- **Reproducers:**
  | id | payload (raw) | parser | hook | bash_exec |
  |----|---------------|--------|------|-----------|
  | R5b (C2min) | `cat <<EOF⏎'⏎EOF⏎$(touch @SENT@)⏎` | **10** | **ALLOWED(0)** | **True** |
  | R5b-real (C2chain) | `cat <<EOF⏎it's fine⏎EOF⏎echo $(touch @SENT@)⏎` | **10** | **ALLOWED(0)** | **True** |
  | R5b-full (C2) | `cat <<EOF⏎'foo⏎EOF⏎$(touch @SENT@)⏎` | **10** | **ALLOWED(0)** | **True** |

- **Mechanism:** bash terminates the here-doc normally at `EOF`, then runs the next line
  `$(touch …)` / `echo $(touch …)` as a real command substitution. The parser's flat scanner,
  still inside the body's phantom single-quote, never sees the `$(`; the body-window scanner
  only scans lines *before* `EOF`, so it never sees it either. Parser → 10 → ALLOWED.

- **Control (HELD):** `C2dq` = double-quote body `cat <<EOF⏎"foo⏎EOF⏎$(touch)⏎` → **20 /
  BLOCKED**: the flat scanner's *double*-quote branch detects `$(`, so only the single-quote
  (apostrophe) branch is exploitable. Isolates the defect to single-quote-state leakage.

- **reason:** reproducer (sentinel created end-to-end through the real hook; `C2dq` control
  proves the double-quote path is safe and pins the defect to apostrophe leakage) + bounded
  impact (arbitrary `$(…)` on the post-here-doc command line, triggered by a single apostrophe
  — ordinary English prose `it's` — inside a `cat <<EOF` file-write). Same "flat model diverges
  from bash inside an unquoted body" root as R3, on the region R3's body scanner did not cover.

- **Realism:** `R5b-real` is a completely ordinary agent shape — write a note containing an
  apostrophe with `cat <<EOF … EOF`, then run one more command that legitimately uses `$(…)`.
  The apostrophe in the first command silently disarms the wall for the second.

---

## Convergence sweep — targeted fixes all HELD (BLOCKED), no over-block

| id | payload | parser | hook | class |
|----|---------|--------|------|-------|
| Finding-1 A2 | `echo "⏎cat <<'EOF'⏎$(touch)⏎EOF⏎"` | 20 | BLOCKED | ✓ fixed |
| R3 apostrophe-inline | `cat <<EOF⏎it's $(touch)⏎EOF` | 20 | BLOCKED | ✓ fixed |
| R3 `#` | `cat <<EOF⏎# $(touch)⏎EOF` | 20 | BLOCKED | ✓ fixed |
| R4 `$\`-split | `cat <<EOF⏎'$\⏎(touch)⏎EOF` | 20 | BLOCKED | ✓ fixed |
| R4 weaponized | `cat <<EOF⏎'$\⏎(touch && id)⏎EOF` | 20 | BLOCKED | ✓ fixed |
| OB quoted-literal | `cat <<'EOF'⏎it's $(x) `y`⏎EOF` | 10 | ALLOWED (no exec) | ✓ legit preserved |
| OB apostrophe-prose | `cat <<EOF⏎notes: it's the plan.⏎EOF` | 10 | ALLOWED (no exec) | ✓ |
| OB trailing-`\` prose | `cat <<EOF⏎…wraps \⏎onto next.⏎EOF` | 10 | ALLOWED (no exec) | ✓ |
| OB `$HOME`-only | `cat <<EOF⏎home is $HOME⏎EOF` | 10 | ALLOWED (no exec) | ✓ |
| OB `<<-`+tabs | `cat <<-EOF⏎⇥body⏎⇥EOF` | 10 | ALLOWED (no exec) | ✓ |

Token × context matrix (unquoted body / quoted-delim body / command-proper / double-quoted /
ANSI-C-adjacent) confirmed: `$(`, `` ` ``, `${`/`$((`/`$[` are each either detected (BLOCKED) or
genuinely inert in bash — **except** the two apostrophe-leak seams above, where a
command-substitution token that bash executes is missed. `$[` / `${`/`$((` forms all contain a
contiguous `$(`-adjacent token caught by the flat/body scans unless routed through R5a/R5b.

---

## Recommendations

- **CRITICAL / VETO** — do not merge as "RCE fixed". Ship the five sound fixes (Finding-1, R1,
  R2, R3, R4-direct) and file **R5a + R5b** as a single tracked known-limitation: *the flat
  quote-state scanner mis-reads apostrophes inside an unquoted here-doc body, and the body
  window is matched per-physical-line while bash's `\<newline>` continuation swallows the
  terminator.*
- **Fix direction (self-contained, not applied):** make the flat scan here-doc-body-aware
  instead of bolting a second scanner beside it. Before running `has_active_command_substitution`,
  for every unquoted top-level closed marker: (1) compute the body window using bash's real
  continuation semantics — join `\<newline>` first, THEN match the delimiter, so a swallowed
  terminator extends the window (fixes R5a); (2) replace that body window with a
  quote/comment-neutralised copy — apostrophes, double-quotes and `#` mapped to inert bytes,
  `$(`/`` ` ``/`$((` preserved — so the flat scan neither leaks quote state past the terminator
  (fixes R5b) nor misses an in-body substitution. Equivalently: one cross-line state machine
  that knows "inside an unquoted here-doc body, quotes/comments are literal but expansion is
  live," shared by window-extraction and substitution detection. Add R5a (X1/X1w/X3) and R5b
  (C2min/C2chain) as RED fixtures; keep C1/C3/C2dq as the isolating controls.
- **WARNING (non-blocking, pre-existing)** — content guards miss `$(rm …)` at the `/)` boundary
  (predecessor Finding 2) — the reason R5a-rm is guard-blind and both findings are CRITICAL
  rather than defence-in-depth-contained. Keep that follow-up.
- **SUGGESTION (non-blocking)** — process substitution `<(…)`/`>(…)` still undetected
  (independently allowed; not a here-doc-wall escalation) and content-guard `#1982` remain
  defence-in-depth items.

## Reproducers (under `/tmp/hd1958rv5/`, harness `harness.py`)
All R5a/R5b rows: `bash -n` PASS → parser 10 → hook ALLOWED(0) → sentinel created (True).
C1/C3/C2dq/R3/R4/Finding-1: parser 20 → hook BLOCKED(2). OB rows: parser 10/ hook ALLOWED /
no exec.
