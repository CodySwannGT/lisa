# Security Audit Handling

If `git push` fails because the pre-push hook reports security vulnerabilities, follow these steps. Never use `--no-verify` to bypass the security audit.

## Node.js Projects (GHSA advisories)

1. Note the GHSA ID(s), affected package(s), and advisory URL from the error output
2. Check the advisory URL to determine if a patched version of the vulnerable package exists
3. If a patched version exists: add a resolution/override in package.json to force the patched version (add to both `resolutions` and `overrides` sections), then run the package manager install command to regenerate the lockfile, commit the changes, and retry the push
4. If no patched version exists and the vulnerability is safe for this project (e.g., transitive dependency with no untrusted input, devDeps only, or build tool only): add an exclusion entry to `audit.ignore.local.json` with the format `{"id": "GHSA-xxx", "package": "pkg-name", "reason": "why this is safe for this project"}`, then commit and retry the push

### Critical: Override the vulnerable package, not its parent

When the audit output shows a dependency chain like `@expo/cli › glob › minimatch`, the vulnerable package is **minimatch**, not glob. Always override the **leaf package** that has the actual vulnerability.

**Never override a parent package to force a lower major version** — other packages in the project may depend on a newer major version, and a resolution/override forces ALL installations to the specified version. For example, overriding `glob` to `^8.1.0` will break `@expo/cli` which requires `glob@^13.0.0`, causing `expo prebuild` to fail with `files.map is not a function`.

Before adding a resolution/override, verify:
- You are targeting the **actually vulnerable package**, not a parent in the chain
- The override version is **compatible with all dependents** (check with `bun why <package>` or `npm ls <package>`)
- The override does not **downgrade** a package across a major version boundary that other dependencies require

## Rails Projects (bundler-audit)

1. Note the advisory ID, affected gem, and advisory URL from the error output
2. Check if a patched version of the gem exists
3. If a patched version exists:
   - If the gem is a **direct dependency** (listed in Gemfile): update its version constraint in Gemfile, run `bundle update <gem>`, commit the changes, and retry the push
   - If the gem is a **transitive dependency** (not in Gemfile, only in Gemfile.lock): run `bundle update <gem>` to pull the patched version without changing the Gemfile, commit the lockfile change, and retry the push
4. If no patched version exists and the vulnerability is safe for this project: document the exception and retry the push
