---
name: lisa-agent-ready
description: "Make a brownfield project agent-ready: build the initial knowledge wiki from everything the agent can reach (repository, git history, connected trackers, docs, observability), then write wiki/gaps.md — the questions only a human can answer before agents can operate the project autonomously. Iterative convergence: humans answer the gaps inline, a fresh session re-runs the skill, verified answers are absorbed into wiki pages, and the loop repeats until a run reports zero open gaps and declares the project agent-ready. This is the knowledge half of brownfield onboarding; standards adoption (applying Lisa's lint rules, guardrails, and thresholds, then refactoring to conform without changing behavior) follows it."
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch"]
---

# Agent-Ready Onboarding: $ARGUMENTS

Run this skill as if the following is literally true — it is the operating premise, not a
role-play flourish:

> **Starting tomorrow, you — the agent — maintain this project without any human input. Today is
> your only chance to ask questions.** Use the existing connections, the git history, the tracker,
> the docs, and anything else you have access to, to build the initial knowledge wiki. Critically:
> write down every gap a human must fill in **today** for you to be able to operate autonomously —
> the questions you would otherwise have to guess at tomorrow.

Greenfield projects start agent-ready by construction. Brownfield projects carry years of tacit
knowledge in heads, not files — this skill converges that knowledge into the wiki before the
factories are allowed to run unattended.

## What counts as a gap (the judgment rule)

A **gap** is something that is (a) not derivable from any source you can reach, and (b) dangerous
to guess — guessing would risk business logic, product intent, money, data, security, or an
irreversible external effect. Examples: "why does the billing cutoff run at 02:00 and what breaks
if it moves", "which of these two payment flows is the live one", "who are the users of the admin
panel and what must never change for them".

**Not a gap**: anything you can derive by reading harder — architecture, conventions, test
behavior, deploy topology, dead code. Derive it and write it into the wiki instead. A lazy gap
that a later reader could have answered from the repository is a defect of this skill's output.

## Phases

### Phase 0 — Preflight

1. Ensure the knowledge wiki exists. If the project has no `wiki/`, install it first (delegate to
   the wiki install/setup surface — `/lisa:wiki:install` / `lisa-wiki-setup`); do not hand-roll a
   wiki layout.
2. Inventory every reachable source: the repository and its full git history, the configured
   `tracker` and `source`, connected MCP servers and access layers (observability, docs,
   analytics), CI history, deployed environments named in config. Record the inventory in the wiki
   so later runs and later agents know what was consulted.
3. Detect a prior run: if `wiki/gaps.md` exists, this is an **absorption run** — go to Phase 3
   first, then re-audit.

### Phase 1 — Ingest

Delegate to the wiki's ingestion surface (`lisa-wiki-ingest` and its connectors) across the
repository, the git history, and each connected source from the Phase 0 inventory. Bounded and
resumable — prefer several focused ingests over one unbounded crawl.

### Phase 2 — Deep-read for autonomy

Beyond raw ingestion, author the pages an unattended operator needs, deriving everything derivable:
architecture and domain glossary, environment/deploy topology, who the users are (personas, if
discoverable), business rules encoded in code and tests, operational runbooks (how to see logs,
how to roll back), and the project's danger zones (migrations, money paths, irreversible jobs).
Update `wiki/index.md` and record the run in `wiki/log.md` per wiki conventions.

### Phase 3 — Absorb answered gaps (re-runs only)

For each gap in `wiki/gaps.md` a human has answered inline:

1. Verify the answer against reachable sources where possible; ask-back in the gap entry (keep it
   `open` with a follow-up question) only when the answer is contradictory or incomplete.
2. Absorb the verified answer into the proper wiki page(s) — the wiki is the durable home, the
   gaps file is a queue, not a knowledge store.
3. Mark the entry `absorbed` with a pointer to the page(s) it landed in, and move it to the
   resolved section of the file.

Never treat your own inference as a human answer, and never resolve an open gap by guessing.

### Phase 4 — Gaps audit

Regenerate the open section of `wiki/gaps.md` (create it on the first run). Every entry is written
for a **non-technical operator** — plain language, no stack traces, no repo jargon — because the
person answering may not code:

```markdown
## Open gaps (answer inline under each question, then re-run /lisa:agent-ready in a new session)

### <stable-slug>
- **Question**: <one plain-language question>
- **Why it blocks autonomy**: <what an unattended agent cannot safely do without this>
- **What was searched**: <the sources consulted before declaring this a gap>
- **How to answer**: <where the answer likely lives / what format is useful>
- **Answer**: _(human fills in)_
- **Status**: open
```

Order entries by autonomy impact (what would cause the worst unattended decision first). Keep the
file short — a gaps file with fifty entries means Phase 2 stopped too early.

### Phase 5 — Converge and report

- **Open gaps remain** → report the count and the top items, and instruct: a human answers inline
  in `wiki/gaps.md`, then re-runs `/lisa:agent-ready` in a **new session** (a fresh session avoids
  anchoring on this run's assumptions). Commit the wiki changes through the normal wiki PR flow.
- **Zero open gaps** → declare the project **agent-ready for knowledge**: record the verdict and
  date in the gaps file header and the wiki log, and point at the next step — standards adoption.

## After convergence: standards adoption

Knowledge first, standards second. Once the loop reports no gaps, apply Lisa's full standards
(lint rules, guardrails, thresholds) and expect the project to go red — that is the point. Agents
then refactor the codebase to conform **without changing business logic or functionality**, via
the existing improve/fix flows, proving behavior is preserved with the test suite and empirical
verification. Only then should the automation fleet run unattended on a brownfield project.

## Rules

- Never invent an answer to an open gap; the entire value of the file is that its answers came
  from humans.
- Gap entries are product-readable (factory-model rule: write outward for a non-technical
  operator).
- Idempotent: re-runs regenerate the open section in place and never lose or reword a human's
  inline answers.
- The wiki is the durable store; `wiki/gaps.md` is a queue. Every absorbed answer must land in a
  real wiki page with the gaps entry pointing at it.
- Follow the wiki's own conventions for commits, `wiki/index.md`, and `wiki/log.md` — this skill
  adds no parallel bookkeeping.
