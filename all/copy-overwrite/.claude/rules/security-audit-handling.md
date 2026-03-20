# Security Audit Handling

If `git push` fails because the pre-push hook reports security vulnerabilities, follow these steps. Never use `--no-verify` to bypass the security audit.

## Node.js Projects (GHSA advisories)

1. Note the GHSA ID(s), affected package(s), and advisory URL from the error output
2. Check the advisory URL to determine if a patched version of the vulnerable package exists
3. If a patched version exists: add a resolution/override in package.json to force the patched version (add to both `resolutions` and `overrides` sections), then run the package manager install command to regenerate the lockfile, commit the changes, and retry the push
4. If no patched version exists and the vulnerability is safe for this project (e.g., transitive dependency with no untrusted input, devDeps only, or build tool only): add an exclusion entry to `audit.ignore.local.json` with the format `{"id": "GHSA-xxx", "package": "pkg-name", "reason": "why this is safe for this project"}`, then commit and retry the push

## Rails Projects (bundler-audit)

1. Note the advisory ID, affected gem, and advisory URL from the error output
2. Check if a patched version of the gem exists
3. If a patched version exists: update the gem in Gemfile, run `bundle update <gem>`, commit the changes, and retry the push
4. If no patched version exists and the vulnerability is safe for this project: document the exception and retry the push
