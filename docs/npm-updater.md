# Opt-in selected npm updates

The reusable [npm updater](../.github/workflows/npm-updater.yml) prepares one selected npm update in one committed npm project directory, allocates its canonical leaf, runs ordinary gates and publishes the exact gated commit. It has no schedule. The host owns cadence and exact package versions in its committed `.lisa.config.json`. Supported shapes are the root npm project and committed npm subdirectory projects. Each targets `main` unless its policy names another configured deploy branch (see [Target branch](#target-branch)). Work items can be tracked in GitHub Issues, Jira or Linear (see [Jira and Linear tracking](#jira-and-linear-tracking)); the code host is GitHub in every case.

## Jira and Linear tracking

A project that tracks work in Jira or Linear can turn the updater on. Each selected update gets one build-ready work item in that project's own tracker. It carries the same leaf text as a GitHub issue, and the same claim and checkpoint records, stored as tracker comments. The code host is still GitHub: allocation still reads the repository and the configured target branch (`main` by default) from GitHub, signs with GitHub attestations and publishes through GitHub.

What each tracker needs in the committed `.lisa.config.json`:

| Tracker | Required keys | `maintainer` is | Secrets the caller passes |
|---|---|---|---|
| `github` | `github.org`, `github.repo` | the GitHub login | none |
| `jira` | `jira.project`, `jira.claimActorRef`, and `atlassian.cloudId` or `atlassian.site` | the Jira account ID | `JIRA_API_TOKEN`, `JIRA_LOGIN` |
| `linear` | `linear.teamKey`, `linear.workspace`, `linear.claimActorRef` | the Linear user ID | `LINEAR_API_KEY` |

Three more keys apply only to Jira and Linear:

- **`jira.claimActorRef` / `linear.claimActorRef` (required).** The Jira accountId or Linear user id of the account the updater's credential signs in as. Claims, checkpoints and closures count as the updater's own only when this account wrote them. If the key is missing, or the credential signs in as a different account, every phase stops before it changes anything and says which key to fix.
- **`npmUpdater.cancelOperator` (required to cancel or replace an update).** A cancel is a manual run of the GitHub workflow, so it is authorized by a GitHub login. On a GitHub-tracked project that is the maintainer. A Jira or Linear maintainer is not a GitHub account, so name the GitHub login of the person allowed to run the cancel. They need write or admin on the repository. If the key is missing, the cancel stops and names the key. No other repository writer is allowed instead. The key is refused on a GitHub-tracked project.
- **`jira.trustedHumanActorIds` / `linear.trustedHumanActorIds`.** The Jira accountIds or Linear user ids of the people whose release comment may lift a `human-needed` hold. If a held item's project has no such list, the hold stays and the run says that the list is missing.

`npmUpdater.repository` must match `automationProvenance.repository`, the GitHub code-host repository. If `github.org` and `github.repo` are also set, it must match them too.

The lifecycle names come from the same keys the build-intake skills read: `jira.workflow.*` and `linear.workflow.*`. The defaults are `Ready`, `In Progress`, `Code Review`, `Blocked`, and `On Dev`/`On Stg`/`Done`. A cancelled or replaced item moves to `jira.workflow.canceled` (default `Won't Do`) or `linear.workflow.canceled` (default: the team's one workflow state of type canceled). Allocation creates the work item as a Task with Medium priority, assigns it to the maintainer, and puts it in the configured ready status. Claiming it moves it to the configured in-progress status. The updater never creates statuses, issue types or priorities. If one is missing from the project's vocabulary, allocation stops before it creates anything and says so. If a Jira ticket is created but its workflow then offers no single transition to the ready status, allocation stops and names the ticket: move it to the ready status by hand (or fix the workflow) and rerun. Status, issue type and priority are read from the tracker's own fields. A typed label that looks like one of them (such as `In Progress`, `type:Task` or `priority:medium`) is ignored. The `human-needed` label still places a hold. In Jira, each work item also carries the label `lisa-npm-<selection key>`. That is how a re-run finds the same item instead of filing a second one. Jira's search can miss a ticket created moments earlier, so the updater also records each ticket it creates on its own Jira account (a user property) and adds that ticket to the next search. A retry inside that window finds it instead of filing a duplicate. Linear labels, sub-issues and relations are read page by page. Only an item with more than 1,000 of one of them stops the run, and the message names that item.

Credentials are read from these environment variables only:

- Jira: `JIRA_API_TOKEN` and `JIRA_LOGIN` (or `atlassian.email` from config).
- Linear: `LINEAR_API_KEY`.

The reusable workflow forwards exactly these three secrets, `JIRA_API_TOKEN`, `JIRA_LOGIN` and `LINEAR_API_KEY`. The aliases `ATLASSIAN_API_TOKEN` and `LINEAR_API_KEY_<workspace>` are also accepted, but only when you run the updater locally from the command line; the workflow never passes them.

The Jira token is sent to `https://api.atlassian.com/ex/jira/<atlassian.cloudId>` or, when there is no cloud ID, to the `atlassian.site` origin from the committed config. `JIRA_SERVER` is not read. Point `atlassian.site` only at your own Jira site.

If a credential is missing, allocation fails before it makes any request, and the error names the variable. Use a dedicated account for the credential: a person's account or an app/service account both work. Every comment that account writes counts as written by the updater. Jira, Atlassian and Linear credentials are removed from the environment of ordinary hooks and nested tools, the same way the GitHub token is.

> **Note:** CodySwannGT/lisa#4859 asked for `JIRA_EMAIL`. Lisa uses `JIRA_LOGIN` instead, because that is the name its other Jira workflows and scripts already use. Set `JIRA_LOGIN`; `JIRA_EMAIL` is not read.

Pass the secrets to the reusable workflow. They are optional, so GitHub-tracked callers pass nothing and the workflow contract major stays `1`. The workflow gives them only to the steps that call the tracker: cancel, allocate, checkpoint and publish. The gate step never gets them, because the updated dependency code runs there. The gate checks the work-item reference offline, and the live claim is checked at checkpoint and again before publishing:

```yaml
jobs:
  update:
    uses: CodySwannGT/lisa/.github/workflows/npm-updater.yml@REVIEWED_IMMUTABLE_COMMIT
    with:
      expected_workflow_contract_major: '1'
    secrets:
      JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
      JIRA_LOGIN: ${{ secrets.JIRA_LOGIN }}
      # or, for a Linear-tracked project:
      # LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

The signed artifacts carry the tracker's own reference: `<PROJECT>-<N>` for Jira and `<TEAM>-<N>` for Linear, in the descriptor's `workItem` and in the commit's `Work-Item:` trailer. A reference in any other tracker's format fails verification. GitHub-tracked projects keep `owner/repo#N`, byte-identical to before.

The work-item description and the updater's comments appear as one code block in Jira and Linear. That is how their exact bytes survive, including the hidden filing and proposal markers. Every write is read back and must match exactly. If a person edits the description, the updater stops instead of claiming the item.

Every phase runs for Jira and Linear (CodySwannGT/lisa#4873):

- **Publish** opens the pull request on GitHub with `Work-Item: <KEY>-<N>` and no GitHub issue link. It writes one `[lisa-pr-link]` backlink comment on the work item and reads it back. A rerun finds that comment and writes nothing.
- **Cancel and supersede** move the old item to the canceled status or state. The updater then reads the Jira changelog or the Linear history to confirm its own account made that move. If someone else closed the item, the updater leaves it alone and says so.
- **Resuming an interrupted run:** before the checkpoint was signed, run the workflow again: allocation finds the same item and creates nothing new. After it was signed, a rerun resumes the signed origin. The tracker credential proves the claim, the item's sole owner and its assignability, and GitHub proves the runs and the destination branch.

## Multiple npm project directories

`npmUpdater` is either one policy object (the root project, unchanged) or a list of up to eight policy objects with the same fields, one per directory:

```json
{
  "npmUpdater": [
    { "version": 1, "repository": "owner/repo", "directory": ".", "target": "main", "maintainer": "maintainer-login", "packages": [{ "name": "package-name", "version": "1.2.3" }], "lisaOwner": "absent" },
    { "version": 1, "repository": "owner/repo", "directory": "externals", "target": "main", "maintainer": "maintainer-login", "packages": [{ "name": "other-package", "version": "4.5.6" }], "lisaOwner": "absent" }
  ]
}
```

Rules every entry must meet, all checked before any npm work:

- `directory` is `"."` or a normalized relative path: one to eight segments, each starting with a letter, digit or underscore and using only letters, digits, `_`, `.` and `-`. Absolute paths, `.`/`..` segments, trailing slashes and any `node_modules` segment are refused. Directories are unique across the list.
- A subdirectory is npm-only. It must be a committed real directory holding regular committed `package.json` and `package-lock.json` files and no `bun.lock` of its own, committed or not. A root `bun.lock` belongs to the root project; a subdirectory proposal neither reads nor changes it.
- A subdirectory entry uses `lisaOwner: "absent"` and has no `runtime` profile. Lisa ownership and the Rails runtime stay root-only.
- `tracker` is `github`, `jira` or `linear` (see [Jira and Linear tracking](#jira-and-linear-tracking)).
- `target` is optional and defaults to `main`; see [Target branch](#target-branch).
- The workflow and the hosted gate install the root before running the ordinary hooks. A root with a `package-lock.json` installs with `npm ci`, exactly as before. A root that uses only Bun (a `bun.lock` with no `package-lock.json`) installs with `bun install --frozen-lockfile --ignore-scripts` instead, and the gate checks that `bun.lock` and the root `package.json` keep their bytes. On such a root only a subdirectory npm project can be updated, because there is no root npm project; the updater never changes the root `bun.lock`.

Each run updates exactly one directory, chosen by the reusable workflow's `directory` input (default `"."`). A subdirectory proposal changes exactly `<directory>/package.json` and `<directory>/package-lock.json`. Its leaf is titled `Update selected npm dependencies in <directory>`, and its signed descriptor carries the directory. A root-only policy keeps byte-identical proposal keys, policy digest and leaf text, so existing root leaves and checkpoints remain valid. Updating several directories means several runs, for example one matrix job per directory:

```yaml
jobs:
  update:
    strategy:
      fail-fast: false
      matrix:
        directory: ['.', 'externals']
    uses: CodySwannGT/lisa/.github/workflows/npm-updater.yml@REVIEWED_IMMUTABLE_COMMIT
    with:
      expected_workflow_contract_major: '1'
      directory: ${{ matrix.directory }}
```

### Target branch

`target` names the one branch the updater bases its proposal on and opens its pull request into. It defaults to `main` when omitted. A project that integrates on another branch, for example one that promotes `dev` → `staging` → `main`, sets it to that branch:

```json
{ "deploy": { "branches": { "dev": "dev", "staging": "staging", "production": "main" } },
  "npmUpdater": { "version": 1, "repository": "owner/repo", "directory": ".", "target": "dev", "maintainer": "maintainer-login", "packages": [{ "name": "package-name", "version": "1.2.3" }], "lisaOwner": "absent" } }
```

- A target other than `main` must be one of the `.lisa.config.json` `deploy.branches` values, so the leaf's Target Backend Environment and Branch Plan can be derived from it. Any other value is refused with a message naming the target and the allowed branches. Branch names must be valid Git branch names.
- The branch must exist on the remote. Preparation exits non-zero naming a missing branch, before any work item or pull request is created.
- The caller passes the same branch as the workflow's `target_branch` input (default `main`). The prepare job runs only when the run's ref is `refs/heads/<target_branch>`, and every phase refuses a `target_branch` that differs from the committed `target`. Trigger the caller on that branch:

```yaml
on:
  push:
    branches: [dev]
jobs:
  npm-update:
    uses: CodySwannGT/lisa/.github/workflows/npm-updater.yml@main
    with:
      target_branch: dev
```

- Selection, the hosted gate, publication, cancellation and provenance all use the target: the base read, the run and certificate refs, and the pull request base. A non-`main` target is signed into the descriptor, recovery and cancellation records. A `main` or omitted target keeps byte-identical selection keys, signed artifacts and leaf text, so existing callers change nothing.
- Trigger the caller with `push` or `workflow_dispatch` on the target branch. GitHub runs a `schedule` trigger on the default branch only, so a scheduled caller skips prepare for any target that is not the default branch.
- One policy targets exactly one branch.

Upgrade the managed Lisa scripts and the committed `automationProvenance.signerDigest` together before you add a subdirectory entry or a non-`main` target. Older hook verifiers do not know the signed `directory` or `target` fields, so they refuse those proposals rather than accept them.

When the original commit also contains a regular text `bun.lock`, preparation uses genuine Bun 1.4.4 to update that lock with lifecycle scripts disabled. Both native npm ci and frozen Bun installation must preserve the prepared bytes. The proposal and signed descriptor bind the original Bun lock SHA256 and exactly three updated files: `package.json`, `package-lock.json` and `bun.lock`. Staging, recovery, cancellation and raw Git publication preserve this closed file set. An npm-only host retains its original two-file proposal and does not acquire a Bun preparation prerequisite. No lock is migrated or introduced.

Optional Bun preparation supports root registry dependencies whose Bun records agree with the validated public npm lock. Workspaces and non-registry package identities remain refused. Changed original bytes, removed or untracked Bun locks, symlinks, hardlinks and unsupported native Bun versions refuse. The selected executable's regular-file identity and bytes are checked around each native operation; a changed tool cannot reuse its earlier qualification. Preparation installs the pinned Bun action only when the original checkout has `bun.lock`. These local contracts do not establish hosted Bot acceptance.

The initial gate target is a fresh GitHub-hosted Ubuntu Linux AMD64 runner with Node 22.23.3, npm 10.9.9 or 11.21.0, Bun 1.4.4 and, for Rails, Ruby 3.4.11/Bundler 2.4.10. The original Husky or Lefthook installation runs unchanged, using genuine native Git, Docker and MySQL fixtures. Other platforms refuse this gate. Commit actual GitHub repository and owner IDs, the approved reusable signer commit, caller workflow path and an assignable human maintainer. The workflow installs the fixed official [GH 2.96.0 Linux AMD64 release](https://github.com/cli/cli/releases/tag/v2.96.0) at `/usr/local/bin/gh` only after its actual extracted binary matches the committed `automationProvenance.ghSha256`; that policy must declare the same executable path. Qualification must measure those genuine Linux bytes. A macOS hash or a runner's ambient GH hash does not qualify this installation. Publishing also requires the repository's existing Actions PR creation policy to permit the genuine Actions Bot. The updater does not change that policy.

Rails hosts can opt into the closed committed `npmUpdater.runtime` object:
`{"profile":"rails-mysql","database":"app","browser":true,"dockerFixtures":true}`.
The database base must match `[a-z][a-z0-9_]{0,40}`; the two switches are booleans.
The caller must affirm this choice with `runtime-profile: rails-mysql`. The
affirmation cannot override committed policy or the signed whole-profile digest.
Omitting the object and using the default `runtime-profile: none` retains the
ordinary gate route without extra database or browser prerequisites.

The opt-in route authenticates the original canonical signed proof before any
profile-specific installation or allocation. It qualifies fixed native tools,
installs frozen dependencies, then creates an owned MySQL 8.4.11 AMD64 service
and least-privilege account. Native Rails preparation and readback must establish
the primary, queue, cache and cable schemas named `app_test`, `app_queue_test`,
`app_cache_test` and `app_cable_test`. The original hooks receive the validated
local database fields and qualified tool environment. Browser opt-in uses pinned
Chrome/ChromeDriver and the qualified vendor SUID sandbox; it does not disable
the sandbox or alter AppArmor policy. Docker fixture opt-in installs fixed
Compose/Buildx plugins in a private config containing no inherited credentials.
Every step and owned cleanup consumes the original absolute gate deadline.
The fixed Ubuntu package versions come from the signed
`20261013T000000Z` Ubuntu snapshot for both index update and installation, so
moving archive updates cannot remove a required pinned version. The unchanged
21-package roster pins `libx11-xcb1` to `2:1.8.7-1ubuntu0.1`, matching Ubuntu's
security-patched `libx11-6`; production installation never permits a downgrade.
After verifying its native Ubuntu identity and clean source, the separate
disposable CI component qualifier first normalizes that same fixed roster from
the signed snapshot, explicitly permitting downgrades of newer runner packages.
It then runs the unchanged strict production installer and tool qualification.
This prerequisite setup grants no consumer downgrade permission or provider proof.
The component qualifier records bounded pre-install versions for those two package
names and, on a package refusal, its fixed `apt-update` or `apt-install` phase,
native outcome and stream fingerprints. Original output remains in private
captures; mirror URLs, command content and arbitrary stderr are not published.
Its before/after census must preserve every prior container, network, volume
and image ID before the component result can succeed. Administrator
readiness uses TCP to `127.0.0.1`; the image's temporary initialization server
has networking disabled and cannot satisfy that check through its Unix socket.
Source and synthetic protocol controls do not establish Ubuntu execution,
genuine Actions Bot publication or protected-check acceptance.

Install the normally released Lisa package and apply its managed scripts through the ordinary workflow. Keep the host's canonical work-item configuration and hooks. Select `npmUpdater.version: 1`, the exact `repository`, `directory: "."` (or a committed subdirectory, as described above), `target: "main"` (or omitted, or another configured deploy branch as described above), `maintainer`, `packages: [{"name": "package-name", "version": "1.2.3"}]`, and `lisaOwner: "absent"` or `"verified-local-full-apply"`. Lisa itself is excluded only when the latter ownership has been positively verified. Automation provenance must be explicitly enabled and its repository must match the configured GitHub code-host repository (`github.org`/`github.repo`).

The complete authenticated helper inventory is delivered by the common template
lane, including the Git environment cleaner, cleanup sweep, ratchet modules
and mutation wrapper. A common-only npm host uses the same full byte and path
qualification as a framework host. Materializing these helpers does not install
framework-specific gates; the host retains its existing configured hook routes.

For the supported Husky 8 host, the gate reads the actual installed package's `bin` declaration and runs that installer with `install`. Husky 8 declares `lib/bin.js`; a guessed `node_modules/husky/bin.js` path is not an installer. Missing, unsupported or aliased installer metadata refuses. The gate still verifies the real installed executable wrappers and their committed hook source. Lefthook follows its original native installation.

Repository administrators configure Actions PR creation permission during opt-in activation. GitHub's [default workflow permission read](https://docs.github.com/en/rest/actions/permissions#get-default-workflow-permissions-for-a-repository) requires repository Administration read access, which is absent from the workflow's [GITHUB_TOKEN permission vocabulary](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions). The publisher does not require that admin endpoint. It attempts only the independently authorized exact publication writes and preserves GitHub's actual refusal if PR creation is forbidden. It cannot approve reviews or change repository policy. Successful native PR readback and canonical backlinks remain required.

The actual extracted GH 2.96.0 Linux AMD64 binary measured from that official release has SHA256 `56b8bbbb27b066ecb33dbef9a256dc9d1314adaeff0908a752feba6c34053b40` (40,722,594 bytes). Its archive SHA256 is `83d5c2ccad5498f58bf6368acb1ab32588cf43ab3a4b1c301bf36328b1c8bd60`. These byte identities support configuration and repeatable installation. They do not establish hosted execution or provider authorization.

Create a host-owned caller only after qualification. Replace the signer reference with the reviewed immutable Lisa commit and declare that same identity in the committed automation policy. A manual caller is:

```yaml
name: Selected dependency updates
on:
  workflow_dispatch:
    inputs:
      cancel_issue:
        description: Optional exact stale prepublication proposal issue
        type: string
        default: ''
      cancel_proposal_key:
        description: Optional exact original proposal key
        type: string
        default: ''
      cancel_expected_main:
        description: Optional exact current main commit
        type: string
        default: ''
permissions: {}
jobs:
  update:
    uses: CodySwannGT/lisa/.github/workflows/npm-updater.yml@REVIEWED_IMMUTABLE_COMMIT
    with:
      expected_workflow_contract_major: '1'
      npm-version: '11.21.0'
      cancel_issue: ${{ inputs.cancel_issue || '' }}
      cancel_proposal_key: ${{ inputs.cancel_proposal_key || '' }}
      cancel_expected_main: ${{ inputs.cancel_expected_main || '' }}
    permissions:
      contents: write
      actions: read
      issues: write
      pull-requests: write
      id-token: write
      attestations: write
```

The reusable jobs reduce those permissions separately. Preparation has read access and runs installed-tree `npm outdated` plus script-disabled npm updates. Allocation alone has issuer permission and writes the configured leaf and durable checkpoint. Gate has provider read access. Publication has the exact repository write permissions and no issuer permission. Every checkout uses `persist-credentials: false`. Application processes receive neither publisher tokens nor issuer credentials. The default runtime token is `github.token`; the resulting publisher must read back as the genuine Actions Bot.

Gate follows the ordinary disposable CI trust model. Hooks and tests share its ephemeral runner and real local Docker daemon. A bounded private broker holds only the job's read-only token and executes the exact repository/leaf/run/proof reads needed by the original canonical validators. It exposes no writer or arbitrary GH command. This transport does not claim confidentiality or protected status against arbitrary same-user/root code on that runner. Publisher and issuer authority live in different jobs, and the publisher independently checks signed authority, the exact raw object and declaration set, current destination and canonical backlink before writes. No container catalogue, VM or custom daemon is required for this supported route.

The allocator uses GitHub's [generic attestation action](https://github.com/actions/attest/blob/v4.2.2/action.yml) with the fixed `descriptor.json` or `recovery.json` subject name, SHA256 of the actual bytes and separate proposal or recovery predicate. It transports both original and renewal bundles when recovering. Artifacts contain bounded proposal/proof/receipt data. Tokens and private launcher/broker storage are excluded. Downloaded fixed phase files regain private permissions before the canonical bounded reader consumes them.

A retry with identical selected versions and base restores the same leaf, claim, signed origin, owned branch and PR. A later distinct update gets its own leaf. A stale outstanding update, changed destination, hold, changed signing identity or failed ordinary gate stops publication. A recovered existing destination still receives an independent full proposal audit and its accurate original pre-push stdin stream.

An authentic stale proposal that has never created a branch or PR has an explicit cancellation route. The configured human maintainer can dispatch the committed manual caller on `main`, supplying all three exact values: `cancel_issue`, the old `cancel_proposal_key`, and `cancel_expected_main`. For example, use the ordinary `gh workflow run npm-update.yml --ref main -f cancel_issue=42 -f cancel_proposal_key=OLD_64_HEX_KEY -f cancel_expected_main=CURRENT_40_HEX_COMMIT`. Replace those placeholders with independently read proposal and current-main identities. This dispatch is operator intent, never a pull-request review approval. The runtime still uses the genuine job's `github.token`; no operator token or admin permission is transferred into it.

The allocator independently verifies the native manual event, actual triggering User, configured maintainer's current write permission and exact current main. It authenticates the old origin using the old parent’s committed policy, actual historical run and unedited Bot checkpoint transport. Both the named branch and every historical PR must be absent. A hold, ambiguous selection, changed main, missing or altered authority, foreign operator or published destination refuses before lifecycle writes. Cancellation uses a third fixed `cancellation.json` subject and `npm-cancellation/v1` predicate. Neither ordinary proposal nor recovery proof can replace it, and it grants no publication or review authority.

The signed cancellation checkpoint is persisted before the old leaf closes as `not_planned`. Its body, title, claim and original attestation remain intact. The normal allocator then creates one new parent-bound canonical leaf with a fresh claim and origin, recording the verified supersession relationship. An interrupted manual run can reuse its verified complete cancellation record and finish the same closure or allocation. Bare markers, arbitrary closed leaves and disconnected or forked chains refuse; connected history is bounded to 100 proposals. Empty cancellation inputs preserve ordinary manual and scheduled callers, while partial inputs refuse. Activating this route requires the reviewed release's managed scripts and immutable signer/caller configuration together. Unit controls establish behavior, not genuine hosted operator or Actions-token proof.

Publication reports `published-awaiting-review`. It neither approves nor merges its PR, changes protection rules, closes the implementation ticket or treats absent, skipped, stale or pending checks as success. Ordinary human review and actual runtime verification remain required. A local unit control is not Linux runtime qualification or hosted release proof.

The project-owned `npm-updater-runtime-qualification.yml` job exercises the fixed Ubuntu tools and owned four-role Rails runtime with a generic application, original Lefthook commit/pre-push hooks and Chrome's active SUID sandbox. It uploads only bounded status, sizes, hashes and cleanup metadata; native output remains private on the ephemeral runner. The qualified browser is exposed through both `CHROME_BIN` and `CHROME_BINARY` with the same verified path. This component route explicitly reports `providerAuthorityVerified=false`, `productionHostedGateVerified=false` and `driverSessionVerified=false`. Its results cannot replace the authenticated production gate, a genuine ChromeDriver session or actual Bot publication and protected-consumer acceptance.

The internal sandbox-page probe supplies Chrome's required
`--allow-chrome-scheme-url` flag. Its native browser operation is capped at ten
seconds within the unchanged absolute phase deadline, retaining time for owned
cleanup after an early browser refusal. All other component stage bounds and
production gate deadlines remain unchanged.

Browser qualification diagnostics also sample readable descendants of the exact verified executable on Linux. Only closed role, state, sandbox-flag and wait-channel facts are retained; identities, paths and arguments are discarded. Setup and cancellation are synchronous, pending reads and partial observations are reported, and diagnostic I/O never postpones the original native result. This evidence cannot replace the required browser sandbox result.
