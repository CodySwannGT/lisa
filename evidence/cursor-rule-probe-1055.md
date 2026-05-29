# Empirical cursor-agent rule-probe — issue #1055

> ⚠️ **CORRECTION / SUPERSEDED METHOD — read the task #8 section below first.**
> Run 3 ("POSITIVE CONTROL … via `--plugin-dir`") in this initial probe ran with
> tools UNRESTRICTED, so the agent answered by `grep`-ing the rule file under
> `--plugin-dir` (a file read), NOT by Cursor auto-applying the rule. `cursor-agent
> --plugin-dir` does NOT inject a plugin's `rules/*.mdc` into model context (proven
> in the task #8 section: run D = UNKNOWN, 0 tool calls). The load-bearing,
> contamination-free proof is the task #8 A/B/C runs at the canonical
> `.cursor/rules/` location (no-tools instruction + 0-`tool_call` assertion). Runs 1
> and 2 here remain valid (the buggy nested `.md` layout is indistinguishable from
> "no rule"); only run 3's *mechanism* was mis-attributed.

**Date:** 2026-05-29
**Tool:** `cursor-agent` v2026.05.28-418efe5 (logged in)
**Goal:** Prove the current `plugins/lisa-cursor/` rule layout (`rules/eager/*.md`)
is NOT applied by Cursor's native loader, and that the post-fix shape (top-level
`rules/<name>.mdc` with `alwaysApply: true` frontmatter) IS applied.

## Method

Same prompt to all three runs:

> What is the cursor rule codeword? If you do not see a rule defining it, reply exactly: UNKNOWN

A rule planted the directive: *"If asked for the cursor rule codeword, reply
exactly: ZEBRA-1055-OK"*. If the rule reaches the agent, it answers `ZEBRA-1055-OK`;
otherwise `UNKNOWN`.

Invocation: `cursor-agent --plugin-dir <dir> --force -p --output-format text "<prompt>"`

## Runs

| # | Condition | Plugin dir | Rule layout | Result |
|---|-----------|-----------|-------------|--------|
| 1 | EXPERIMENT | copy of `plugins/lisa-cursor` | codeword appended to `rules/eager/base-rules.md` (CURRENT buggy layout) | **UNKNOWN** |
| 2 | CONTROL (baseline) | none | no rule present at all | **UNKNOWN** |
| 3 | POSITIVE CONTROL | copy of `plugins/lisa-cursor` | codeword as top-level `rules/probe-codeword.mdc` w/ `alwaysApply: true` (POST-FIX shape) | **ZEBRA-1055-OK** |

## Raw output

```
=== EXPERIMENT: --plugin-dir buggy variant (rules under rules/eager/*.md) ===
UNKNOWN

=== CONTROL: no plugin dir (no rule present at all) ===
UNKNOWN

=== POSITIVE CONTROL: post-fix shape (top-level .mdc, alwaysApply:true) ===
ZEBRA-1055-OK
```

## Conclusion

- The current Cursor variant delivers rules **zero times**: run 1 (buggy layout) is
  indistinguishable from run 2 (no rule at all) — both `UNKNOWN`.
- The post-fix shape (top-level `.mdc` + `alwaysApply: true` frontmatter) delivers
  the rule correctly: run 3 returns the planted codeword.
