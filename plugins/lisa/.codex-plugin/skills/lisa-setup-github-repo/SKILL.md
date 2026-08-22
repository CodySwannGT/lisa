---
name: lisa-setup-github-repo
description: "Apply Lisa's GitHub repository…"
allowed-tools: ["Bash", "Read", "Edit", "AskUserQuestion"]
---

# Setup GitHub Repository Governance

Apply the fleet-standard GitHub repository configuration to this project's repo. The settings, rulesets, and deploy key that used to be clicked together by hand for every new repo are applied here as one scripted flow.

## What gets applied

1. **Repository settings** (`scripts/lisa-github-repo-settings.sh`)
   - Merge commits on; squash and rebase merging **off** (merge-only policy)
   - Merge commit title/message from the PR (`MERGE_MESSAGE` / `PR_TITLE`)
   - Auto-merge **on** — per-repo opt-out via `.lisa.config.json`:
     ```json
     { "github": { "settings": { "allow_auto_merge": false } } }
     ```
     (any key under `github.settings` overrides the baseline)
   - Delete head branches after merge (environment branches survive — the rulesets' `deletion` rule means GitHub refuses to delete them)
   - "Always suggest updating pull request branches" on
   - Default branch set to the lowest-tier environment branch that exists (dev → staging → main); override with `github.settings.default_branch`
   - GitHub wiki tab off (Lisa projects use in-repo `wiki/`)
   - Secret scanning + push protection enabled where the plan supports it
2. **Rulesets** (`scripts/lisa-github-rulesets.sh`) — one generated from config, the rest from Lisa's `<type>/github-rulesets/` templates matched by project type:
   - `base` — **generated from `.lisa.config.json`**, not shipped as a template. Deletion/force-push protection from `policy.protect`, the branch list from `policy.ruleset.include_refs`, bypass actors from `policy.ruleset.bypass_actors`, approvals from `policy.review`, merge methods from `policy.merge`, and required checks from whatever gates the project `await`s. A project that declares nothing gets exactly the ruleset the retired `all/github-rulesets/base.json` described, minus its two vendor checks — those are now `await` declarations a project can choose not to make
   - `quality checks` — the stack's CI checks (TypeScript emoji names or Rails names)
   - `prevent delete`, `protect tags` (`v*`), plus stack overlays (`cdk validation`, staging-only `playwright`)
   - Repos without `.github/workflows/` get only app-based required checks — an Actions check that can never report would block every PR forever
   - **A template change never reaches an already-configured repo on its own** — re-running this step is the migration. Each context the run newly makes blocking is printed as `+ now required: <context>`, and a ruleset that already satisfies its template reports `nothing to do` and is not sent at all, so a second run is visibly a no-op
   - **Declaring a ruleset's required list makes it declarative.** By default a live-only required context is preserved, never dropped. Name a ruleset in `github.rulesets.requiredChecks` and the live list stops being unioned in, so removing an entry actually stops requiring it — printed as `- no longer required: <context>`. The retired `addRequiredChecks` is still read and could only ever add
3. **Deploy key** (`scripts/setup-deploy-key.sh --yes`) — write-access deploy key + `DEPLOY_KEY` secret, skipped when already configured. The `base` ruleset's `DeployKey: always` bypass is what lets CI version-bump pushes through protected branches.
4. **Deployment environments** (`scripts/lisa-github-environments.sh`) — entirely optional; only runs when `.lisa.config.json` declares environments:
   ```json
   {
     "github": {
       "environments": {
         "production": {
           "branch": "main",
           "require_approval": true,
           "reviewers": ["some-user", "some-org/some-team"],
           "prevent_self_review": false,
           "wait_timer": 0
         },
         "staging": { "branch": "staging" }
       }
     }
   }
   ```
   - Environment names are friendly names (`production`), mapped to branches. Branch resolution order: explicit `branch` → `deploy.branches[<name>]` → the name itself.
   - `require_approval: true` provisions **required reviewers** (usernames or `org/team-slug`, max 6) — GitHub pauses any workflow job bound to the environment until a listed reviewer approves it in the Actions UI. Reviewers are mandatory when `require_approval` is true; the script refuses a gate nobody can approve.
   - Every declared environment also gets a **deployment branch policy** pinned to its branch, so only that branch can deploy to it.
   - Provisioning matters: GitHub silently auto-creates an environment **without** protection rules the first time a workflow references it, so an unprovisioned approval gate gates on nothing.
   - The stack `deploy.yml` templates read this same config at runtime and pass `require_approval`/`approval_environment` to `release.yml`, whose `release_approval` job is where the run pauses. Requires a public repo or a paid plan for private repos (the script skips gracefully otherwise).
5. **Policy reconciliation** (`scripts/lisa-reconcile-policy.mjs`, also `npm run policy:reconcile`) — compares the DECLARED gates and `policy` block against what GitHub actually has, and converges it when `policy.on_drift` is `repair`. It runs here rather than only from a skill file, because a declaration nothing applies is not governance.
   - The installed `scripts/lisa-reconcile-policy.mjs` is preferred; the shipped template is the fallback; finding neither is a hard failure, not a skip.
   - Exit `2` is `UNPROVEN` — `gh` refused, is missing, or answered something unparseable. A private repository on a plan without rulesets answers `403`. Setup **warns and continues**: failing for a plan limitation punishes a repository that has done nothing wrong. The warning names the state, because a blind gate that says nothing is indistinguishable from a clean one.

## Workflow

### Step 1 — Locate the scripts

In the Lisa repo itself, use `scripts/` directly. In a downstream project, use the installed package:

```bash
LISA_SCRIPTS=$(ls -d node_modules/@codyswann/lisa/scripts 2>/dev/null || echo scripts)
```

### Step 2 — Dry-run and show the plan

```bash
bash "$LISA_SCRIPTS/lisa-github-repo-setup.sh" --dry-run .
```

Present what would change. If the repo already matches the baseline, say so and stop.

### Step 3 — Apply

```bash
bash "$LISA_SCRIPTS/lisa-github-repo-setup.sh" .
```

Requires `gh` authenticated with **admin** permission on the repo. A 403 on rulesets means the plan doesn't support them (private repo on a free personal plan) — settings and deploy key still apply; the script skips rulesets gracefully.

### Step 4 — Wire the approval gate into an existing deploy.yml (guided edit)

Only when `.lisa.config.json` has a `github.environments` entry with `require_approval: true` AND `.github/workflows/deploy.yml` exists but does not reference `approval_environment`:

```bash
[ -f .github/workflows/deploy.yml ] \
  && jq -e '[.github.environments // {} | .[] | select(.require_approval == true)] | length > 0' .lisa.config.json > /dev/null 2>&1 \
  && ! grep -q 'approval_environment' .github/workflows/deploy.yml \
  && echo "deploy.yml needs approval wiring"
```

A `grep` hit is only a first pass — before skipping the edit, read the `release` job's `with:` block and confirm it actually passes both `require_approval` and `approval_environment` from the `determine_environment` outputs (a commented-out or unrelated occurrence doesn't count as wired).

