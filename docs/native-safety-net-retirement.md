# Native safety-net retirement

Lisa no longer screens commands with `parity-safety-net`. Updating the Lisa
dependency with its normal package lifecycle disables old Lisa-owned copies
automatically. An additional full template apply is not required. All other
guards, tests, lint, review and verification checks remain enabled.

This includes ordinary installs and Bun/pnpm virtual-store layouts: the update
reconciles the host repository, rather than the package's storage directory.

The shell hook, Antigravity adapter and OpenCode module remain as harmless
compatibility entries. Existing registrations and commands captured by a running
agent can still call those paths. They do not parse or execute the proposed
command, require the old parser, or refuse tool input. This applies to Claude,
Codex, Cursor, OpenCode, Antigravity, Copilot and Devin.

The target-only retirement runs before install-only entry points return, and as
an idempotent migration for full and reduced core apply. It does not run full
apply during installation, create an apply receipt, clear earlier failure
evidence, rewrite settings, or disable the enclosing Lisa plugin. Repository
fallbacks no longer count or invoke this target as an active guard.

Old copies in project handler directories and the installed plugin containers
are replaced only when the exact filename and SHA256 match known Lisa source or
shipping history. The generated ownership manifest retains historical hashes
under shallow clones. Replacements use atomic rename, preserving permissions and
breaking cache hardlinks instead of editing their shared inode. A source
checkout's build or tests do not reconcile user-wide plugin directories.

Customized targets and symlinks into other checkouts are preserved. The installer
reports recognized custom target files; it does not claim to retire arbitrary
operator wrappers, external plugins, custom plugin locations, or remote plugin
stores. Package managers must run the dependency lifecycle for automatic cleanup.
Current local-folder plugin links to the dependency receive its harmless handler
directly. The external upstream plugin is no longer enabled or registered by any
template. Its real name is `cc-safety-net@cc-marketplace`; the earlier
`safety-net@cc-marketplace: false` pin matched no plugin, so it never disabled it.
The `prune-retired-third-party-plugins` migration removes it, and its
marketplace, from existing projects (CodySwannGT/lisa#4799).

To preview the narrow reconciliation against a project without changing files:

```sh
node node_modules/@codyswann/lisa/scripts/retire-native-safety-net.mjs /absolute/project --dry-run
```

Regenerate the ownership manifest with
`bun run build:retired-safety-net-manifest`; `check:artifacts` verifies it. The
regression contract compares actual released baseline behavior with an ordinary
package update, exercises all seven emitted handlers and an unrelated refusal,
then repeats against the exact published candidate archive. Unit checks alone
are not evidence that an installed agent session picked up a release.
