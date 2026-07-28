# Resolved Input Bundle — CodySwannGT/lisa#1982

## 1. Tracker / config verification
- **tracker_provider: `github`** ✅ (`.lisa.config.json` → `"tracker": "github"`, `"source": "github"`, org `CodySwannGT`, repo `lisa`). No mismatch; proceed.
- **Base branch / deploy:** `deploy.branches.production = "main"` — single-environment repo (main = production; `status:on-dev`/`status:on-stg` are dead labels). **PR target branch: `main`.**
- **Build lifecycle labels:** ready=`status:ready`, claimed=`status:in-progress`, blocked=`status:blocked`, done(production)=`status:done`.
- **Relevant quality gates:** lintBudgets `maxLinesPerFunction: 75`, `maxLines: 300`, `cognitiveComplexity: 10`; coverage global stmts 74 / branches 65 / funcs 60 / lines 75.

## 2. Issue metadata
- **Ref:** `CodySwannGT/lisa#1982` — https://github.com/CodySwannGT/lisa/issues/1982
- **Title:** safety-net content guards miss command substitution nested in double quotes
- **State:** OPEN · **Labels:** none · **Milestone:** none · **Author:** CodySwannGT (Cody Swann) · Created 2026-07-22 · **Comments: NONE (0).** No owner decisions recorded.
- **Suggested work type:** **Bug / security-hardening fix** (guard gap). Fits `lisa:bug-fixer` / TDD reproduce-as-failing-test flow.

## 3. Full issue body (verbatim)

> ## Problem
>
> The safety-net content guards (rm/SQL/dd/custom-rule) do not catch a destructive command wrapped in a command substitution inside double quotes: a `$(...)`-wrapped catastrophic delete inside a double-quoted string is ALLOWED. This holds independent of the heredoc classifier — it is a gap in the guards themselves.
>
> Discovered during #1958's security review (Finding 2, `.lisa/security-review-1958.md`). It matters beyond a curiosity: it means the content guards are **not** a backstop for the heredoc wall — a payload that reaches the guards via an UNSUPPORTED classification is not necessarily screened for substitution-wrapped destructive commands. That coupling is why #1958's Finding 1 was rated CRITICAL rather than defence-in-depth-contained.
>
> ## Acceptance criteria
>
> - Substitution-wrapped catastrophic forms (a recursive-forced-delete of a root/home path nested inside `$(...)` within double quotes) are blocked by the content guard layer, not only by the heredoc wall.
> - Existing allow cases (a literal `$(...)` that is not a guarded destructive command) are not over-blocked beyond the documented text-scan class.
> - Fixtures driving the real hook, block/allow pairs.
>
> ## Notes
>
> Threat-model scoping applies: assess which substitution-wrapped forms are genuinely executable-destructive vs inert before widening guards, to avoid the overblocking-trains-bypass failure mode. Reproducers are in the #1958 review artifacts (`.lisa/security-review-1958.md`, `/tmp/hd1958/`).
>
> Found during #1958.

## 4. Comment summaries / owner decisions
- **Zero comments on the issue.** No owner decisions recorded.

## 5. Related issues & their relevance

| Issue/PR | State | Relevance |
|---|---|---|
| **#1958** (safety-net heredoc classifier FPs) | CLOSED / status:done | **Origin.** This ticket is Finding 2 of #1958's security review, split out as its own ticket per that review's explicit recommendation ("Recommend a separate ticket for the `$(…)` guard-boundary gap"). |
| **PR #1994** ("fix(safety-net): pass quoted-heredoc literal payloads + close heredoc-lexer RCE bypasses") | **MERGED** 2026-07-23, `Closes #1958` | Fixed #1958 Finding 1 (heredoc-wall RCE) + 5 lexer bypasses (R1–R5). **Did NOT close #1982** — the content-guard blind spot is still open. Confirms this is fresh work. |
| **#1959** (learnings ledger budget) | CLOSED | Not relevant — git-status noise, no functional relationship. Disregard. |
| **#1960** (safety-net guard parity/hardening) | referenced throughout the hook | Prior hardening pass on the SAME file (RM_CMD path-prefix, quote-aware target boundaries, GIT_GLOBAL_OPTS). Test matrix/fixtures were built for #1960 — extend that matrix. |