- This is the empirical companion to the failing unit tests in
  `tests/unit/scripts/generate-cursor-plugin-artifacts.test.ts` (mismatch #1 and
  #4). It confirms the prior architecture-doc claim "Cursor auto-loads `rules/`
  natively" is FALSE for the nested `rules/eager` layout — Cursor reads top-level
  `rules/*.mdc` only.

---

# Real-rule end-to-end probe (verifier, task #8) — 2026-05-29

**Tool:** `cursor-agent` v2026.05.28-418efe5 (logged in).
**Goal:** Close the spec-review caveat by verifying on the REAL regenerated
`plugins/lisa-cursor` artifacts (not a synthetic codeword), from an EMPTY cwd with
no ambient `.cursor/rules`.

## Method refinement (important correction to the synthetic probe above)

The synthetic probe quoted content **without restricting tools**. In `cursor-agent`
headless `-p` mode the agent "has access to all tools, including write and shell"
(per `cursor-agent --help`). Capturing `--output-format stream-json` shows the agent
satisfies a content-quoting prompt by **`grep`-ing the files under `--plugin-dir`**
(a `grepToolCall` against `<plugin>/rules`), NOT from auto-injected rules. So a
"quote this string" prompt proves only that the **file is present and readable** —
which is true for ANY layout (flat `.mdc` *and* old nested `.md`), and therefore
does NOT prove Cursor's native rule loader *applied* the rule.

To isolate genuine auto-application we add two controls to every run:
1. An explicit **"do NOT use any tools; answer only from already-loaded context"**
   instruction.
2. A **`stream-json` assertion that zero `tool_call` events fired** (no file reads).

A rule that is genuinely auto-injected answers with **0 tool calls**.

The distinctive verbatim target is the **Pace** sentence that appears only in the
real eager `base-rules` rule: *"A fast wrong answer is worse than a slow correct one."*

## Runs (all: `-p --output-format stream-json`, no-tools instruction, tool_call count asserted)

| # | Condition | Delivery / location | Ext + frontmatter | tool_calls | Result |
|---|-----------|---------------------|-------------------|-----------:|--------|
| A | **NEW (real generated)** | `.cursor/rules/base-rules.mdc` (canonical native location; real generated file copied verbatim) | `.mdc`, `alwaysApply:true` | **0** | **Pace sentence — APPLIED** ✅ |
| B | **OLD (real deleted)** | `.cursor/rules/eager/base-rules.md` (original pre-fix file from `git show HEAD`) | `.md`, no frontmatter | **0** | **UNKNOWN — not applied** ❌ |
| C | Synthetic native reference | `.cursor/rules/probe.mdc` | `.mdc`, `alwaysApply:true` | **0** | `NATIVE-RULE-7799` — APPLIED ✅ |
| D | NEW via `--plugin-dir` | `<abs>/plugins/lisa-cursor` (real regenerated plugin) | `.mdc`, `alwaysApply:true` | **0** | **UNKNOWN** ⚠️ |
| E | Control: no plugin, empty cwd | none | — | **0** | UNKNOWN ✅ |

(With tools UNRESTRICTED, runs against `--plugin-dir` return the Pace sentence in
BOTH the flat-`.mdc` and old-nested-`.md` layouts via `grepToolCall` — confirming the
content-quote method is contaminated by file-read access and must not be used as
proof of application.)

## Conclusions (load-bearing)

1. **The fix is correct and necessary.** The clean A vs B comparison — identical
   canonical location, 0 tool calls, no file-read contamination — shows the
   generated shape (`.mdc` + `alwaysApply:true`) is **APPLIED** by Cursor's native
   rule loader, while the old shape (`.md`, no frontmatter) is **NOT** (`UNKNOWN`).
   Run C confirms the frontmatter contract generically.
2. **Correction to the prior `--plugin-dir` claim.** `cursor-agent --plugin-dir`
   does **not** inject a plugin's `rules/*.mdc` into the model context in headless
   `-p` mode (run D = `UNKNOWN`, 0 tool calls, even with `--trust`). The synthetic
   probe's "positive control via `--plugin-dir`" above was file-read (grep)
   contamination, not auto-application. The faithful runtime harness is the
   **canonical `.cursor/rules/` install location** that a plugin install
   materializes — and the real generated artifact loads correctly there (run A).
3. **Scope.** The generator's job is to emit correctly-shaped Cursor artifacts;
   that is proven empirically (run A). Whether `--plugin-dir` should also inject
   rules is a `cursor-agent` CLI limitation, not a defect in this diff — analogous
   to the established "plugin-hook FIRING is not CLI-verifiable" caveat.

## Hook / MCP shape (shape only — firing not CLI-verifiable)

- `plugins/lisa-cursor/hooks/hooks.json` present, wrapped + camelCase
  (`{version, hooks:{preToolUse:[{command:"./hooks/block-no-verify.sh", matcher:"Bash"}],
  sessionStart:[…]}}`), relative `./hooks/*.sh` commands. ✅
- `plugins/lisa-expo-cursor/mcp.json` present (no leading dot),
  `{mcpServers:{expo:{type:"http", url:"https://mcp.expo.dev/mcp"}}}`;
  `.mcp.json` (dotted) correctly absent. ✅

## Recommendation (non-blocking)

The generator header comment (`scripts/generate-cursor-plugin-artifacts.mjs`, "…
verified empirically with `cursor-agent --plugin-dir`") and the synthetic
"POSITIVE CONTROL … via `--plugin-dir`" framing above overstate the CLI's behavior.
Suggest the implementer reword to "verified via the generated `.mdc` loaded at the
canonical `.cursor/rules/` location" to match what is actually reproducible.
