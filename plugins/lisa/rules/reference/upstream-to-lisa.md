# Upstream To Lisa

When working in a project that has Lisa installed, you will sometimes find that the **real fix belongs upstream in Lisa**, not in this project. This rule defines what to do so the fix is both unblocking *now* and durable *later*.

## When this applies

You are working in a downstream/host project (not the Lisa source repo) and you discover one of:

- A bug or gap in a Lisa-distributed **template, rule, skill, agent, hook, or CI workflow**.
- A **governance pattern** discovered here that should be generalized back into Lisa's templates so every project benefits.
- Anything where the file you want to change is **Lisa-managed** — it carries Lisa governance markers, lives in a path Lisa owns, or any edit would be **overwritten on the next `lisa apply`**.
- Anything where the root cause is in a Lisa **create-only** template, even if the generated file says Lisa will not overwrite it.

The defining test: **does the root cause live in a Lisa-distributed artifact?** If yes, file upstream. The wipe-out test is a sufficient signal, not the only signal.

| Template class | Local fix survives `lisa apply`? | Why it is still upstream-worthy |
| --- | --- | --- |
| **copy-overwrite** (managed) | No — clobbered on next apply | The local fix is throwaway; without the upstream fix it re-breaks. |
| **create-only** (first setup) | Yes — Lisa never overwrites it | No existing repo self-heals, and every newly scaffolded repo inherits the bug. |

For create-only files, header text such as `Lisa will not overwrite it` is a **positive** upstream signal, not a reason to stay local. Keep the downstream fix because Lisa will not replace it, and still file upstream so future projects receive the corrected template.

## What to do — both steps, always

### 1. Fix it locally so you are not blocked

Apply the stopgap in this project so you can keep working. Do **not** stall waiting for an upstream fix to land.

- For copy-overwrite files, treat the local change as temporary: it will be clobbered when the upstream fix ships and Lisa re-applies.
- For create-only files, keep the local change: Lisa will not overwrite it. The upstream issue is still mandatory because new projects keep inheriting the broken template until Lisa changes.

### 2. File an upstream issue in the Lisa repository

Use the `github-write-issue` skill (`lisa-github-write-issue`) to create a GitHub Issue **in Lisa's source repository `CodySwannGT/lisa`** — not in this project's own repo. The skill uses the `gh` CLI; the target repo must be `CodySwannGT/lisa` (e.g. `gh issue create --repo CodySwannGT/lisa ...`), because the agent's default repo is this host project.

The issue should capture, following the skill's three-audience / acceptance-criteria conventions:

- **Root cause** — which Lisa template/rule/skill/agent/hook/workflow is wrong or missing, with the path under `plugins/src/...` (or the relevant template source) if known.
- **Symptom** — what broke or was missing in *this* project, and how it surfaced. Reference this project so the fix can be validated against a real case.
- **Proposed durable fix** — the change to make in Lisa's source so it propagates to all projects on the next apply.
- **Local stopgap applied** — note that a local fix is in place here, whether it is temporary copy-overwrite work or a retained create-only patch.

## Do not

- Do **not** only fix it locally and move on. For copy-overwrite files, the local fix is throwaway and re-breaks on the next apply. For create-only files, the local fix survives, but the broken template still ships to every new project.
- Do **not** edit Lisa's templates from inside this project. You are not in the Lisa repo; those edits don't exist upstream and get overwritten — they create the illusion of a fix while the real source stays broken.
- Do **not** file the issue in this project's own repo. The durable fix is tracked in `CodySwannGT/lisa`.

## Access fallback

If you lack permission to create an issue in `CodySwannGT/lisa`, do not silently drop it. Surface the situation to the user along with the fully-drafted issue contents (root cause, symptom, proposed fix, local stopgap), so a human can file it or grant access.

## Not applicable inside the Lisa repo itself

When you are already working **inside the Lisa source repo** (`CodySwannGT/lisa`), this rule does not apply — the fix is local to that repo, so make it directly in `plugins/src/...` (and rebuild artifacts) rather than filing an issue against yourself.
