# Opt-in selected npm updates

The reusable [npm updater](../.github/workflows/npm-updater.yml) prepares one selected root npm update, allocates its canonical leaf, runs ordinary gates and publishes the exact gated commit. It has no schedule. The host owns cadence and exact package versions in its committed `.lisa.config.json`. Root npm on `main` is the initial supported repository shape.

When the original commit also contains a regular text `bun.lock`, preparation uses genuine Bun 1.3.8 to update that lock with lifecycle scripts disabled. Both native npm ci and frozen Bun installation must preserve the prepared bytes. The proposal and signed descriptor bind the original Bun lock SHA256 and exactly three updated files: `package.json`, `package-lock.json` and `bun.lock`. Staging, recovery, cancellation and raw Git publication preserve this closed file set. An npm-only host retains its original two-file proposal and does not acquire a Bun preparation prerequisite. No lock is migrated or introduced.

Optional Bun preparation supports root registry dependencies whose Bun records agree with the validated public npm lock. Workspaces and non-registry package identities remain refused. Changed original bytes, removed or untracked Bun locks, symlinks, hardlinks and unsupported native Bun versions refuse. The selected executable's regular-file identity and bytes are checked around each native operation; a changed tool cannot reuse its earlier qualification. Preparation installs the pinned Bun action only when the original checkout has `bun.lock`. These local contracts do not establish hosted Bot acceptance.

The initial gate target is a fresh GitHub-hosted Ubuntu Linux AMD64 runner with Node 22.23.3, npm 10.9.9 or 11.21.0, Bun 1.3.8 and, for Rails, Ruby 3.4.11/Bundler 2.4.10. The original Husky or Lefthook installation runs unchanged, using genuine native Git, Docker and MySQL fixtures. Other platforms refuse this gate. Commit actual GitHub repository and owner IDs, the approved reusable signer commit, caller workflow path and an assignable human maintainer. The workflow installs the fixed official [GH 2.96.0 Linux AMD64 release](https://github.com/cli/cli/releases/tag/v2.96.0) at `/usr/local/bin/gh` only after its actual extracted binary matches the committed `automationProvenance.ghSha256`; that policy must declare the same executable path. Qualification must measure those genuine Linux bytes. A macOS hash or a runner's ambient GH hash does not qualify this installation. Publishing also requires the repository's existing Actions PR creation policy to permit the genuine Actions Bot. The updater does not change that policy.

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
`20261008T000000Z` Ubuntu snapshot for both index update and installation, so
moving archive updates cannot remove a required pinned version. Administrator
readiness uses TCP to `127.0.0.1`; the image's temporary initialization server
has networking disabled and cannot satisfy that check through its Unix socket.
Source and synthetic protocol controls do not establish Ubuntu execution,
genuine Actions Bot publication or protected-check acceptance.

Install the normally released Lisa package and apply its managed scripts through the ordinary workflow. Keep the host's canonical work-item configuration and hooks. Select `npmUpdater.version: 1`, the exact `repository`, `directory: "."`, `target: "main"`, `maintainer`, `packages: [{"name": "package-name", "version": "1.2.3"}]`, and `lisaOwner: "absent"` or `"verified-local-full-apply"`. Lisa itself is excluded only when the latter ownership has been positively verified. Automation provenance must be explicitly enabled and its repository must match the configured GitHub tracker.

The complete authenticated helper inventory is delivered by the common template
lane, including the Git environment cleaner, scratch supervisor, ratchet modules
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
