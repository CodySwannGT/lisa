# Opt-in selected npm updates

The reusable [npm updater](../.github/workflows/npm-updater.yml) prepares one selected root npm update, allocates its canonical leaf, runs ordinary gates and publishes the exact gated commit. It has no schedule. The host owns cadence and exact package versions in its committed `.lisa.config.json`. Root npm on `main` is the initial supported repository shape.

The initial gate target is a fresh GitHub-hosted Ubuntu Linux AMD64 runner with Node 22.23.3, npm 10.9.9 or 11.21.0, Bun 1.3.8 and, for Rails, Ruby 3.4.11/Bundler 2.4.10. The original Husky or Lefthook installation runs unchanged, using genuine native Git, Docker and MySQL fixtures. Other platforms refuse this gate. Commit actual GitHub repository and owner IDs, the approved reusable signer commit, caller workflow path and an assignable human maintainer. The workflow installs the fixed official [GH 2.96.0 Linux AMD64 release](https://github.com/cli/cli/releases/tag/v2.96.0) at `/usr/local/bin/gh` only after its actual extracted binary matches the committed `automationProvenance.ghSha256`; that policy must declare the same executable path. Qualification must measure those genuine Linux bytes. A macOS hash or a runner's ambient GH hash does not qualify this installation. Publishing also requires the repository's existing Actions PR creation policy to permit the genuine Actions Bot. The updater does not change that policy.

Install the normally released Lisa package and apply its managed scripts through the ordinary workflow. Keep the host's canonical work-item configuration and hooks. Select `npmUpdater.version: 1`, the exact `repository`, `directory: "."`, `target: "main"`, `maintainer`, `packages: [{"name": "package-name", "version": "1.2.3"}]`, and `lisaOwner: "absent"` or `"verified-local-full-apply"`. Lisa itself is excluded only when the latter ownership has been positively verified. Automation provenance must be explicitly enabled and its repository must match the configured GitHub tracker.

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
