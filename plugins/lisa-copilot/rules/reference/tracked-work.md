# Tracked Work

The project tracker is the durable operator-facing record for project work. Every session that will produce a durable project outcome must establish exactly one live configured-tracker leaf before the first durable mutation. Durable outcomes include code, tests, configuration, documentation, committed research or plans, investigation findings, commits, and pull requests. Read-only questions, discussion, and repository orientation are exempt until they turn into durable work.

## Resolve, claim, bind

Use `lisa-track` as the single entry point:

1. An explicit ticket is live-read through `lisa-tracker-read` and rejected if it is missing, inaccessible, terminal, a container, outside the configured project, or outside the current repository.
2. A plain-text request or specification file is searched conservatively within the configured project. Reuse only one uniquely high-confidence matching live leaf. If no unique match exists, create exactly one complete single-repository leaf through `lisa-tracker-write`; never create a thin placeholder or a container.
3. Idempotently claim the resolved leaf through `lisa-tracker-claim`, which reuses the vendor build-intake claim semantics and post-read verifies the claimed-or-later state.
4. Before any durable repository work, persist the canonical reference with `node scripts/lisa-work-item.mjs link <ref>` and verify the worktree-local binding.

`link` is the spelling to use. `bind` is accepted as a permanent alias for the identical operation, but some agent harnesses — Claude Code's worktree isolation among them — refuse any command line containing the bare token `bind`, because it names a shell builtin that evaluates a string. Inside an isolated worktree that refusal makes the `bind` spelling unrunnable, so reach for `link` and never work around a blocked binding by hand-writing `Work-Item:` trailers.

The sequence is strict: **live validate/create -> claim -> link -> durable work**. A tracker answer of no, and any claim or binding failure, blocks the work. A tracker that cannot be reached — `gh` absent, or its credential refused — does not block a commit: the offline checks still run, the skip is loud on stderr, and the required `Work-Item Traceability` check re-runs the live checks with credentials before anything merges. Any other tracker failure still blocks. Tool presence or stale session text is not access.

## A pull request that carries several work items

One work item per pull request is the default and is what almost every branch
should do. It is not, however, a rule the commits can express on their own: an
integration or stacking branch that gathers several finished items before one
pull request has no edit to any commit that makes its range name a single item.

So the rule lives on the pull-request BODY, which is where an author can say
what a pull request is about and a reviewer can check it. The body must declare
EXACTLY the set of work items its commits carry — one `Work-Item:` line per
item. An item the commits carry and the body omits is refused; an item the body
declares and no commit carries is refused too, so padding the declaration is not
a way out. Every declared item is still proved live, open, repo-scoped, a leaf,
and (under `workItem.verify: "full"`) separately backlinked.

Batching is likewise a property of the push rather than of a branch: `git push`
carrying several ref updates validates each pushed ref on its own, exactly as if
each branch had been pushed alone.

## One canonical identity

The binding is authoritative for the worktree. Branches, commits, pull requests, usage accounting, evidence, and tracker-sync operations all carry the same canonical ref. Branch names are helpful discovery metadata but are not authoritative. After branch creation, `node scripts/lisa-work-item.mjs attach-branch` may attach the local branch to the binding.

Linkage is unconditional for an Implement flow because its input gate always establishes a work item. PR creation must pass the ref to `lisa-git-submit-pr`; `lisa-tracker-sync` must prove the reverse native link or its managed fallback.

## Binding lifetime

Binding state is local machine state and must remain untracked. Keep it through interruptions and blocked outcomes. Run `node scripts/lisa-work-item.mjs clear` only after true terminal completion: required merge/deploy/verification is complete, evidence and two-way PR linkage are recorded, and the tracker item is in its terminal state. Verify that no current binding remains before ending the completed flow.

Git hooks and CI enforce this contract but never create work items. Their recovery message directs the operator to mention the related ticket or run `/lisa:track <description>` to create and bind one.
