# Research — #1957 Linear bare repo-name label (T1)

Source file: `all/copy-overwrite/scripts/lisa-work-item.mjs` (the installed copy; root `scripts/lisa-work-item.mjs` is a 5-line re-import shim — `scripts/lisa-work-item.mjs:1-5` — never edit it).
Test file: `tests/unit/scripts/lisa-work-item.test.ts`.

## 1. assertRepoScope semantics

Definition — `all/copy-overwrite/scripts/lisa-work-item.mjs:428-439`:

```js
function assertRepoScope(ref, contract, labels, components = []) {
  const expected = `repo:${contract.identityRepo}`.toLowerCase();
  const labelNames = namesFrom(labels);
  const componentNames = namesFrom(components);
  if (
    !labelNames.includes(expected) &&
    !componentNames.includes(contract.identityRepo.toLowerCase())
  ) {
    throw new TrackingError(
      `Work item ${ref} is not scoped to repository ${contract.identityRepo}; require label ${expected}`
    );
  }
}
```

- **Signature:** `(ref, contract, labels, components = [])`. Accept iff label list contains exactly `repo:<identityRepo>` (lowercased) OR component list contains bare `<identityRepo>` (lowercased). The bare name is ALREADY accepted — but only via `components`, which only Jira supplies.
- **Repo-scope NAME derivation:** `contract.identityRepo` = `currentRepoIdentity(config)` (`lisa-work-item.mjs:205-218`): `config.repo ?? config.github.repo` → `GITHUB_REPOSITORY` env → `git remote get-url origin`; each candidate goes through `repoBasename` (`:198-203`): `trim()`, strip trailing `.git`, `split(/[/:]/)`, take last segment → the repo **short name** (e.g. `frontend`, never `owner/frontend`). The label suffix must equal that short name. NOT parsed from `contract.repository` (that is the GitHub queue repo only).
- **Normalization:** `namesFrom` (`:420-426`) accepts strings or `{name}` objects, drops non-strings, lowercases each. **No trim on label names** (identityRepo is trimmed upstream by `repoBasename`). Match is exact-string after lowercase — no substring/prefix acceptance (the T3 security requirement already holds today; preserve it in the bare arm).
- **repositoryIsIdentity:** GitHub-contract-only field (`trackerContract`, `:236-239`): true when the queue repository equals `org/github.repo` case-insensitively. Sole consumer: `githubIssue` at `:542-544` — `if (!contract.repositoryIsIdentity) assertRepoScope(...)` — i.e. the scope check is **skipped entirely** when binding from the identity repo itself; it only runs with a distinct `github.queueRepo`. Jira/Linear contracts (`:241-268`) have no such field — they always check.
- **Exact rejection template:** `Work item ${ref} is not scoped to repository ${contract.identityRepo}; require label ${expected}` (`:437`).
- **Tests pinning the message** (all pin only the prefix via `toContain`; NONE pin the `require label ...` tail):
  - `tests/unit/scripts/lisa-work-item.test.ts:423` — GitHub lane: "not scoped to repository identity"
  - `tests/unit/scripts/lisa-work-item.test.ts:672` — Jira acli lane: "not scoped to repository widgets"
  - `tests/unit/scripts/lisa-work-item.test.ts:811` — Linear lane: "not scoped to repository widgets"
  - Repo-wide grep for "require label" / "is not scoped to repository" outside the source hits nothing else (only `.lisa/plan-1957.md`). No docs-guard pins this wording → the message tail can safely be rewritten to name both accepted forms, provided the `not scoped to repository <name>` prefix survives.

## 2. Vendor paths — one shared call site per vendor, single function

- **Linear:** `linearIssue` (`:697-770`) fetches GraphQL `labels{nodes{name}}` and calls `assertRepoScope(ref, contract, issue.labels?.nodes)` at `:759` — **labels only, no 4th arg** → `components` defaults `[]`, so the bare-name component alias is unreachable on Linear. That is the bug: Linear has no component field, and Sentry-origin issues carry bare `frontend`.
- **GitHub:** `githubIssue` calls `assertRepoScope(ref, contract, issue.labels)` at `:543` — also labels-only, guarded by `repositoryIsIdentity`.
- **Jira:** both credential paths pass labels AND components (`:614-619` curl, `:672-677` acli) — bare name already accepted there via the component alias.
- All vendors call the **same single function**; there is no vendor fork. An Option-A edit inside `assertRepoScope` (accept bare `<identityRepo>` in `labelNames` too) is **naturally uniform** across GitHub/Jira/Linear.
- **Recommendation: uniform** — the intake convention is documented as "uniform across trackers (JIRA / GitHub / Linear)" (`plugins/lisa/rules/reference/config-resolution.md:949`), and Jira already accepts the bare name via components, so a uniform bare-label arm symmetrizes an existing acceptance instead of forking per vendor. (GitHub identity-repo binds skip the check anyway; only split queue-repo setups even reach it.)

