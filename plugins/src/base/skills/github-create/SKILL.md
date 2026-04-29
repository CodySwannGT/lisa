---
name: github-create
description: This skill should be used when creating GitHub Issue Epics, Stories, and Sub-tasks from code files or descriptions. It analyzes the provided input, determines the appropriate issue hierarchy, and creates issues with comprehensive quality requirements including test-first development and documentation. The GitHub counterpart of lisa:jira-create.
allowed-tools: ["Read", "Glob", "LS", "Skill", "Bash"]
---

# Create GitHub Issues from $ARGUMENTS

Analyze the provided file(s) and plan a GitHub Issue hierarchy. **This skill plans structure only — every individual issue write is delegated to `lisa:github-write-issue` (which itself goes through the `lisa:tracker-write` shim when invoked from a vendor-neutral caller).** Do not call `gh issue create` from this skill; the necessary write invocations belong to the writer skill so the gates can never be bypassed.

## Process

1. **Analyze**: Read `$ARGUMENTS` to understand scope.
2. **Extract source artifacts**: invoke the `lisa:jira-source-artifacts` skill (vendor-neutral), then enumerate every external URL, embed, attachment, or example payload in the input and classify each by domain per its rules. Build the `artifacts` map (one entry per artifact: url, title, domain, source page, classification reason).
3. **Walk the live product** (when applicable): if the work touches existing user-facing surfaces, invoke the `lisa:product-walkthrough` skill.
4. **Determine structure**:
   - Epic needed if: multiple features, major changes, >3 related files.
   - Direct Tasks if: bug fix, single file, minor change.
5. **Plan hierarchy**:

   ```text
   Epic → Story → Sub-tasks (test, implement, document, cleanup)
   ```

6. **Delegate every write to `lisa:github-write-issue`** in dependency order (Epic first, then Stories with the Epic as parent sub-issue, then Sub-tasks with their Story as parent). Pass artifacts (filtered by domain per `lisa:jira-source-artifacts` inheritance rules) and walkthrough findings (under `## Current Product`).
7. **Run the artifact preservation gate** (`lisa:jira-source-artifacts` §8): after all writes complete, build the preservation matrix and verify every extracted artifact is reachable from the created issues. Fail loudly if anything was dropped.

## Mandatory for Every Code Issue

**Test-First**: Write tests before implementation
**Quality Gates**: All tests/checks must pass, no SonarCloud violations
**Documentation**: Check existing, update/create new, remove obsolete
**Cleanup**: Remove temporary code, scripts, dev configs

## Validation Journey

Issues that change runtime behavior should include a `## Validation Journey` section. This section is consumed by `lisa:github-journey` to automate verification. Use `lisa:github-add-journey` to draft + append the section after creation.

## Source Artifacts

If `$ARGUMENTS` references any external artifact — PRD, design doc, Figma URL, Lovable prototype, Loom walkthrough, screenshot, example payload — those references MUST be preserved as `## Links` and `## Source Artifacts` sections on the created issues. Silent artifact loss is the single most common quality failure in this pipeline.

**Invoke `lisa:jira-source-artifacts`** for the canonical rules: domains, per-tool classification, source precedence, conflict handling under `## Open Questions`, inheritance from epic → story → sub-task, and the existing-component reuse expectation. This skill is vendor-neutral and used by both the JIRA and the GitHub paths.

When delegating actual writes to `lisa:github-write-issue`, pass the extracted artifact list so its Phase 4c (Remote Links / Source Artifacts) step attaches them.

## Live Product Walkthrough

When the work touches existing user-facing surfaces, invoke `lisa:product-walkthrough` before drafting issues. The findings become inputs to the issue plan and surface under `## Current Product` on the resulting issues.

## Issue Requirements

Each issue must clearly communicate to:

- **Coding Assistants**: Implementation requirements
- **Developers**: Technical approach
- **Stakeholders**: Business value

Default repo: from `.lisa.config.json` `github.org` / `github.repo` (override via arguments).

## Delegation to github-write-issue

**Mandatory.** Every issue created by this skill MUST go through `lisa:github-write-issue`. This skill never calls `gh issue create` itself — that invocation belongs to the writer.

`lisa:github-write-issue` enforces:
- 3-audience description (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Parent sub-issue validation (non-bug, non-epic types)
- Explicit relationship discovery (`Blocks` / `Blocked by` / `Relates to` / `Duplicates` / `Cloned from`)
- Remote links (PRs, Confluence, dashboards)
- Single-repo scope check for Bug / Task / Sub-task
- Sign-in account and target environment recorded in body
- Post-create verification

### Invocation order

Issues must be created in parent-before-child order:

1. Invoke `lisa:github-write-issue` for the Epic. Capture the returned issue number.
2. For each Story, invoke `lisa:github-write-issue` with the Epic ref as `parent_ref`. Capture each Story number.
3. For each Sub-task, invoke `lisa:github-write-issue` with the Story ref as `parent_ref`.

### What to pass to each invocation

For every delegated write, pass:
- The summary, issue type, repo (org/repo), and priority you decided
- The body with all sections drafted (Context / Technical Approach / Acceptance Criteria / Out of Scope / etc.)
- Gherkin acceptance criteria
- `parent_ref` (Epic ref for Stories; Story ref for Sub-tasks)
- The artifact list extracted in "Source Artifacts", filtered by domain per the inheritance rules — `lisa:github-write-issue` Phase 4c attaches them
- For runtime-behavior issues: instruct the writer to call `lisa:github-add-journey` after create

### What this skill is responsible for

- Deciding the *shape* of the hierarchy (what's an Epic vs. Story vs. Sub-task).
- Drafting the body and acceptance criteria from the input.
- Extracting and classifying source artifacts.
- Threading parent refs through subsequent writes.
- Running the preservation check after all writes complete.

It does not own the actual `gh issue create` call — that's `lisa:github-write-issue`'s job.
