# Work-Item Trailer Definition — What Counts As One, And Which Reader Is Authoritative

Read this **before** writing anything that reads, counts, audits, or verifies a
`Work-Item:` reference in a commit message or a pull-request body. There are two
plausible definitions of "a `Work-Item:` trailer", they disagree about real
commits in this fleet, and the obvious tool — git's own trailer parser — is the
wrong one.

## The two definitions

**Definition A — git's.** `git log --format='%(trailers:key=Work-Item)'` and
`git interpret-trailers --parse` read only the **final contiguous block** of
`Key: value` lines. Any non-trailer line after a trailer ends that block, and
everything above it becomes invisible to the parser.

**Definition B — Lisa's.** A `Work-Item:` line is any line of the **whole
message** whose first character begins the ASCII-case-insensitive prefix
`Work-Item:` at **column zero**, with a non-empty value after it. Position in
the message carries no information. Repeats of the same reference are accepted.

## Definition B is authoritative. This is settled, not open.

Definition A was tried and abandoned in CodySwannGT/lisa#2672: it reported
`found 0` about messages that plainly contained a trailer, because a blank line
before the `Co-Authored-By:` attribution block — or a bot appending release
notes below it — was enough to end the block. Making Definition A work would
require that nothing ever append to a commit message, which is precisely the
assumption #2672 recorded as false.

The `🤖 Generated with Claude Code` convention puts boilerplate **after** the
trailer by default, so under Definition A a large share of this repository's own
commits read as untrailered. **The failure is the common case, not the edge
case.**

### Measured, not asserted

Both definitions run over real history, non-merge commits, counting only commits
where at least one definition finds a reference:

| Range | Commits naming an item | Agree | A finds none, B finds one | Other disagreement |
|---|---|---|---|---|
| A single multi-agent branch | 51 | 4 | **47 (92%)** | 0 |
| Full default-branch history | 1,730 | 1,248 | **477 (27.6%)** | 5 |

The five "other" disagreements are commits carrying a bare `Work-Item: #1234`
above the block as well as the canonical reference inside it; B sees both, A
sees only the one in the final block.

**The undercount is clean, plausible and well-formed**, which is why it survives
review. `%(trailers)` printing nothing is genuinely convincing evidence until
you know this rule exists — which is why at least three separate audits have
shipped confident, specific, wrong findings from it, including an instruction to
amend a commit whose trailer was fine.

## Do not reimplement it. Import it.

`workItemLines(message)` and `soleWorkItem(text, contract, subject)` are
exported from the shipped `scripts/lisa-work-item.mjs`. They are the definition.
A second parser is a second answer to "which item is this?", and two answers is
the state this rule exists to end.

```js
import { workItemLines } from "./lisa-work-item.mjs";
```

`workItemLines` returns every value found, in order of appearance, untouched
beyond trimming. `soleWorkItem` canonicalizes them against the tracker contract
and refuses a text naming two **different** items.

## What each layer owns, and why the shape filter stays at the call site

`workItemLines` deliberately does **not** validate the shape of a value. It
answers "what does this text say?" — nothing more. Canonicalization,
repository-membership, and the refusal of the full issue-URL form all live in
`canonicalizeRef`, above it.

That split is load-bearing and must not be converged away. A reader that
filtered malformed values out during the scan would make a bad value
**invisible** rather than **refused**: `Work-Item: https://github.com/o/r/issues/7`
would read as no trailer at all, and the gate would report "no Work-Item trailer
anywhere in the commit message" about a message containing exactly one, which is
the #2672 failure re-created one layer down. The reader sees everything; the
layer above decides what is acceptable.

The consequence a caller must respect: **a filter you apply to `workItemLines`'
output is your filter, not the definition.** State what it drops.

## Column zero is part of the definition

The prefix is anchored at column zero, so `# Work-Item: …` in a comment never
matches, and neither does a unified-diff line — every one of those carries a
space, `+` or `-` in that column. A reader that tolerates leading whitespace
matches the **context line of a verbose commit's own diff**. Measured over full
default-branch history: 2,059 `Work-Item:` lines at column zero, **zero**
indented ones. There is no real input that needs the looser form and one class
of false positive that needs the anchor.

The prefix is matched with a non-Unicode `/i` regex rather than
`toLowerCase().startsWith(…)` on purpose: `toLowerCase()` applies full Unicode
case mapping, so U+212A KELVIN SIGN would fold to `k` and `WorK-Item:` written
with it would be accepted — a form this has never accepted.

## Testing a trailer reader

**A checker exercised only against well-formed messages passes under either
definition.** That is why three audits shipped with the bug undetected. The only
input that distinguishes them is a `Work-Item:` line sitting **above** a
non-trailer line, and any test of a trailer reader must pin one:

```
feat: something

Work-Item: owner/repo#123

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
```

Under Definition A this message has no work item. Under Definition B — the
authoritative one — it names exactly one. Assert **present**.

## Related

- `tracked-work` (eager) — the obligation to carry the ref on every commit
- `settled-decisions` — why this is recorded as closed rather than re-litigated
- CodySwannGT/lisa#2672 — where Definition A was tried and abandoned
- CodySwannGT/lisa#3747 — where the decision was made discoverable
- CodySwannGT/lisa#3859 — the same undercount measured on the audit side
