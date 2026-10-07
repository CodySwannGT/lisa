# Opt-in selected npm updates

The reusable [npm updater](../.github/workflows/npm-updater.yml) prepares one selected root npm update, allocates its canonical leaf, runs ordinary gates and publishes the exact gated commit. It has no schedule. The host owns cadence and exact package versions in its committed `.lisa.config.json`. Root npm on `main` is the initial supported repository shape.

The initial gate target is a fresh GitHub-hosted Ubuntu Linux AMD64 runner with Node 22.23.3, npm 10.9.9 or 11.21.0, Bun 1.3.8 and, for Rails, Ruby 3.4.11/Bundler 2.4.10. The original Husky or Lefthook installation runs unchanged, using genuine native Git, Docker and MySQL fixtures. Other platforms refuse this gate. Commit actual GitHub repository and owner IDs, the approved reusable signer commit, caller workflow path and an assignable human maintainer. The workflow installs the fixed official [GH 2.96.0 Linux AMD64 release](https://github.com/cli/cli/releases/tag/v2.96.0) at `/usr/local/bin/gh` only after its actual extracted binary matches the committed `automationProvenance.ghSha256`; that policy must declare the same executable path. Qualification must measure those genuine Linux bytes. A macOS hash or a runner's ambient GH hash does not qualify this installation. Publishing also requires the repository's existing Actions PR creation policy to permit the genuine Actions Bot. The updater does not change that policy.

Install the normally released Lisa package and apply its managed scripts through the ordinary workflow. Keep the host's canonical work-item configuration and hooks. Select `npmUpdater.version: 1`, the exact `repository`, `directory: "."`, `target: "main"`, `maintainer`, `packages: [{"name": "package-name", "version": "1.2.3"}]`, and `lisaOwner: "absent"` or `"verified-local-full-apply"`. Lisa itself is excluded only when the latter ownership has been positively verified. Automation provenance must be explicitly enabled and its repository must match the configured GitHub tracker.

The actual extracted GH 2.96.0 Linux AMD64 binary measured from that official release has SHA256 `56b8bbbb27b066ecb33dbef9a256dc9d1314adaeff0908a752feba6c34053b40` (40,722,594 bytes). Its archive SHA256 is `83d5c2ccad5498f58bf6368acb1ab32588cf43ab3a4b1c301bf36328b1c8bd60`. These byte identities support configuration and repeatable installation. They do not establish hosted execution or provider authorization.

Create a host-owned caller only after qualification. Replace the signer reference with the reviewed immutable Lisa commit and declare that same identity in the committed automation policy. A manual caller is:

```yaml
name: Selected dependency updates
on:
  workflow_dispatch:
permissions: {}
jobs:
  update:
    uses: CodySwannGT/lisa/.github/workflows/npm-updater.yml@REVIEWED_IMMUTABLE_COMMIT
    with:
      expected_workflow_contract_major: '1'
      npm-version: '11.21.0'
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

Publication reports `published-awaiting-review`. It neither approves nor merges its PR, changes protection rules, closes the implementation ticket or treats absent, skipped, stale or pending checks as success. Ordinary human review and actual runtime verification remain required. A local unit control is not Linux runtime qualification or hosted release proof.
