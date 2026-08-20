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
in required CI, using two detectors that catch different things.

**Shape detection** flags any `github.com/owner/repo` or workflow `uses:` whose
org is not in `PUBLIC_ORGS`. Its value is reach: a newly onboarded downstream
project is caught without anyone remembering to add it. It deliberately does
**not** match bare `a/b` in prose, because that shape collides with file paths,
date fractions and option syntax, and a guard with false positives gets
switched off.

**Known-name detection** flags a name wherever it is spelled — in a sentence, a
code comment, or a local absolute path — with no URL in front of it and no
slash in it at all. This was added because the shape detector was measured
reporting **zero** violations on a tree that had **189**, in 28 files, one of
them in `src/` and so in the published npm tarball. The blind spot was not a
rounding error; it was the whole live problem.

A known list has no false-positive problem to trade against: `2026/08/20`,
`src/core/index.ts` and `--flag=a/b` are not names, so they cannot match. The
objection to a list was different — a plaintext denylist in a public repository
publishes exactly what it protects — and it is answered by storing **truncated
salted digests** instead of names, in `src/core/downstream-names.ts`. Be honest
about what that buys: it prevents *enumeration*, not *confirmation*. Nobody can
read the list; anyone holding a specific guess can test it. That is inherent to
any in-tree denylist, and truncation blunts it by leaving thousands of
preimages per digest.

### Adding a name

```sh
node -e 'const{createHash}=require("crypto");const n=process.argv[1].toLowerCase().replace(/[^a-z0-9]+/g,"");console.log(`"${n.length}:${createHash("sha256").update("lisa/downstream-name/v1").update(n).digest("hex").slice(0,10)}",`)' 'The Name'
```

Paste the line into `HOST_NAME_ENTRIES` and keep the array sorted. Names shorter
than five characters are refused: a three-character entry matches an initialism
somewhere in almost any repository, which hands back the false-positive problem
the list exists to avoid.

A name too sensitive to appear even as a digest goes in the
`LISA_DOWNSTREAM_NAMES` environment variable instead, comma-separated. State the
cost plainly when choosing that: an environment variable absent from required CI
means the guard bites locally and not in CI, so out-of-tree is the weaker
placement, not the stronger one.

If the check fails on a legitimate vendor, add the org to `PUBLIC_ORGS` in
`src/core/downstream-references.ts`. That list is safe to publish; a list of
host projects would not be.

### What the list does not yet cover

Two further identity shapes are present in this repository and are **not** in
the list, because arming them is a several-hundred-file rewrite and therefore an
owner decision rather than a cleanup:

- **Host repository names without the org** — roughly 490 occurrences across
  about 110 files. The 2026-08-17 cleanup anonymised the org half and kept the
  repo half. That is defensible, since the org is the identifying half, but the
  scope section above covers repository names too, so the current state is a
  convention this rule does not actually sanction. Either the rule should say so
  explicitly or those occurrences should go.
- **A host tracker's project-key prefix** — 110 occurrences across 52 files,
  entrenched as the generic example key inside BDD grammar fixtures and schema
  examples, where it is load-bearing test data. It reads as an anonymous
  placeholder, which is almost certainly why it survived. Scrubbing it means
  touching fixtures.

Neither is a paste-a-digest job. The tracker prefix is three characters, below
the minimum length for good reason. The repository names are generic English
compounds that would fire on ordinary prose in any repository that used the same
word for its own directory. Arming either one means deciding what to rewrite
first, not adding a line to an array.

## Why the rule alone was not enough

Claude Code auto-loads `.claude/rules/`; every other agent reads host rules on
demand, which an agent writing a commit message has no reason to do. Measured
2026-08-17: 135 tracked files named a client and 48 files in the published
tarball did, under a convention everyone already agreed with. The check is what
makes this binding for all six agents and for humans.
