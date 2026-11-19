# Keeping secret values out of what the control commands write

The audit report, the control register, the evidence, the verdict and the
administrator handover are committed or passed to other people. A credential
that reached one of them would be published. So each of them refers to a
secret by the name it goes by, and code checks that none holds a value.

This note says what counts as a value, what happens when one is found, and
where each check sits. It builds on [evidence and verdict](evidence-and-verdict.md)
and [gates and policy](gates-and-policy.md).

## One scanner

`src/controls/secret-scan.ts` judges one piece of text.
`src/controls/secret-scan-json.ts` walks a whole document and names each
place by the keys and positions that lead to it. Every write point calls
these two, so no two of them can disagree about the same string.

Nothing in them returns, prints, logs or throws a value. They answer with
what a value was shaped like (`GITHUB_TOKEN`), where it was
(`findings[3].what`), or the text with the value taken out.

## What counts as a value

In this order:

1. **A shape only a credential has.** A provider's own prefix or structure: a
   private key block, a GitHub, GitLab, npm or cloud token, a signed web
   token. These are found anywhere. A private key is found by the line that
   starts it. When that line is missing, because the text is the end of a
   longer output, the key is found by its last line, and the lines of base64
   straight above that line are taken out with it.
2. **A web address that carries a user name or password**, and the value
   after `Bearer` or `Basic`.
3. **A long random-looking run, only beside a name that says it is a
   secret.** The names are `token`, `secret`, `password`, `passphrase`,
   `credential`, `authorization`, `api_key`, `access_key`, `account_key` and
   `private_key`, wherever they stand in a longer name (`SecretAccessKey`,
   `AccountKey`, `_authToken`).
   "Beside" means `name=value`, `name: value`, `--name value` as one piece of
   text or as two arguments in a list, or the JSON key the text sits under.
   A parameter is written `{ "<name>": { "value": … } }`, so its value takes
   the parameter's name.

   The run may be base64, which uses `/` and `+`. A value is taken out whole
   wherever a `/` falls in it, in its first characters or later. Beside such
   a name a UUID counts as well, because some registries and services give a
   token in that form.

What does not count matters as much, because a refusal stops the operator.
A long random-looking run with no such name beside it is left alone: a
commit hash, a SHA-256 digest, a UUID, a file path, an encoded image, an
evidence record's id. A provider prefix followed only by lower-case words and
short numbers is a name (`pypi-internal-mirror-01`), and so is a secret's own
name (`Bearer GITHUB_TOKEN`, `${{ secrets.DEPLOY_TOKEN }}`, `<token>`).

A file path beside a name that says secret is left alone too
(`token_file=/run/secrets/app2/key`). A path and a base64 value both hold
`/`, and they are told apart by what is between the slashes: the folders of
a path are words, which stay in one class of character, and the pieces of a
base64 value change between digits, capitals and small letters every few
characters. A path whose folders are themselves random-looking is taken for
a value. That errs on the side of taking out too much.

It is a guard for the shapes that can be recognised. A short password, or a
random value with nothing beside it that says what it is, passes. The
repository's own credential scan on every commit is the second line.

### Where the shapes come from

The provider shapes are the list the repository already ships:
`SECRET_SHAPES` in `scripts/lib/phrase-tests/redact.mjs`. Compiled code cannot
import that script, and loading it at run time would be an asynchronous
import where every caller is synchronous. So `src/controls/secret-shapes.ts`
restates the list, and `tests/unit/controls/secret-shapes-parity.test.ts`
holds the two equal: a shape added to, changed in or removed from either one
alone fails it. Change both, or neither.

The control scanner adds three things that list does not have: the rule
about names in point 3, the exemption for a prefix followed by plain words,
and the last line of a private key (`PRIVATE_KEY_LAST_LINE` in
`secret-shapes.ts`). The last is kept out of the restated list on purpose: a
key whose first line is gone only happens to output that was cut, and the
shipped list is used on text that never is.

**Every shape takes time in proportion to the text.** A check's whole
output is scanned before any of it is cut, and a check can print a megabyte
with no blank in it. Two shapes once took time that grew with the square of
the length: the web address, whose scheme was read to the end of a run of
letters and dots from every word in it (a megabyte of `a.a.a.` took about a
hundred seconds), and the private key, read to the end of the text from
each first line that had no last line. The scheme is now at most 64
characters, and a key's body stops at its own last line or at the first
line of the next block. Both lists carry the change. A scheme may start at
any letter, not only at the start of a word: held to the start of a word,
an address glued to 60 or more letters, digits or underscores (a digest
printed straight before `https://user:password@host`) was never tried from
near enough to reach its `://`, and its password stayed in. Each try still
reads at most 64 characters, so the time stays in proportion.
`tests/unit/controls/secret-scan-time.test.ts` holds every shape to it on a
megabyte.

## Refused or taken out

Two behaviours, chosen by where the text came from.

- **Text someone wrote is refused.** A finding, a question, an answer, a
  probe, a parameter in the gates declaration: a person or an agent wrote it
  and can take the value out. The command exits non-zero, names the file and
  the place, and writes nothing.
