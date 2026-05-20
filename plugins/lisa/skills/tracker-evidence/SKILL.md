---
name: tracker-evidence
description: "Vendor-neutral wrapper for posting verification evidence. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-evidence, lisa:github-evidence, or lisa:linear-evidence. Uploads evidence to the GitHub `pr-assets` release, updates the PR description, posts a comment on the originating ticket/issue, and transitions the ticket/issue to its post-build review state."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Evidence: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor evidence skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-evidence` with `$ARGUMENTS` verbatim. Arg shape: `<TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>`.
   - `github` → invoke `lisa:github-evidence` with `$ARGUMENTS` verbatim. Arg shape: `<ISSUE_REF> <EVIDENCE_DIR> <PR_NUMBER>` where `ISSUE_REF` is `org/repo#<number>` or a GitHub issue URL.
   - `linear` → invoke `lisa:linear-evidence` with `$ARGUMENTS` verbatim. Arg shape: `<IDENTIFIER> <EVIDENCE_DIR>` where `IDENTIFIER` is a Linear Issue identifier (e.g., `ENG-123`).
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the vendor skill's output.

## Rules

- The GitHub `pr-assets` release lives on the implementation repo (the one with the PR), regardless of which tracker hosts the ticket/issue. All vendor skills upload there.
- Never post evidence to a different ticket than the one named — `$ARGUMENTS` is the source of truth.

## UI Evidence Checklist (when work is UI-visible)

Apply this when authoring `evidence/comment.md` (and `evidence/comment.txt` for JIRA wiki markup) for any ticket whose work touches a user-facing surface — bug fix, new component, new flow, UX polish, design implementation. Skip the checklist for non-UI work (API, infra, migrations, etc.); the plain-text evidence path is fine there.

The checklist is tracker-agnostic — the same shape works on JIRA, GitHub Issues, and Linear. Vendor skills only own the post/transition mechanics; the comment body is your responsibility.

1. **AI disclosure at the top.** Lead with "Update from Claude (AI agent, not a human)" and address the reporter / QA / PM by name.
2. **Own any prior mistake explicitly.** If an earlier triage or build pass got something wrong, say so up front. Don't bury it.
3. **Numbered step-by-step walk** of what you actually did in the browser/app, in plain language a non-engineer can follow:
   - Exact env (URL, viewport size — e.g. `402×874` for an iOS-sized mobile flow)
   - Login creds shape — e.g. `(000) 000-0002` + OTP `555555`
   - Exact record/player name, exact button labels as they appear on screen
   - Full happy-path **and** any non-obvious edge state worth showing (empty state, loading, post-completion)
4. **One screenshot per step**, captured live via Playwright MCP at the matching viewport. Upload via `gh release upload pr-assets <files> --clobber` and reference each one as a **plain URL** in the comment body — *not* `![alt](url)` markdown embeds. Plain URLs render as smartlinks/auto-embeds across all three trackers and stay individually viewable; markdown embeds collapse on JIRA when there are ≥2.
5. **"What this shows" section.** Tailor to ticket type:
   - **Bug repro:** state plainly whether the bug reproduces or not, and the most likely 1–2 reasons their retest still failed (different env, native app vs. web, stuck backend row, etc.).
   - **Feature/UX completion:** state plainly which acceptance criteria each screenshot covers, and call out any deferred or out-of-scope surface explicitly so QA/PM doesn't have to infer.
6. **"What would help me confirm" (bug) / "How to QA" (feature) section.** Concrete actionable retest steps with the exact selection criteria (e.g., "pick a record whose Status column shows `—`, not `Processing` or `Pending Review`").
7. **Explicit invitation to be corrected.** End with a line like *"If any of the steps I listed are different from what you expected / actually did, please tell me explicitly which step I got wrong."* Non-optional — small differences (which record, which device, exact tap order, expected behavior) change everything, and naming the door open short-circuits ticket bounce-loops.
8. **Workflow transition** is the vendor skill's job, not yours — it'll move the ticket per the configured tracker (JIRA: Reassign to reporter for bug repro / move to Awaiting QA for feature; GitHub: relabel `status:code-review` or equivalent; Linear: equivalent state). You don't transition manually.

**Why this format:** It (a) gives the reporter a frame-by-frame they can compare against, (b) avoids the JIRA image-collapse failure mode while still working everywhere else, (c) names the most plausible discrepancies up front so the loop short-circuits, (d) explicitly opens the door to being corrected so tickets don't bounce on assumed alignment. The same mechanics that resolve a stuck bug ticket also give QA an unambiguous handoff for a freshly-built feature.
