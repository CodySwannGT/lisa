---
name: lisa-parity-coderabbit
description: "Thorough PR-style review of the full diff — bugs, security, performance, and maintainability — with concrete suggested fixes and a structured summary. An independent Lisa-native review skill that does NOT call CodeRabbit's service or port its code. Vendor-neutral cross-agent equivalent of the upstream coderabbit plugin, runnable on Codex, agy, Copilot, Cursor, and Claude."
allowed-tools: ["Read", "Bash", "Grep", "Glob"]
synced-from: coderabbit@claude-plugins-official@1.1.1
---

# Parity CodeRabbit

A comprehensive, PR-grade code review of the **entire diff** — the kind of pass a senior reviewer (or an automated reviewer like CodeRabbit) gives before approving. Where `parity-code-review` is a tight defect hunt, this skill is **broad and thorough**: it covers bugs, security, performance, *and* maintainability, suggests concrete fixes, and ends with a reviewer-style summary and verdict.

> **Independent reimplementation.** This skill is **not** a wrapper around CodeRabbit's hosted service and does **not** port or invoke CodeRabbit's code. It is a Lisa-native review that produces a comparable artifact using only the model and local tooling. No network calls to any review SaaS are made.
>
> **Drift tracking.** Pinned to `coderabbit@claude-plugins-official@1.1.1`. `scripts/plugin-parity-drift.mjs` compares this pin against the upstream version in the plugin cache and flags staleness. Reimplemented from scratch — **do not port or copy upstream plugin code.**

## Step 1: Assemble the full review surface

Gather the complete change set the way a PR review would see it:

```bash
# Full branch diff vs merge base
BASE="$(git merge-base HEAD origin/main 2>/dev/null)"
git diff "$BASE"...HEAD
git diff "$BASE"...HEAD --stat        # file-by-file overview
git log "$BASE"..HEAD --oneline       # commit narrative
git diff HEAD                         # uncommitted work
```

Read the commit messages and (if available) the PR/ticket description to understand **intent** — a review judges the change against what it was meant to do, not just what it does.

## Step 2: Build context per file

For each changed file, `Read` the surrounding code and use `Grep`/`Glob` to follow callers, dependents, and tests. Note the change's blast radius: public API, shared modules, migrations, config, and anything downstream consumers rely on.

## Step 3: Review across all dimensions

Apply the `convergent-review` rule before deciding severity or whether a finding
blocks merge. Bias toward merge: block only concrete correctness, security,
data-loss, or contract-violation failures with evidence. Lint-owned style,
formatting, taste, and speculative maintainability improvements are non-blocking
unless the work item or repository rules explicitly make them release criteria.

Walk every meaningful hunk and evaluate each dimension. A finding in any dimension is fair game.

1. **Correctness / bugs** — Logic errors, off-by-one, inverted conditions, missing `await`, null/undefined handling, type coercion, broken control flow, incorrect defaults, mutation of shared state, race conditions, broken or missing tests for new behavior.
2. **Security** — Injection (SQL/shell/template), unsanitized boundary input, secrets/keys/tokens in code or logs, missing or broken authn/authz, unsafe deserialization, path traversal, SSRF, overly broad permissions, dependency vulnerabilities introduced by the change.
3. **Performance** — N+1 queries, work inside hot loops, unnecessary allocations or re-renders, missing indexes, blocking I/O on hot paths, unbounded growth, accidental O(n²), redundant network/database round-trips, large bundle additions.
4. **Maintainability** — Duplication, dead code, unclear naming, overly long/complex functions, missing or misleading docs, leaky abstractions, inconsistent patterns, hidden coupling, magic numbers, and violations of the project's conventions (immutability/functional style, statement order, barrel-export integrity, "never edit generated plugin artifacts").
5. **Test coverage** — Are the new branches and edge cases tested? Do tests assert behavior rather than implementation? Are failure paths covered?

## Step 4: Suggest concrete fixes

For each finding, give a **specific, actionable** fix — ideally a short code sketch or a `diff`-style suggestion, not vague advice. The reader should be able to act on it without re-deriving the problem.

## Step 5: Output — structured review

Produce a review document with these sections:

### Summary
2–4 sentences: what the change does, overall quality, and the headline risks. State a verdict: **Approve**, **Approve with nits**, or **Request changes**.

### Findings by severity
Group as **Critical → Major → Minor → Nit**. Every finding includes:

- **What** — the issue, and which dimension it falls under (bug / security / perf / maintainability / tests).
- **Where** — `path/to/file.ts:line`.
- **Why** — the concrete consequence, with a triggering example where relevant.
- **Blocking** — `yes` only for concrete correctness/security/data-loss/contract failures; otherwise `no`.
- **Failure scenario** — the concrete user, operator, security, or factory outcome if the change ships as-is.
- **Evidence** — the cited file, observed behavior, command output, or contract that proves the scenario is reachable.
- **Fix** — a concrete suggestion or code snippet.

### Walkthrough (optional but encouraged)
A brief per-file note on what changed and any file-specific observations — the orientation a human reviewer leaves so the next reader understands the diff quickly.

### Strengths
Call out what's done well. A credible review is balanced, not only critical.

## Rules

- **Cover the whole diff.** If you deprioritize anything for size, say which files and why — never imply full coverage you didn't give.
- **Ground every finding in the code.** No generic checklists detached from the actual change; no speculative findings you can't point to.
- **Malformed blockers do not block.** If you cannot name a concrete failure scenario and evidence, report it as non-blocking context or omit it.
- **Concrete fixes only.** "Consider improving error handling" is not a finding; "wrap the `fetch` in try/catch and return a 502 on network error at `api/proxy.ts:31`" is.
- **No external review service.** Use only local git/tooling and the model — this is an independent review, not a CodeRabbit proxy.
- **Review-only.** Report findings; do not edit files. Route fixes through the implementation flow, `parity-code-simplifier` (quality), or a follow-up.
- **If the diff is clean, approve it plainly** and say why — do not invent problems to look thorough.
