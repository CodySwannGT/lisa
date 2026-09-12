# Never Name a Downstream Project

## The rule

A downstream project's identity — its organization, product, or repository name — does not belong in anything that outlives the session it was written in: tracker items (titles, descriptions, comments), pull request titles and bodies, commit messages, wiki and ingested sources, and the text of rules and skills.

## Why the identity is never the point

An observation earns its place by being reproducible, not by its provenance. "A caller repo pinned all 64 of its call sites" and the same sentence with a name carry exactly the same engineering weight — the second just adds an obligation for whoever reads it later.

Where an argument appears to need the name, that is a signal the argument is under-specified. The fix is to state the condition that made it true — the version, the config, the shape of the tree — not to identify the place it was observed.

## How to write it instead

| situation | write |
|---|---|
| one project | "a caller repo", "a downstream project", "the reference repository" |
| two contrasted | "repo A" / "repo B" |
| several that must stay distinct in one sentence | `<project-1>`, `<project-2>` |
| a real identifier | `<ticket>` |

Rewrite the prose rather than substituting tokens wherever a placeholder reads badly: "follow `<name>`'s serverless pattern" becomes "follow the reference serverless pattern", not "follow `<project-1>`'s serverless pattern".

## Enforcement is partial, and must not be relied on

`block-host-name-leak` compares against a **curated denylist** and inspects **Bash tool calls only**. Two consequences follow:

- a name nobody has added to the list is invisible to it;
- a write issued by a script that reads its own body — rather than by a CLI given a `--body-file` — never reaches it at all.

So a clean run means "no listed name appeared", never "this text is safe". This rule is default-deny and holds independently of whether the guard fires.

Note also that the denylist cannot be the primary control: this repository is public and `dist/` ships to npm, so the entries most worth catching are the ones least safe to enumerate there.

## Prior reference is not licence

An existing ticket, brief, or ingested source that already carries a name does not authorise repeating it, and inherited text is the most common way such names spread — ingestion carries them forward, and each new document that quotes the last one multiplies them. When you meet one, replace it in what you are writing; do not propagate it because it was already there.
