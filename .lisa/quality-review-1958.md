# Quality Review — heredoc-classifier-fps (CodySwannGT/lisa#1958)

**Reviewer:** quality-specialist (T4) · **Branch:** feat/1958-heredoc-classifier-fps · **Commits:** 77f4499a5 (RED), df5981888 (GREEN)
**Verdict: APPROVE — no blockers.** Correctness, coding philosophy, test coverage, and documentation all meet the bar. Three non-blocking suggestions below.

## Verification performed (all green)

- `bun run build:plugins` → exit 0; no working-tree drift after rebuild.
- `bun run check:plugins` → exit 0 ("Plugin artifacts are in sync… Marketplace registers every built plugin").
- `bun run check:upstream-evidence-manifest` → exit 0 (manifest at HEAD, no stale gate).
- Fan-out byte-identity: md5 of both `parity-safety-net-heredoc.py` and `parity-safety-net.sh` is identical across `src/base`, `lisa`, `lisa-agy`, `lisa-cursor`, `lisa-copilot`.
- Targeted suites: `tests/unit/hooks` = 24 files / 461 tests pass; adding the two parity mirrors (agy + opencode) = 26 files, consistent with the builder's "26 files / 469" claim. The six safety-net-focused files run 249/249 green. No `.only` / `.skip` / `fit` / `xit` anywhere.
- Live hook drives (real `parity-safety-net.sh`, JSON on stdin):
  - F1 `python3 <<'EOF'` with backtick markdown in a string → **exit 0 (allowed)**.
  - F1b/F3 unquoted delimiter with `$(date)` → **exit 2 (blocked at the wall)**.
  - F2 quoted body carrying `rm -rf /` + `$(reboot)` → **exit 2 via the rm content guard** (also self-confirmed: my own probe command was blocked by the same guard).
  - F6 non-commit heredoc denial → "**Write tool**" text; commit-shaped and `git -C /tmp/x commit …` → "**git commit -F <file>**" text (proves the inlined global-opts shape recognizes `git -C <path> commit`).

I judge the builder's full-suite evidence credible; the change surface is confined to the hook pair + tests, so targeted green is sufficient.

## Deviation 1 check (new test file vs research §3)

Research §3 predicted a new isolated-classifier file would be "a new (but consistent) convention" only if it drove `python3` directly on stdin. The builder went further toward consistency: `parity-safety-net-heredoc-literal.test.ts` drives the **shell hook** via `spawnSync("/bin/bash", [HOOK_PATH])` with JSON stdin and asserts `status` + `stderr` — the exact established `runHook` convention already used by the sibling suites. Precedent is real and the deviation is well-justified: it groups the #1958 literal-payload (F1/F2/F3/F5) and F6 remediation-text cases cohesively without bloating the 240-line main suite. Naming matches the family (`-heredoc-literal`, alongside `-heredoc`, `-guards`). File is 142 lines — comfortably within limits, so no max-lines rationale is required.

---

## Findings

### Critical (must fix before merge)
None.

### Warning (should fix)
None.

### Suggestion (nice to have)

**S1 — The git-commit detector is a hand-copied twin of the canonical `GIT_CMD`/`GIT_GLOBAL_OPTS` fragments and can silently drift.**
- **What:** `block_heredoc()` inlines the regex `…git[[:space:]]+(-[^;&|…]+…)*commit…`, which is byte-for-byte the composition `GIT_CMD + commit(…)`. But `GIT_CMD`/`GIT_GLOBAL_OPTS` are declared `readonly` later in the file (~line 165), after the heredoc dispatch runs, so the function genuinely cannot reference them.
- **Why it could matter:** If a future security fix widens `GIT_GLOBAL_OPTS` (as #1960 already did once), this copy won't follow, and `git <new-global-opt> commit …` heredoc denials would quietly regress to the wrong (Write-tool) remediation. It is *only* remediation-message accuracy — never an allow/block decision — so severity is low.
- **Where:** `plugins/src/base/hooks/parity-safety-net.sh:107-108`.
- **Fix:** The inline comment already flags the ordering constraint, which is the important part. If you want belt-and-suspenders, add a one-line pin test asserting the two regexes stay in sync, or leave a `# keep in sync with GIT_GLOBAL_OPTS below` marker on both sites. Non-blocking.

**S2 — The commit-shape grep scans the whole command, including the heredoc body.**
- **What:** The detector greps `$command_str` in its entirety. A *blocked* non-commit heredoc whose payload text merely mentions `git … commit` (e.g. a doc string) would receive the "git commit -F" remediation instead of the Write-tool one.
- **Why it could matter:** Purely cosmetic — the wrong-but-adjacent remediation text on an already-denied command. It cannot cause a bypass or a wrong allow/block. Real commit invocations and the F6 fixtures are unaffected.
- **Where:** `plugins/src/base/hooks/parity-safety-net.sh:106`.
- **Fix:** Acceptable as-is given the low stakes; if tightened later, match against the command line proper rather than the payload. Non-blocking.

**S3 — `strip_provably_literal_body()` mixes `splitlines()` with `count("\n")` for line indexing.**
- **What:** The marker line is located with `command.count("\n", 0, marker.start)` while the body is sliced from `command.splitlines()`. `splitlines()` also breaks on `\r`, `\v`, `\f`, etc., so an embedded control char could misalign the two.
- **Why it's not a problem here:** This function only ever runs when `len(markers) == 1 and markers[0].quoted` — i.e. a delimiter bash treats as literal, so any substitution token in the body is inert regardless. Worst case is losing the (redundant) heredoc *wall* for a payload bash won't expand anyway, and the **raw command still flows to every content guard** because the class stays UNSUPPORTED, never SAFE. It also matches the pre-existing `marker_is_closed()` convention, so it isn't new debt.
- **Where:** `plugins/src/base/hooks/parity-safety-net-heredoc.py:389-392`.
- **Fix:** None needed. Flagged only for awareness / future consistency. Non-blocking.

---

## What was done well

- **Correctness / mutation-proofing:** The `quoted` flag is set conservatively — full quote pair only, next char must terminate the token (`<<'EOF'X` → `quoted=False`), and `strip_provably_literal_body` is gated on `len(markers)==1 and quoted and closed`. F3 (unquoted), F4 (backslash/partial), F5 (unclosed), chained (`len>1`), and header-line `$()` outside the body window all remain fail-closed. The GREEN commit message documents the three mutations that break specific fixtures.
- **Coding philosophy:** `strip_provably_literal_body` is a pure function (no mutation of inputs, single return value per branch); the shell conditional cleanly picks one remediation and exits. No dead code — `quoted` is threaded through `Marker`, `parse_marker`, and consumed in `main()`.
- **Documentation:** The deliberate POSIX divergence (`<<\EOF`, `<<EO'F'`) is explained in-code at both `parse_marker` and the module docstring, with the "why" (parser can't *prove* non-expansion) not just the "what". The F4 test block restates it as a drift detector.
- **Test coverage:** Behavior-focused (asserts allow/block + guard-origin via stderr, not parser internals), F2 is a genuine no-bypass control (asserts the block comes from `recursive forced delete`, *not* the heredoc wall), and the fixtures pin today's F4 divergence so it surfaces if it ever regresses.
- **Commit hygiene:** Two conventional commits, RED before GREEN, `Work-Item: CodySwannGT/lisa#1958` trailer as the last line of each.
