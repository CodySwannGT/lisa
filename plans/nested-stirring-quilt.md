# Self-Correction Loop as First-Class Concept

## Context

Lisa's verification framework (`verfication.md`) tells agents *how* to verify but doesn't *enforce* verification. Husky pre-commit/pre-push hooks enforce lint, typecheck, and tests at commit/push time. The gap is:

1. **No inline feedback during generation** — `lint-on-edit.sh` exists but isn't wired into settings.json. Agents accumulate lint errors across multiple files before discovering them at commit time.
2. **No enforcement of verification protocol** — agents can finish a task without declaring a verification level or producing proof artifacts. Nothing checks.
3. **No documentation of the full loop** — `verfication.md` describes verification as a one-shot activity, not an iterative generate-verify-fix cycle.

This plan adds the self-correction loop without duplicating what husky already does.

## Changes

### 1. Wire `lint-on-edit.sh` into PostToolUse pipeline

**Files:**
- `all/copy-overwrite/.claude/settings.json` (edit — add lint-on-edit.sh to `Write|Edit` matcher)
- `typescript/copy-overwrite/.claude/hooks/lint-on-edit.sh` (edit — make blocking on unfixable errors, use `additionalContext` JSON output)

**What:** Add `lint-on-edit.sh` as the third hook in the existing `PostToolUse` → `Write|Edit` matcher, after `format-on-edit.sh` and `sg-scan-on-edit.sh`. This gives the pipeline: prettier → ast-grep → eslint.

**Behavior change to lint-on-edit.sh:**
- Exit 0 when lint passes or auto-fixes succeed (current behavior)
- Exit 2 (blocking) when ESLint finds errors it can't auto-fix, with stderr feedback so Claude sees the errors immediately and fixes them before writing more files
- Use `--quiet --cache` flags for performance (skip warnings, leverage ESLint cache)
- This matches `sg-scan-on-edit.sh`'s blocking pattern (which already exits 1 on errors)

**Why not redundant with husky:** Pre-commit runs lint-staged on *staged* files at commit time. This runs on each file *as it's written*, catching errors 5-15 files earlier. Different checkpoint, same check.

### 2. Create `verify-completion.sh` Stop hook

**Files:**
- `all/copy-overwrite/.claude/hooks/verify-completion.sh` (create)
- `all/copy-overwrite/.claude/settings.json` (edit — add to Stop hooks before notify-ntfy.sh)

**What:** A Stop hook that checks whether the agent declared a verification level when the session involved code changes. It does NOT re-run lint/typecheck/tests (husky does that).

**Logic:**
1. Read transcript to check if `Write` or `Edit` tools were used during the session
2. If no code was written → exit 0 (allow stop, this was research/conversation)
3. If code was written → check last assistant message for a verification level keyword (`FULLY VERIFIED`, `PARTIALLY VERIFIED`, `UNVERIFIED`)
4. If verification level found → exit 0 (allow stop)
5. If no verification level and `stop_hook_active` is false → block with: "You changed code but didn't declare a verification level. Run your verification, then declare FULLY VERIFIED, PARTIALLY VERIFIED, or UNVERIFIED with evidence."
6. If no verification level and `stop_hook_active` is true → exit 0 (allow stop on retry — don't create infinite loops). The agent had one chance to self-correct.

**Pattern reference:** Follows `check-tired-boss.sh` structure — read transcript, extract last assistant message, check condition, output `{"decision":"block","reason":"..."}` on failure.

**Ordering in Stop hooks:** Place BEFORE `check-tired-boss.sh` and `notify-ntfy.sh` so verification enforcement runs first.

### 3. Update `verfication.md` with Self-Correction Loop section

**File:** `all/copy-overwrite/.claude/rules/verfication.md` (edit — insert new section)

**Where:** Insert between "Task Completion Rules" (line 150) and "End-User Verification Patterns" (line 153). This places the loop description right after the rules that define task completion, before the verification patterns that describe *how* to verify.

**Content:** Document the three-layer self-correction architecture:
- **Layer 1 — Inline correction (PostToolUse):** Lint/format/ast-grep feedback after every Write/Edit. Fix errors before writing more files.
- **Layer 2 — Commit-time enforcement (husky pre-commit):** Typecheck, lint-staged, gitleaks, branch protection. Already exists.
- **Layer 3 — Push-time enforcement (husky pre-push):** Full test suite with coverage, security audit, knip, integration tests. Already exists.
- **Layer 4 — Completion enforcement (Stop hook):** Verification level must be declared before task completion.
- **Regeneration over patching:** When root cause is architectural, delete and regenerate rather than incrementally patch.

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `all/copy-overwrite/.claude/settings.json` | Edit | Add lint-on-edit.sh to PostToolUse, add verify-completion.sh to Stop |
| `typescript/copy-overwrite/.claude/hooks/lint-on-edit.sh` | Edit | Make blocking on unfixable errors, add --quiet --cache |
| `all/copy-overwrite/.claude/hooks/verify-completion.sh` | Create | Stop hook enforcing verification level declaration |
| `all/copy-overwrite/.claude/rules/verfication.md` | Edit | Add Self-Correction Loop section after Task Completion Rules |

## Verification

1. **lint-on-edit.sh:** Edit a `.ts` file with a known lint error in the Lisa project → confirm the hook blocks and reports the error. Edit a clean file → confirm the hook allows through.
2. **verify-completion.sh:** Have Claude complete a task involving code changes without declaring a verification level → confirm the hook blocks with instructions. Have Claude declare a level → confirm the hook allows through. Have Claude complete a research-only task → confirm it passes without blocking.
3. **verfication.md:** Read the file and confirm the new section is properly positioned and describes the full loop.
4. **Integration:** Run `bun run lint` and `bun run typecheck` on the modified files to confirm no issues.
