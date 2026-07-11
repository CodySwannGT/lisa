---
name: lisa-setup-github-repo
description: "Apply Lisa's GitHub repository governance baseline to the current project's repo: repository settings (merge-only, auto-merge, delete-branch-on-merge, update-branch suggestions, wiki off, secret scanning where available), branch + tag rulesets from Lisa templates (base PR gate with CodeRabbit/GitGuardian/Quality Checks, prevent delete, protect tags, stack overlays), and a write-access deploy key + DEPLOY_KEY secret so release workflows can push version bumps through the rulesets' DeployKey bypass. Idempotent — re-running updates settings and rulesets in place and skips an already-configured deploy key."
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
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
   - GitHub wiki tab off (Lisa projects use in-repo `wiki/`)
   - Secret scanning + push protection enabled where the plan supports it
2. **Rulesets** (`scripts/lisa-github-rulesets.sh`) from Lisa's `<type>/github-rulesets/` templates, matched by project type:
   - `base` — deletion/force-push protection on `main`/`dev`/`staging` + default, PRs required (0 approvals, review-thread resolution required, merge method = merge only), required checks: CodeRabbit + GitGuardian
   - `quality checks` — the stack's CI checks (TypeScript emoji names or Rails names)
   - `prevent delete`, `protect tags` (`v*`), plus stack overlays (`cdk validation`, staging-only `playwright`)
   - Repos without `.github/workflows/` get only app-based required checks — an Actions check that can never report would block every PR forever
3. **Deploy key** (`scripts/setup-deploy-key.sh --yes`) — write-access deploy key + `DEPLOY_KEY` secret, skipped when already configured. The `base` ruleset's `DeployKey: always` bypass is what lets CI version-bump pushes through protected branches.

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

### Step 4 — Verify

```bash
gh api "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  --jq '{allow_squash_merge, allow_auto_merge, delete_branch_on_merge, allow_update_branch}'
gh api "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/rulesets" --jq '[.[].name]'
```

Report the applied settings and ruleset names. If any step failed, surface the error — do not mark the setup complete.