## 3. Intake-side rule the fix mirrors

- **In-repo canonical convention** — `plugins/lisa/rules/reference/config-resolution.md:949`: "A work item target repo is recorded as a **label** `repo:<name>`, where `<name>` is the repo short name (e.g. `repo:frontend`). The convention is uniform across trackers (JIRA / GitHub / Linear) ... On JIRA a **component** equal to the repo name is accepted as an alias". And `:973`: "The match is by repo short name (`repo:<CURRENT_REPO>`), case-insensitive." (Mirrored at `plugins/lisa-cursor/rules/config-resolution-reference.mdc:954,973` and copilot/base variants.)
- **The "match both" rule** the issue cites is NOT yet in Lisa repo docs — it lives in TunnlAI project memory: `~/.claude/projects/-Users-cody-workspace-tunnlai-projects-frontend/memory/linear-repo-label-taxonomy.md`: "`repo:frontend` / `repo:backend` / `repo:infrastructure` — the Lisa repo-binding trio. Every *planned* work item uses these. bare `frontend` / `backend` — Sentry-origin labels, applied only to crash issues backfilled from Sentry. ... How to apply: When scoping intake or queries to a repo, filter on `repo:frontend OR frontend`". Sibling memory `...-tunnlai-projects-tunnl-backend/memory/tun-backend-intake-label-gap.md:16` documents the same two-family taxonomy.
- Issue #1957 body states it directly: "mirroring the intake-side rule that repo-scoped queries must match both `repo:<name>` and bare `<name>`" and "bare labels mark Sentry provenance; `repo:*` marks planned work".
- **Cite in the fix:** issue #1957 + `config-resolution.md:949/:973` (uniform across trackers, exact short name, case-insensitive). No in-repo doc forbids bare acceptance on the read side; `plugins/lisa/scripts/queue-status-build-readers.mjs:112-127` filters on the `repo:` family for queue counting only — out of scope here.

## 4. Test conventions for the Linear lane + where R1 lives

- Harness: `createFixture()` (`tests/unit/scripts/lisa-work-item.test.ts:92+`) builds a temp git repo with a `fake-bin/` on PATH holding shell shims for `gh`, `acli`, `curl`. The Linear lane runs through the **fake `curl`**, which echoes env var `FAKE_CURL_JSON`; `LINEAR_API_KEY: "fake-linear-key"` is preset at `:109`. Default `FAKE_CURL_JSON` (`:103`) is a LIN-12 GraphQL payload labeled `repo:widgets` / `status:in-progress` / `type:Task`.
- Linear contract stub pattern: `createFixture({ tracker: "linear", repo: "widgets", linear: { workspace: "acme", teamKey: "LIN" } })` then `command(fixture, ["bind", "LIN-12"], { env: { FAKE_CURL_JSON: ... } })`.
- The Linear negative-path test is `it("rejects wrong-repo, unclaimed, and container Linear issues")` at `:779` inside `describe("provider liveness")` (`:619`), with a local `response(labels, children)` JSON helper at `:785-800`.
- **R1 location:** `describe("provider liveness")`, adjacent to `:779` — e.g. `it("accepts a bare repo-name label on the Linear lane (#1957 R1)")` using `response(["widgets", "status:in-progress", "type:Task"])` → expect status 0. Controls that must stay red: no scope label at all; bare wrong repo `response(["backend", ...])`; `repo:other` (already covered at `:803-812`) → status 1 + "not scoped to repository widgets".
- GitHub parity pin (if uniform adopted): extend the queue-repo test near `:386-423` (fixture `github: { org: "acme", repo: "identity", queueRepo: "acme/widgets" }`, `FAKE_GH_ISSUE_JSON`) with a bare `identity` label acceptance case.

## 5. Recent history — no collision

`git log` for the file shows only 3 commits: `bdedff6e4` (#1956 sync lanes), `8df8de3b1`, `d557349e1` (introduced the script). `git log -L 428,440` shows `assertRepoScope` written once in `d557349e1` and never modified since; the `bdedff6e4` diff contains **0** occurrences of `assertRepoScope` (it touched `parsePushLines` / `assertStateBranch` / rebase-merge lanes only). `0e0b56561` adjusted branch-sync prose/test pins only. The region is collision-free, and the file was last touched on this very branch.

## Implementation notes for T2

- Edit source only: `all/copy-overwrite/scripts/lisa-work-item.mjs:428-439` — add `labelNames.includes(contract.identityRepo.toLowerCase())` as a third acceptance arm; update the message to name both forms while keeping the `is not scoped to repository <name>` prefix (all three test pins use `toContain` on that prefix).
- Mutation-proof: the `repo:other` control (`:811`) plus a new bare-`backend` control kill an accept-any-label mutant.
- Same-commit requirement: `bun run build:upstream-evidence-manifest` (template/source edit → stale-manifest CI gate).
- Full `bun run test` before commit (#1956 lesson).
