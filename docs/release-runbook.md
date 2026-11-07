# Release runbook

How to handle a `@codyswann/lisa` release after it has been published. Normal
releases are cut and published by CI; this runbook covers what a person does
when a published release turns out to be bad.

## Rolling back a bad release

Fixing forward is how a bad release is recovered: a new release that corrects
the problem. A rollback is what you do **first**, to stop the damage while that
fix is prepared. It does two things on npm and one on GitHub:

- marks the bad version as **deprecated**, so anyone who installs it sees why;
- points npm's `latest` tag back at the previous good version, so a plain
  `npm install @codyswann/lisa` gets the good version again;
- adds a deprecation notice to the top of the bad version's GitHub release
  notes.

It does **not** unpublish anything, and it does not change what downstream
projects already have installed.

### When to use it

- A canary rollout failed on the new version.
- A defect was found in a version after it was released, and new installs
  should stop picking it up.

### What you need

- **npm:** signed in as an account with publish rights on `@codyswann/lisa`.
  Run `npm login`, then check with `npm whoami` — it should print your npm
  username. (CI publishes through npm trusted publishing, which can only
  publish, so a rollback always runs under a person's own npm sign-in.)
- **GitHub:** the GitHub CLI signed in with write access to this repository's
  releases. Run `gh auth login`, then check with `gh auth status`.
- A checkout of this repository with `bun install` done.

The command checks both sign-ins itself before changing anything. If either is
missing it stops, says which one, and changes nothing.

### Step 1: rehearse with a dry run

The dry run needs no sign-in and changes nothing. It works out which version
`latest` should go back to and prints the exact commands a real run would use.

```bash
bun run release:rollback -- --bad 4.90.1 --reason "breaks lisa apply" --dry-run
```

Replace `4.90.1` with the bad version and the reason with one short sentence
people will see when they install it. Read the output: check that the version
after "latest would point to" is the one you expect. By default it is the
newest published version below the bad one that is not itself deprecated. To
choose a different one, add `--to <version>`.

### Step 2: run it for real

Run the same command without `--dry-run`:

```bash
bun run release:rollback -- --bad 4.90.1 --reason "breaks lisa apply"
```

It runs, in order: `npm deprecate`, `npm dist-tag add … latest`, and
`gh release edit` on the `v4.90.1` release notes. If any step fails it stops
there and prints the failing command and its error.

### Step 3: confirm it worked

The command confirms the result itself. After the writes it reads the
registry back, uncached, and only exits successfully once it sees both that
`latest` is the good version and that the bad version is deprecated. Success
ends with:

```text
Verified: 4.90.1 is deprecated and latest is 4.90.0. Now prepare the fix-forward release.
```

If it prints `Rollback NOT verified` instead, the registry did not show both
facts. Run the same command again — it is safe to repeat, and it will not add a
second notice to the release notes.

You can also look for yourself: the
[GitHub releases page](https://github.com/CodySwannGT/lisa/releases) shows the
notice at the top of the bad version's notes.

### Step 4: fix forward

The rollback only contains the problem. Prepare and ship the corrective
release through the normal release process; once it is published, `latest`
moves to it as usual. Releasing the fix is not part of this command.
