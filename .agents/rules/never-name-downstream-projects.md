# Never name a downstream project

**Projects may mention Lisa. Lisa may not mention projects.** The direction is
the whole rule: a host repo citing `@codyswann/lisa` is fine; anything in this
repository naming a host project is not.

This repository is **public**, and `dist/` is in the npm `files` allowlist — so a
comment in `src/` is published twice over, on github.com and to every consumer
that installs the package.

## Scope

Applies to commit messages, PR and issue bodies, code comments, tests,
documentation, plans, and the wiki. It covers more than the GitHub org slug:

- org slugs and human-readable company names
- product and repository names
- AWS account numbers, bundle identifiers, and internal domains
- local absolute paths that embed any of the above

## Write the evidence, not the identity

Lisa's convention of citing the real repository that proved something is what
makes its commits good evidence, and it is exactly what leaks. Keep the rigour
and drop the name: *"a caller repo in the portfolio"*, *"repo A"* / *"repo B"*
where a document contrasts two, `<ticket>` in place of a real ticket id.

The argument never depends on which named client proved it — if it seems to, the
argument is the thing to fix.

## Exceptions

Two, both of which stay out of published artifacts:

- `.lisa.workspaces.json` is a runtime input that must name real local
  checkouts. It is gitignored and never published.
- Third-party product names (Google's Gemini, Antigravity, vendor GitHub orgs)
  are not host projects.

## How this is enforced

`tests/unit/core/no-downstream-project-names.test.ts` scans every tracked file
in required CI. It detects the **shape** rather than a list of names — a guard
enumerating the clients would publish the very list it protects — by
allowlisting orgs that are legitimately public and flagging everything else. A
newly onboarded downstream project is therefore caught without anyone
remembering to add it.

If the check fails on a legitimate vendor, add the org to `PUBLIC_ORGS` in
`src/core/downstream-references.ts`. That list is safe to publish; a list of
clients would not be.

## Why the rule alone was not enough

Claude Code auto-loads `.claude/rules/`; every other agent reads host rules on
demand, which an agent writing a commit message has no reason to do. Measured
2026-08-17: 135 tracked files named a client and 48 files in the published
tarball did, under a convention everyone already agreed with. The check is what
makes this binding for all six agents and for humans.
