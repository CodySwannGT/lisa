---
name: lisa-security-audit-handling
description: "What to do when a push or CI is…"
---
What to do when a push or CI is blocked by the dependency security audit: fix the vulnerable copy by refreshing the lockfile, upgrading the direct dependency, adding a targeted override, or replacing/removing the dependency. Never excludes the advisory as the remedy and never bypasses the hook.


# Security Audit Handling

Use this when `git push` (or a CI audit gate) fails because the dependency audit reports high or critical advisories. Work the ladder below **autonomously**. Never use `--no-verify`, `HUSKY=0`, `core.hooksPath`, or any other hook bypass to skip the security audit.

## The fix ladder

The remedy for a high/critical advisory is to stop shipping the vulnerable code. For each advisory, take the **first** step that lands a patched copy:

1. **Refresh the lockfile within the current range.** Most transitive fixes are published inside the range the parent already accepts; a stale lockfile is the usual cause.
2. **Upgrade the direct dependency** that pulls the vulnerable copy to a release that depends on a patched one.
3. **Add a targeted override** that pins the vulnerable **leaf** package to the fixed version.
4. **Replace or remove the dependency** when no fixed version exists: a maintained alternative, a newer major of the parent that no longer pulls the package, or dropping it.

If none of the four works in this change, **file a build-ready ticket** in the configured tracker (through `lisa-tracker-write` with `build_ready: true`) carrying the evidence: the advisory, the dependency path that reaches the vulnerable copy, and what was tried at each of the four steps and why it failed. The factory then carries the replacement or removal as work. Stop only when the next act needs access you do not have, and then say exactly what is missing. Do not write an audit exclusion to get past the gate: `audit.ignore.local.json` is the project operator's own file, not an agent remedy.

## Node.js Projects (GHSA advisories)

1. Note the GHSA ID(s), affected package(s), vulnerable lockfile path(s), and advisory URL from the error output.
2. Check the advisory for the patched version in each affected major (`gh api /advisories/<GHSA-id>`). Also check whether it was withdrawn.
3. **Step 1 — refresh:** if the patched version satisfies the range the parent declares, update the lockfile for that package (`bun update <pkg>`, `npm update <pkg>`, or `yarn upgrade <pkg>`), confirm with `bun why <pkg>` / `npm ls <pkg>` that every copy is patched, commit, and retry.
4. **Step 2 — upgrade:** otherwise upgrade the direct dependency whose chain pulls the copy to a release that accepts the patched version, regenerate the lockfile, run the project's tests, commit, and retry.
5. **Step 3 — override:** otherwise pin the **leaf** package in both `overrides` and `resolutions` in `package.json` (see below), regenerate the lockfile, run the tests, commit, and retry. In a Lisa host, if the fix should reach every project on the stack, propose it upstream in Lisa's `package.lisa.json`.
6. **Step 4 — replace or remove:** otherwise replace the dependency with a maintained alternative or remove it, prove behavior with the tests, commit, and retry.
7. If none of these works in this change, file the build-ready ticket described above.

### Critical: Override the vulnerable package, not its parent

When the audit output shows a dependency chain like `@expo/cli › glob › minimatch`, the vulnerable package is **minimatch**, not glob. Always override the **leaf package** that has the actual vulnerability.

**Never override a parent package to force a lower major version** — other packages in the project may depend on a newer major version, and a resolution/override forces ALL installations to the specified version. For example, overriding `glob` to `^8.1.0` will break `@expo/cli` which requires `glob@^13.0.0`, causing `expo prebuild` to fail with `files.map is not a function`.

Before adding a resolution/override (step 3), verify:
- You are targeting the **actually vulnerable package**, not a parent in the chain.
- The override version is **compatible with all dependents** (check with `bun why <package>` or `npm ls <package>`).
- The override does not **downgrade** a package across a major version boundary that other dependencies require.

If any of these checks fail, the override is "not possible" for the purposes of the ladder — go to step 4 (replace or remove).

### Never

- Never add a blanket audit bypass or lower the configured audit level.
- Never add an audit exclusion as the fix for a finding.
- Never file the ticket before genuinely attempting all four steps.
- Never wait on a human the work does not need; stop only for missing access, and name it.

## Rails Projects (bundler-audit)

Same ladder, bundler mechanics:

1. Note the advisory ID, affected gem, and advisory URL from the error output.
2. Check whether a patched version of the gem exists.
3. **Step 1 — update:** If a patched version exists:
   - **Direct dependency** (in Gemfile): update its version constraint, run `bundle update <gem>`, commit, retry.
   - **Transitive dependency** (only in Gemfile.lock): run `bundle update <gem>` to pull the patched version without changing the Gemfile, commit the lockfile change, retry.
4. **No patch:** If no patched version exists, upgrade or replace the gem that pulls it, or remove it. If none of that works, file a build-ready ticket with the evidence, as above. Never record an exception as the fix.
