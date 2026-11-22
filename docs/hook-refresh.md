# Scoped hook refresh

Install a genuine published Lisa release before refreshing its hook contract. The command requires the release tag and commit stamped into the package and verifies packaged and existing host copies against Lisa's shipping ledger.

```sh
lisa refresh-hooks /absolute/project --guards block-no-verify
```

The accepted cohort name is `block-no-verify`, which selects the no-verify guard and its shared dedupe helper. It may appear once. The command lists no arbitrary paths, overrides or full-apply fallback. The retired `parity-safety-net` cohort was removed with the hook itself (CodySwannGT/lisa#4803); an apply deletes a host copy that is still byte-identical to a shipped version.

All selected files are checked before writes. Host modifications, extra declared capabilities, missing or symlinked companions, hardlinked host files, unknown shipping hashes and changed preflight bytes refuse. Read-only package files may share cache inodes. The command requires native no-follow file and directory descriptors (supported on macOS and Linux); it refuses when those native facilities are unavailable.

Source, destination and ancestor identities remain pinned with open descriptors for the operation. Bounded in-memory backups, writes, permission changes and rollback use the original file descriptors. Fresh path, content and identity checks detect replacement, including renamed ancestors; rollback never follows a replacement pathname. A concurrent content edit causes rollback refusal and is preserved. Rollback and handle-close failures are reported alongside the original error. This is a scoped in-process backup, not a persistent installer transaction. Unrelated dirty application files, configuration, workflows and agent settings are left unchanged.
