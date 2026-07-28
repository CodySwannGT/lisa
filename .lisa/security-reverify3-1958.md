# Security RE-VERIFICATION round 3 — #1958 heredoc classifier (convergence attempt)

Re-verification at HEAD `eedc02aff` (R2 blank-set fix) on top of `a2fae713a` (ANSI-C),
`224ed78b9` (per-line reset). Predecessors: `.lisa/security-review-1958.md` (Finding 1),
`.lisa/security-reverify-1958.md` (R1 ANSI-C), `.lisa/security-reverify2-1958.md` (R2
`isspace`/`splitlines`). Every payload assembled from bytes in Python (never inline in Bash),
driven JSON-on-stdin through the REAL fanned hook (`plugins/lisa/hooks/parity-safety-net.sh` →
`parity-safety-net-heredoc.py`), and every ALLOWED case executed under the same `/bin/bash`
3.2.57 the hook's `bash -n` gate uses, with `touch` sentinels. Harness `/tmp/hd1958rv3/`
(`drive.py`, `known.py`, `hunt1.py`–`hunt3.py`, `mech.py`, `overblock.py`, `provenance.py`,
`old_heredoc.py` = pre-#1958 parser @ `267757aee`).

## VERDICT: **VETO** — a FOURTH, distinct, executable desync is live (Finding R3).

The per-line-reset, ANSI-C, and blank-set holes are all genuinely closed (A2/A3/A4, R1, WS1/WS4/
WS5 re-run → BLOCKED). But `has_active_command_substitution` still applies **flat shell quote/
comment semantics to UNQUOTED heredoc body text**, where bash suppresses quote/comment processing
yet keeps command substitution active. A single apostrophe (odd `'`) or a `#` in an unquoted
heredoc body blinds the wall to a live `$(...)`/`` `…` `` that bash executes. Hook exits 0
(ALLOWED); real bash creates the sentinel.

---

## 1. Systematic string-op enumeration (the class the fixes targeted) — now bash-faithful ✅

Every Python string operation in `parity-safety-net-heredoc.py`, judged against bash's ASCII lexing:

| op / site | bash-faithful? | why |
|-----------|----------------|-----|
| `text.split("\n")` (`bash_lines`, L78) | ✅ | splits on `\n` only — the R2 `splitlines()` fix; matches `count("\n",…)` arithmetic |
| `is_bash_blank(c)=c in " \t\n"` (L58; used by all 5 walkers) | ✅ | narrowed from `isspace()` (R2 fix); no NBSP/FS/NEL/ideographic-space widening |
| `.lstrip("\t")` (`<<-` strip, L584/L594) | ✅ | **explicit tab-only arg** — strips leading TABS only, matching bash `<<-`; NOT bare `lstrip()`, so no space/Unicode over-strip (team-lead concern does not apply) |
| `.startswith("$'"/"$("/"<<"/"<<<"/"\n"/quote)` | ✅ | literal ASCII byte-prefix tests, no Unicode folding |
| `re.match(r"[A-Za-z_][A-Za-z0-9_]*")` delimiter (L492) + `DELIMITER` (L15) | ✅ | **explicit ASCII ranges**, not `\w`; non-matching delimiters fail closed (MALFORMED) |
| `.find(char/substr)` (L450/L474/L543) | ✅ | exact literal search |
| `.count("\n",…)` (L396/L582/L591) | ✅ | consistent with `bash_lines` |
| `==` delimiter/terminator compares (L204/L585/L595) | ✅ | exact byte equality = bash delimiter compare |
| `.rstrip()` (L248) | ✅ | trailing-whitespace strip on returned sanitized command; removes chars only |
| `shlex.split(posix)` / `shlex.shlex` (L165/L182) | ✅ (bounded) | shlex whitespace = `" \t\r\n"` (narrower than Unicode); `\r` rejected upstream (L214); only feeds the `gh issue/pr create/edit/comment` allowlist |
| `.strip()` in `only_whitespace`/SAFE gates (L209/L226/L237) | ⚠ minor | Unicode-whitespace strip, but only on SAFE/allowlist paths re-gated by `shell_tokens`+`is_allowed_gh`; a Unicode-whitespace-only line is not an execution vector — **not proven exploitable** |
| `BODY_CAT_MARKER` regex `\s`/`.*` sans `re.ASCII` (L16–20) | ⚠ minor | `\s` matches Unicode ws, but the SAFE body-cat path is re-gated by `shell_tokens(prefix)` char-scan + `is_allowed_gh` — **not proven exploitable** |

The string-op layer is now in lockstep with bash. **The live bypass is one level up**: the
quote/comment *state machine* itself is applied to a region (unquoted heredoc bodies) whose
semantics differ from flat shell.

---

## Security (proven)

### FINDING R3 — CRITICAL (VETO): unquoted-heredoc-body quote/comment desync smuggles a live `$(...)` past the wall

`plugins/*/hooks/parity-safety-net-heredoc.py` — `has_active_command_substitution` (L416-457)
runs a single flat single/double-quote + `#`-comment state machine over the whole command.
`strip_provably_literal_body` (L552) removes ONLY *fully-quoted-delimiter* (`<<'EOF'`/`<<"EOF"`)
bodies; an **UNQUOTED** `<<EOF` body is left in place and scanned as if it were ordinary shell
code.

- **Root cause:** to bash, an unquoted-delimiter heredoc body performs **NO quote or comment
  processing** — `'`, `"`, and `#` are literal bytes — but parameter/command/arithmetic
  **expansion stays active**, so `$(...)`/`` `…` `` in the body **executes**. The parser's flat
  scanner instead treats a body `'` as opening a single-quoted string (and a word-boundary `#`
  as starting a comment), so it goes blind to a `$(...)` that follows on the same or a later
  body line. A bare `$(...)` with no preceding quote/comment is still seen (that is why
  `cat <<EOF\n$(touch)\nEOF` is correctly MALFORMED) — but any odd `'` or `#` noise before it
  hides it. `has_active_command_substitution` returns `False`; the parser falls to
  **UNSUPPORTED(10)**; the hook **exits 0 (ALLOWED)**.

- **Reproducers** (executable end-to-end through the real hook; `bash -n` PASS → parser 10 →
  hook ALLOWED(0) → bash created the sentinel):
  | id | payload (raw) | trigger | parser | hook | bash_exec |
  |----|---------------|---------|--------|------|-----------|
  | UQ_sq_inline / MECH_prose | `cat <<EOF⏎it's $(touch …)⏎EOF` | odd `'` in prose | 10 | ALLOWED(0) | **True** |
  | UQ_squote | `cat <<EOF⏎'⏎$(touch …)⏎EOF` | lone `'` body line | 10 | ALLOWED(0) | **True** |
  | UQ_sq_bt | `cat <<EOF⏎'⏎` `` `touch …` `` `⏎EOF` | backtick behind `'` | 10 | ALLOWED(0) | **True** |
  | UQ_hash_line | `cat <<EOF⏎# $(touch …)⏎EOF` | `#` at body start | 10 | ALLOWED(0) | **True** |
  | UQ_hash_after | `cat <<EOF⏎foo # $(touch …)⏎EOF` | `#` after blank | 10 | ALLOWED(0) | **True** |
  | WEAP_prose_curl | `cat <<EOF⏎docs: it's the plan $(touch … && id)⏎EOF` | arbitrary exec proxy | 10 | ALLOWED(0) | **True** (`id` ran) |
  Isolated mechanism (`mech.py`, payload alone under bash): `MECH_prose` stdout `it's ` with the
  `$(touch)` expanded to empty and the sentinel created — the substitution really executed in the
  heredoc body.

- **Controls that HELD (isolate the defect, no over-block):**
  | id | payload | parser | hook | bash_exec | note |
  |----|---------|--------|------|-----------|------|
  | UQ_plain | `cat <<EOF⏎$(touch)⏎EOF` | 20 | BLOCKED | — | bare sub still caught — proves the wall *intends* to block this |
  | UQ_two_sq | `cat <<EOF⏎don't won't $(touch)⏎EOF` | 20 | BLOCKED | — | **even** `'` count → visible → caught |
  | UQ_dq_pair | `cat <<EOF⏎say "hi $(touch)"⏎EOF` | 20 | BLOCKED | — | `$(` inside `"…"` is detected |
  | Q_prose | `cat <<'EOF'⏎it's $(touch)⏎EOF` | 10 | ALLOWED | False | **quoted** delimiter → body truly literal → bash does not expand → correct |
  | UQ_var | `cat <<EOF⏎it's $HOME here⏎EOF` | 10 | ALLOWED | False | `$HOME` param-expand only, no command sub → correct |
  | OB_gh_writer / OB_ansic_tab / OB_tabdash / OB_legit_prose | realistic writers & legit prose | 0/10 | ALLOWED | False | no false positive |

- **Provenance:** classifies **10 on BOTH** the pre-#1958 parser (`old_heredoc.py` @ `267757aee`)
  and the fixed parser — a **pre-existing** member of the RCE class, orthogonal to Finding 1's
  per-line bug and to R1/R2, that neither the regression nor any of the three fixes touched.
  This is exactly the provenance/scope posture of R1 (ANSI-C) and R2 (`isspace`): in-scope
  because merging as "RCE fixed" ships a live RCE in the exact class the PR claims to wall off.

- **Impact:** an arbitrary expanding `$(…)`/`` `…` `` executes while the hook reports the command
  safe — RCE / exfil (`$(curl …|sh)`, proven via the `$(… && id)` proxy) appended to any
  unquoted heredoc. The trigger is a single apostrophe or `#` — i.e. ordinary English prose or a
  markdown/config comment inside a `cat <<EOF` file-write, the single most common heredoc shape
  an agent emits. Per predecessor Finding 2, `$(rm -rf /)` in this position is also guard-blind:
  `cat <<EOF\nit's $(rm -rf /)\nEOF` classified 10 and hook ALLOWED (WEAP_rm; not executed) — the
  `/)` boundary keeps the rm content guard from backstopping the destructive shape, so the wall
  is again the only defense and it is blind. Precondition is only "the agent emits this string."

- **reason:** reproducer (bash executed the sentinel end-to-end through the real hook, with the
  even-`'`, `"…"`, quoted-delimiter, and `$HOME`-only controls proving parity elsewhere) +
  bounded impact (arbitrary substitution in any unquoted heredoc body via one apostrophe or `#`)
  + old==new==10 provenance in the same class.

**Fix direction (not applied):** make the shared quote/expansion model **heredoc-aware**. When a
walker consumes an unquoted heredoc redirection (`<<DELIM` / `<<-DELIM` whose delimiter is not a
full quote pair), scan its body lines (up to the terminator) with heredoc-body semantics —
`'`, `"`, `#` are literal (do NOT change quote/comment state) while `$(`, `` ` ``, and `${`/`$((`
still count as active expansion. Equivalently and conservatively: any unquoted heredoc whose body
contains a `$(`/`` ` ``/`$((` token is MALFORMED, detected by scanning the body raw (quote/comment
suppression OFF). Add UQ_sq_inline (`it's $(…)`), UQ_squote, UQ_hash_line, UQ_hash_after as RED
fixtures and UQ_two_sq / UQ_dq_pair / Q_prose / UQ_var as the positive controls. This is the same
"model diverges from bash" root the R1/R2 fixes chased — one region (unquoted heredoc bodies) the
string-op fixes never reached.

---

## Security (unproven / out-of-scope — do NOT block on these)

### Process substitution `<(…)`/`>(…)` is not detected — but is NOT a heredoc-wall bypass
`has_active_command_substitution` detects `$(`/`` ` `` only, not `<(touch)`/`>(touch)`. So
`cat <(touch …) <<'EOF'…` classifies 10/ALLOWED and bash runs the `touch` (hunt1.py). **However**
the identical `cat <(touch …)` with **no heredoc** is ALLOWED and executes too (CTRL_PS_noheredoc,
parser not even invoked) — process substitution is independently allowed by this hook regardless
of any heredoc, so the heredoc does not *enable* it and nothing is hidden by a parser desync. A
destructive `<(rm -rf /)` is subject to the same text guards as anywhere else (and evades them
only via the pre-existing Finding-2 `/)` boundary, not via heredoc confusion). Not the #1958 wall;
noted as a defense-in-depth gap, not a veto. `impact: unproven` (no heredoc-specific escalation).

### `.strip()` / `BODY_CAT_MARKER \s` Unicode breadth on SAFE paths
Latent (see enumeration table). Re-gated by `shell_tokens`+`is_allowed_gh`; no executable case
landed. `reason: impact never reproduced` — kept here, not demoted.

---

## Security checklist
- [x] Input validation at boundary present (heredoc parser + `bash -n`)…
- [ ] …but the parser's **quote/comment model disagrees with bash for unquoted heredoc bodies**
  (Finding R3). **FAIL.**
- [x] No secrets in code or logs · [x] auth N/A · [x] no injection introduced · [x] no deps added

## Attack surface swept clean this round (no ALLOWED+executed)
String-op enumeration (all bash-faithful, above); even-`'` and `"…"` body cases (caught at 20);
quoted-delimiter literal bodies (correctly inert); `$HOME`-only expansion (no command sub);
`<<-`+tabs and `$'\t'` legit forms; realistic gh-writer/body-cat writers; A2/A3/A4 (per-line),
R1 (ANSI-C), WS1/WS4/WS5 (blank-set) all re-run → BLOCKED. **Only the unquoted-heredoc-body
odd-`'`/`#` desync (R3) produced ALLOWED + executed.**

## Recommendations
- **CRITICAL / VETO** — do not merge as "RCE fixed." R3 ships a live RCE in the same class via the
  most common heredoc shape (unquoted `cat <<EOF` + apostrophe/`#`). Make the shared model
  heredoc-body-aware (fix direction above).
- **WARNING** — predecessor Finding 2 (content guards miss `$(…)` at the `/)` boundary / in double
  quotes) remains the reason R3 is CRITICAL rather than defence-in-depth-contained; keep that
  follow-up ticket.
- **SUGGESTION** — separately, `has_active_command_substitution` ignores process substitution
  `<(…)`/`>(…)`; harmless for the wall (independently allowed) but worth a defence-in-depth note.
- The per-line-reset (Finding 1), ANSI-C (R1), and blank-set (R2) fixes are sound and should be
  retained; R3 is an additional, independent, pre-existing hole in the same wall — the string-op
  fixes closed the byte-classification desyncs but not the heredoc-body-semantics desync.

### Reproducers (under `/tmp/hd1958rv3/`)
| id | file | parser (old→new) | hook | bash_exec | class |
|----|------|------------------|------|-----------|-------|
| UQ_sq_inline | hunt2/mech | 10 → 10 | **ALLOWED(0)** | **True** | **VETO — RCE live (odd `'` prose)** |
| UQ_squote | hunt2 | 10 → 10 | **ALLOWED(0)** | **True** | VETO (lone `'`) |
| UQ_hash_line/after | hunt3 | 10 → 10 | **ALLOWED(0)** | **True** | VETO (`#` body) |
| WEAP_prose_curl | mech | — → 10 | **ALLOWED(0)** | **True** | VETO (`$(… && id)` arbitrary exec) |
| WEAP_rm | mech | — → 10 | ALLOWED(0) | (not run) | destructive shape guard-blind (Finding 2) |
| UQ_plain / UQ_two_sq / UQ_dq_pair | hunt2/3 | 20 → 20 | BLOCKED | — | wall intent confirmed / controls |
| Q_prose / UQ_var / OB_* | hunt3/overblock | — → 0/10 | ALLOWED | False | legit preserved ✓ |
| A2/A3/A4 · R1a/R1e · WS1/WS4/WS5 | known | 20 → 20 | BLOCKED | — | Findings 1/R1/R2 fixed ✓ |
