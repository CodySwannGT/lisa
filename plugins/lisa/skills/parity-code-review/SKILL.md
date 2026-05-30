---
name: parity-code-review
description: "Lisa-native code review of the current git diff. Walks every changed hunk and reports correctness bugs, security issues, and obvious defects as severity-ranked findings with file:line references. Vendor-neutral — the cross-agent equivalent of the upstream code-review command, runnable on Codex, agy, Copilot, Cursor, and Claude."
allowed-tools: ["Read", "Bash", "Grep", "Glob"]
---

# Parity Code Review

Review the code that is *about to ship* — the current uncommitted/branch diff — for defects a reviewer would block on. This is a focused **defect hunt**: correctness, security, and obvious mistakes. It is not a style audit and not a refactor pass (use `parity-code-simplifier` for quality-only cleanup).

> **Not drift-trackable.** This skill intentionally carries **no `synced-from` pin**. The upstream `code-review@claude-plugins-official` plugin publishes **no semver** (its cache version resolves to `unknown`), so a pin would be unparseable and meaningless to `scripts/plugin-parity-drift.mjs`. Drift is tracked **manually** — re-review the upstream command by hand when the curated plugin set is refreshed. This is a Lisa-native reimplementation, **not** a port of upstream code.

## Step 1: Establish the diff

Determine exactly what changed. Prefer the broadest accurate view of the work-in-progress:

```bash
# Branch changes vs the merge base (preferred for a PR-style review)
git merge-base HEAD origin/main 2>/dev/null && \
  git diff "$(git merge-base HEAD origin/main)"...HEAD

# Plus anything still uncommitted in the working tree
git diff HEAD
git status --short
```

If there is no diff at all, say so plainly and stop — do not invent findings. If the diff is enormous, review in full but prioritize the files with the most logic changes; never silently skip files (note any you deprioritized).

## Step 2: Read for real context

Do **not** review hunks in isolation. For each changed file, open enough surrounding code to understand:

- What the function/module is supposed to do and who calls it.
- Invariants and preconditions the change might violate.
- Error/edge paths touched by the change.

Use `Read`, `Grep`, and `Glob` to follow call sites and trace data flow. A finding you can't ground in the actual code is a guess — drop it.

## Step 3: Hunt for defects

For every changed hunk, evaluate against these lenses:

1. **Correctness** — Off-by-one errors, inverted conditions, wrong operator, missing `await`, unhandled `null`/`undefined`, incorrect default, broken control flow, type coercion bugs, mutation of shared state, race conditions.
2. **Security** — Unsanitized input at trust boundaries; injection (SQL/shell/template); secrets, tokens, or keys committed or logged; missing authn/authz on new endpoints; unsafe deserialization; path traversal; overly broad permissions; SSRF.
3. **Edge cases & failure modes** — Empty collections, zero, negative numbers, very large input, concurrent calls, partial failures, timeouts, retries that aren't idempotent.
4. **Obvious defects** — Dead code paths, unreachable branches, swallowed errors, resource leaks (unclosed handles/connections), `TODO`/`FIXME` left in shipping code, debug logging left on, broken or missing tests for the new behavior.
5. **Contract & API** — Breaking changes to public signatures, changed return shapes, altered error semantics callers depend on.

## Step 4: Output — severity-ranked findings

Group findings by severity. Within each group, list the most impactful first. Every finding **must** carry a `file:line` reference.

### Critical (must fix before merge)
Bugs that break correctness, leak/expose data, or introduce a security hole.

### Warning (should fix)
Likely to cause problems later, or a real defect with limited blast radius.

### Suggestion (nice to have)
Minor correctness nits or defensive improvements.

### Finding format

For each finding:

- **What** — precise description of the defect.
- **Where** — `path/to/file.ts:42` (and a span if it covers multiple lines).
- **Why** — the concrete failure it causes, with an example input or sequence that triggers it.
- **Fix** — a specific, actionable suggestion (or a short code sketch).

Example:

> **Critical — Unhandled null dereference**
> **Where:** `src/auth/session.ts:88`
> **Why:** `findUser()` returns `null` when the id is unknown, but line 88 reads `user.roles` directly. An unknown session id (expired token replay) throws and 500s instead of returning 401.
> **Fix:** Guard `if (!user) return unauthorized()` before reading `user.roles`.

## Rules

- **Ground every finding in the diff.** No speculative findings, no generic best-practice lectures unrelated to the change.
- **Be honest about coverage.** If you deprioritized files or couldn't fully trace a path, say so.
- **If the diff is clean, say so clearly** — "No blocking issues found across N changed files" — do not manufacture problems.
- This is review-only: report findings, do **not** edit files. Apply fixes via the normal implementation flow or `parity-code-simplifier` (quality) after triage.
