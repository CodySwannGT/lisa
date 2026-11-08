# Scoped hook refresh

Install a genuine published Lisa release before refreshing its hook contract. The command requires the release tag and commit stamped into the package and verifies packaged and existing host copies against Lisa's shipping ledger.

```sh
lisa refresh-hooks /absolute/project --guards parity-safety-net,block-no-verify
```

The accepted cohort names are `parity-safety-net` and `block-no-verify`. Each may appear once. The first now selects the retired safety-net compatibility handler and retained companions; it does not enable destructive-command screening. The second selects the active no-verify guard and shared dedupe helper. The command lists no arbitrary paths, overrides or full-apply fallback. See [native safety-net retirement](native-safety-net-retirement.md) for automatic update cleanup.

All selected files are checked before writes. Host modifications, extra declared capabilities, missing or symlinked companions, hardlinked host files, unknown shipping hashes and changed preflight bytes refuse. Read-only package files may share cache inodes. The command requires native no-follow file and directory descriptors (supported on macOS and Linux); it refuses when those native facilities are unavailable.

Source, destination and ancestor identities remain pinned with open descriptors for the operation. Bounded in-memory backups, writes, permission changes and rollback use the original file descriptors. Fresh path, content and identity checks detect replacement, including renamed ancestors; rollback never follows a replacement pathname. A concurrent content edit causes rollback refusal and is preserved. Rollback and handle-close failures are reported alongside the original error. This is a scoped in-process backup, not a persistent installer transaction. Unrelated dirty application files, configuration, workflows and agent settings are left unchanged.

The Rails supervisor exception authenticates exact reviewed source bytes embedded in the released guard. It accepts the public `sh <literal-supervisor-path> --suite <label> -- <payload>` entry with a literal allowed temporary base. Internal entries, source changes and uncertain inputs refuse. The payload still passes normal execution-following and destructive-operation policy. The exception does not permit arbitrary variable-target deletion.

Installing a reviewed guard does not prove a supervised runtime succeeded. Retain the actual native status and owned cleanup evidence when qualifying that runtime.