- **Text captured from a program is taken out.** What a check printed, the
  arguments it was started with, what a hosting platform answered: nobody
  typed it, and a proof run must not fail and lose its result because a tool
  echoed a token. The value is replaced by a placeholder such as
  `[REDACTED:GITHUB_TOKEN]`, which is how the record says something was
  removed and what it was shaped like. The run goes on, and `lisa controls
  attest` prints one line naming each result a value was taken out of.

Taking a value out happens before the file is written and before anything is
computed from it. The verdict's digest covers the evidence file as written,
so it is a digest of the text with the placeholder in it.

## Where each file is covered

| file | text that reaches it | what happens |
| --- | --- | --- |
| `.lisa/audit/report.json` | everything the audit writes: findings, mechanisms, questions, candidates, answers | refused by `lisa controls report-check` (rule `secret-values`); the place is named as `findings[0].what` |
| `.lisa/audit/report.json` | the probes | refused by the rule `probe-secrets`, which names the probe and the field |
| `.lisa/audit/report.json` | an answer a person typed, copied in by `report-check --absorb` | refused before the copy; the file and line of the answer are named |
| `.lisa/audit/report.md` | rendered from the checked record and the requirements catalogue | the record is refused first; the rendered text then passes through the scanner as it is written, which changes nothing unless closing up white space made text read as a value |
| `wiki/gaps.md` (only where the repository keeps a wiki) | the open questions, copied from the checked record into one marked block | the record is refused first; the file is not scanned as it is written, because the rest of it belongs to the people who type in it |
| `.lisa/controls/register.json` | everything in it is copied from the `gates` block of `.lisa.config.json` | the declaration is refused by `lisa controls register`, in write and `--check` mode, and by every command that generates the register; the place is named as `gates.<gate>.parts[0]…` |
| `.lisa/controls/evidence.json` | what a check printed (`output_excerpt`) | taken out of everything the check printed, before any of it is cut: first by the step that ran the check (`proof-half-run.ts`), which then keeps the last 4000 characters, and again by the evidence writer, which keeps the last 1000 of those |
| `.lisa/controls/evidence.json` | the arguments a check was started with (`command`), and `detail` and `reason`, which can quote why it could not be started | taken out as each record is made, and again over every record that stands, including ones an earlier run left |
| `.lisa/controls/evidence.json` | an audit finding's `what` and a person's answer, copied into `detail` | refused upstream by the report's rules; taken out here as well |
| `.lisa/controls/evidence.json` | the fields that name what a record is about (`id`, `entry_id`, `scope`, `criterion`, `commit`) | they come from the register, which is refused upstream; the last check before the write refuses the file if one ever holds a credential shape |
| `.lisa/controls/verdict.json` | `detail` and `fact`, copied from evidence records | taken out when the verdict is computed, so computing it again gives the same text; the last check before the write refuses the file otherwise |
| `.lisa/controls/merge-protection-change.md` | the remote address, the branch, the names of checks, the reasons the hosting platform gave | taken out as the file is written |
| `.lisa/controls/carriers.json` | the paths of the files Lisa placed, and fixed text | not scanned at run time; it holds no text from a program or a person beyond folder names the repository already commits. A suite scans the file on every fixture |

"The last check before the write" is `writeControlFile` in
`src/controls/control-files.ts`. It refuses content that still holds a
credential shape and names the file and the place. Everything that reaches
it has already been refused or had its values taken out, so it only stops a
way in that nothing else covers.

## What a message may say

A line about a value names the file and the place, and what the value was
shaped like. It never repeats the value. Other rules quote what they find,
so every line the report check prints, and every problem generating the
register hands back, also passes through the scanner on its way out. A
record that is not valid JSON is never seen by a rule, and a parser's message
quotes a piece of the file; that piece is cut off the message.

## Adding a file

A step that writes a new committed or shared file under `.lisa/` does one of
three things, and says which in its own notes:

- writes it with `writeControlFile`, which refuses a file that holds a value;
- refuses what it was given, with `scanJsonForCredentials` and
  `secretFindingLine`, when a person or an agent wrote the text;
- takes values out, with `redactJsonCredentials`, `redactCredentials` or
  `redactArguments`, when the text was captured from a program.

`tests/unit/controls/secret-scan-fixtures.test.ts` takes every fixture
repository through the commands and scans each file they leave. A new file
is added to its list.

## What is not covered

- `lisa controls attest --json` prints what each half kept. The end of the
  check's output and the lines that carried the failure text have their
  values taken out, as above. The arguments a check was started with and
  the sentence of a result are printed as they were captured: those go to
  the terminal, and are filtered only on their way into a file.
- A token that reached the scan already cut in two. Everything a check
  prints is scanned whole before any of it is cut, so the control commands
  do not produce such text themselves. A record an earlier version wrote,
  or text another program cut, can hold one: a private key in that position
  is still found by its last line; a token that has lost the prefix that
  makes it recognisable is not.
- Problems about `.lisa.config.json` or the register that are not valid JSON
  still carry the parser's own message.
- The source of the repository itself. The credential-leakage gate covers
  that.