`deploy.yml` is create-only — the project owns it, so Lisa never patches it automatically. Show the user the two changes from the current stack template (`<stack>/create-only/.github/workflows/deploy.yml` in the Lisa repo) and offer to apply them via Edit:

1. In `determine_environment`, add a checkout step plus the `🚦 Resolve approval gate from .lisa.config.json` step, and expose the `approval_environment` / `require_approval` outputs.
2. In the `release` job's `with:` block, replace `require_approval: false` with:
   ```yaml
   require_approval: ${{ needs.determine_environment.outputs.require_approval == 'true' }}
   approval_environment: ${{ needs.determine_environment.outputs.approval_environment }}
   ```

Skip this step (and say why) if the project's deploy.yml doesn't call Lisa's `release.yml` (rails uses `release-rails.yml` and harper-fabric has no release call — approval gating for those stacks is not wired yet).

### Step 5 — Verify

```bash
gh api "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  --jq '{allow_squash_merge, allow_auto_merge, delete_branch_on_merge, allow_update_branch}'
gh api "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/rulesets" --jq '[.[].name]'
```

When environments were configured, also confirm each one carries its protection rules and branch policy:

```bash
gh api "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/environments" \
  --jq '.environments[] | {name, protection_rules, deployment_branch_policy}'
```

For every environment declared in `github.environments`, treat a missing `deployment_branch_policy` — or, when `require_approval` is true, an empty `protection_rules` — as a failure: the environment exists but is unprotected, so an approval gate bound to it would block nothing.

Report the applied settings, ruleset names, and environments. If any step failed, surface the error — do not mark the setup complete.