### Finding 2 verbatim from `.lisa/security-review-1958.md` (the exact defect)
> #### FINDING 2 — pre-existing content-guard blind spot for `$(…)` in double quotes
> `echo "$(rm -rf /)"` (single line, no heredoc) — `/tmp/hd1958/p_rm_plain.txt` — is classified SAFE(0) and **ALLOWED** on both `df5981888` and `df5981888^`. The rm content guard does not match `rm` immediately inside `$(` within double quotes. This is **pre-existing**, not this PR. It matters for severity: it means the content guards are **not a reliable backstop** when the heredoc wall is bypassed... (Demonstrated: `A6` = `$(rm -rf /)` in the fake window is ALLOWED — old parser blocked it at the wall, exit 20.) Recommend a separate ticket for the `$(…)` guard-boundary gap.

**Positive controls the fix MUST preserve:** F1 literal heredoc bodies stay ALLOWED; command-proper `$(...)` on a header line stays BLOCKED; single-quote outer wrapper (`$(...)` inside `'...'`) is inert (bash does not expand) → correctly ALLOWED.

## 6. Affected files (all under `/Users/cody/workspace/lisa`)

**Source of truth (edit here):**
- `plugins/src/base/hooks/parity-safety-net.sh` — the guard hook. Fanned *identically* (verified `diff -q`) by `scripts/build-plugins.sh` to:
  - `plugins/lisa/hooks/parity-safety-net.sh`
  - `plugins/lisa-cursor/hooks/parity-safety-net.sh`
  - `plugins/lisa-agy/hooks/parity-safety-net.sh`
  - `plugins/lisa-copilot/hooks/parity-safety-net.sh`
  - ⚠️ Do not hand-edit the fanned copies — regenerate via the plugins build (`bun run build:plugins`). Tests run against `plugins/lisa/hooks/parity-safety-net.sh`.

**Tests / fixtures (add block+allow pairs here):**
- `tests/helpers/safety-net-guard-fixtures.ts` — the fixture matrix ("tables ARE the contract"). Existing `QUOTE_BOUNDARY` rows (`QB-B1`..`QB-B6`, `QB-A1`..`QB-A3`) cover `bash -c "rm -rf /"` boundaries but **NOT** the `$(...)`-in-double-quotes case. Add new rows (e.g. a `SUBST_BOUNDARY` group).
- `tests/helpers/safety-net-guard-harness.ts` — drives the REAL hook; `HOOK_PATH = plugins/lisa/hooks/parity-safety-net.sh`.
- `tests/unit/hooks/parity-safety-net-guards.test.ts` — the guards test consuming the fixtures.

**Reference artifacts:**
- `.lisa/security-review-1958.md` — Finding 2 + reproducer table (untracked local file).
- `/tmp/hd1958/` reproducers — ephemeral; may be gone. Canonical reproducer is just `echo "$(rm -rf /)"`.

## 7. Root-cause pointer (for the implementer)
Gap is in the **rm content-guard layer** of `parity-safety-net.sh`:
- rm-statement splitter (`tr '&|;' '\n'`, L291) + `RM_CMD` (L187) DO match `rm` inside `$(rm …` (the `(` is a valid non-alnum boundary), so the statement reaches the target checks.
- **`RM_CATASTROPHIC_TARGET` (L208–209) fails:** trailing boundary class `qc="'\""` is only space/`'`/`"`. In `echo "$(rm -rf /)"` the target `/` is followed by `)`, not in the class → no match.
- **Token-walk guard 1b (L244–289) fails:** `"$(rm` → strip one leading `"` → `$(rm`, which ≠ `rm`/`*/rm`, so `seen_rm` never trips.

Fix direction (respect "don't overblock"): make the target-boundary class and/or token normalization aware of a `$(`…`)` command-substitution wrapper so an executable substitution-wrapped `rm -rf <catastrophic>` inside double quotes is caught, while leaving inert single-quoted `'$(...)'` and non-destructive literal `$(...)` allowed. Threat-model each form (double-quoted = expands = executable; single-quoted = inert) before widening.

## 8. Summary fields
- **work_item_ref:** `CodySwannGT/lisa#1982`
- **tracker_provider:** `github`
- **target environment / base branch:** none stated → default **`main`** (single-env, production=main)
- **suggested work type:** **bug / security-hardening fix** (TDD: reproduce `echo "$(rm -rf /)"` as a failing block-fixture, tighten the rm content guard, add block/allow pairs, regenerate fanned plugin copies)
- **owner decisions in comments:** none (zero comments)
- **parity obligation:** single source `plugins/src/base/hooks/parity-safety-net.sh` → 4 fanned copies via `build:plugins`; keep all in sync.
