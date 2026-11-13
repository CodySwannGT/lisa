# Classification of Markdown phrase assertions (CodySwannGT/lisa#4867)

Produced by `scripts/classify-phrase-tests.mjs`. The class rules and the parser
behind every token class are in `scripts/lib/phrase-tests/token-classes.mjs`.

| Class | Meaning |
|---|---|
| MACHINE-TOKEN | The whole phrase is a marker whose exact spelling shipped code reads. The parser is named per entry. |
| STRUCTURAL | Frontmatter shape: the `---` delimiter, or a key (`name`, `description`, `argument-hint`, `allowed-tools`, `skills`, `model`, `tools`) whose value is an identifier rather than prose. |
| WORDING | Anything else. A sentence that only mentions a token is WORDING, and so is a marker that no shipped code parses. |
| NOT-MARKDOWN | (Manifest only.) The pinned file is a workflow, hook or script, not a Markdown document. These guard source text, are outside this cull, and moved to `tests/phrase-manifest/source-text-guards.json`. |
| UNRESOLVED | (Test assertions only.) The asserted phrase is computed, not a literal, so it needs a person to read it. |

## Required-phrases manifest

Files: `classification-manifest-before.json`, `classification-manifest-after.json`.

| | Files | Entries | MACHINE-TOKEN | STRUCTURAL | WORDING | NOT-MARKDOWN |
|---|---:|---:|---:|---:|---:|---:|
| `required-phrases.json` before | 376 | 5,391 | 54 | 0 | 5,135 | 202 |
| `required-phrases.json` after | 50 | 54 | 54 | 0 | **0** | **0** |
| `source-text-guards.json` (new) | 23 | 202 | 0 | 0 | 0 | 202 |

Every remaining `required-phrases.json` entry is MACHINE-TOKEN or STRUCTURAL.
The 5,135 WORDING entries are deleted; the 202 non-Markdown source-text
guards (for example `plugins-sync.yml`'s "no `paths:` filter" guard and
`exit 2` in hooks) are kept, in their own file.

MACHINE-TOKEN entries by rule: `[lisa-pr-link]` 36 (parser
`all/copy-overwrite/scripts/lisa-work-item.mjs`), `## Lisa Usage` 14
(`all/copy-overwrite/scripts/lib/usage-ledger.mjs`), `[EVIDENCE: …]` 4
(`plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py`).

The manifest held no frontmatter assertions, so STRUCTURAL is 0 there.
`tests/unit/docs/required-phrases.test.ts` checks both files. It fails if a
`required-phrases.json` entry is anything but MACHINE-TOKEN or STRUCTURAL, or
if a `source-text-guards.json` entry pins a Markdown file.

## Phrase assertions in test files

File: `classification-assertions-before.json` (before any test file is culled).

241 test files read a Markdown document. They hold 5,885 phrase assertions:
4,341 on Markdown text, 1,510 on other text (script output, workflow YAML) and
34 whose text comes from imported code and could not be traced. Only the 4,341
are Markdown assertions:

| MACHINE-TOKEN | STRUCTURAL | WORDING | UNRESOLVED |
|---:|---:|---:|---:|
| 14 | 35 | 4,094 | 198 |

164 files make assertions on Markdown text; 160 of them hold at least one
WORDING assertion, and 44 hold nothing else.
