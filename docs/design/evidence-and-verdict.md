# Evidence and verdict

The [paired proof](paired-proof.md) says whether each control works. This
note covers what is written down afterwards, and what an operator can show to
someone else: one evidence file, and one verdict computed from it.

```
lisa controls attest [path] --workspace <folder>   # prove, then write three files
lisa controls attest [path] --check                # write nothing: is the verdict still right?
```

| file | what it is | who writes it |
| --- | --- | --- |
| `.lisa/controls/evidence.json` | Every result the attest step recorded, one record per result per requirement. | `lisa controls attest` |
| `.lisa/controls/register.json` | The control register. Generated from the gates declaration and the evidence file. | `lisa controls register`, and `lisa controls attest` after it writes evidence |
| `.lisa/controls/verdict.json` | One word per Level 1 requirement, one overall result, and a digest of the other two files. | `lisa controls attest` |

All three are generated. None is edited by hand. No model is asked anything
at any step, so the same inputs always give the same files.

## The evidence file

`{ "schema_version": 1, "records": [...] }`, records ordered by `id`, keys
in a fixed order, two-space indent. The published contract is
`schemas/control-evidence.schema.json`.

### One record per result per requirement

A result is about a register entry. Everything that reads evidence looks a
record up by its requirement (`criterion`). A register entry can serve
several requirements, so a result is written once for each requirement its
entry serves. A paired proof of an entry that serves two requirements is four
records: two halves, twice. An entry that serves no requirement gets no
record, because there is no requirement for it to be evidence of.

### The fields

| field | meaning |
| --- | --- |
| `id` | See "The identifier" below. |
| `criterion` | The requirement the record is evidence for. |
| `entry_id` | The register entry it is about, or `null` on a record of an audit finding. |
| `scope` | The folder it is about; `.` is the whole repository. |
| `rung` | How strongly it is known: `asserted`, `observed` or `exercised`. |
| `half` | `violation` or `clean`. Present exactly when `rung` is `exercised`. |
| `moment` | `commit`, `push` or `pull-request`; `null` on a record of an audit finding. |
| `result` | `held`, `failed`, `unknown`, or (audit findings only) `not-applicable`. |
| `reason` | A short fixed word: the proof's reason, or the audit finding's state. |
| `detail` | The same as a sentence. On a `not-applicable` record it is the fact. |
| `commit` | The repository's HEAD commit when the record was made; `null` with no commit or no git. |
| `command` | What was started, one item per argument, or `null`. |
| `exit_status` | Its exit status, or `null`. |
| `started_at`, `completed_at` | UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`. |
| `freshness_seconds` | How long after `completed_at` the record may be relied on. |
| `output_excerpt`, `output_truncated` | The last 1000 characters of what the check printed, cut at a line start. |

### The three rungs

| rung | means | written from |
| --- | --- | --- |
| `asserted` | It was said, and nothing checked it. | A person's answer to the audit's question; an audit finding nothing confirmed. |
| `observed` | Something was looked at where it is. Nothing was planted. | A step that reads the hosting platform's settings; an audit finding whose file and line the attest step found. |
| `exercised` | A change was planted and the control's answer recorded. | One half of a paired proof. |

An exercised record is one half of a pair, so it always names its `half`. A
record at any other rung never does.

### What `result` says

`result` is what the record shows about the requirement, not what the check
printed. For a half of a paired proof:

| half | check's answer | `result` |
| --- | --- | --- |
| `violation` | rejected, in the declared failure text | `held` |
| `violation` | accepted | `failed` |
| `clean` | accepted | `held` |
| `clean` | rejected | `failed` |
| either | no answer that can be relied on | `unknown` |

The control register reads the same field. An entry whose pull-request check
runs from a file Lisa did not write reads `unproved` until both halves of its
proof at that moment are on record **and each says `held`**. A half that was
run and failed does not clear the mark.

### The identifier

`<entry id>/<moment>/<half or rung>/<criterion>`, for example
`code-style@api/commit/violation/SI7` and
`code-style@api/pull-request/observed/SI7`. A record of an audit finding is
`audit-finding/<criterion>@<scope>`, for example `audit-finding/AC1.4@.`.

Nothing else goes in: no time, no counter. The same proof of the same control
has the same identifier on every run, so a later run replaces the record
instead of adding one beside it. An audit finding cites a record by this
identifier in its `evidence_id`.

### The latest run replaces, it does not add

A run speaks for every entry it covers at every moment it covers. Every
earlier record of those entries at those moments is removed, whether or not
the run has a result to put in its place. An entry whose proof could not be
run this time is left with no record, and its requirement reads `unknown`,
rather than with last month's pass.

A paired-proof run covers every register entry at `commit` and `push`, and
takes only the halves run at those two moments. The step that settles the
pull-request moment hands over its own batch for `pull-request`
(`pull-request-evidence.ts`): one `observed` result per entry from what the
hosting platform's merge-protection settings said (`held` when every check
of the entry is required, `failed` when one is not, `unknown` when they
could not be read, nothing when the platform was not asked), and the two
`exercised` halves of an entry whose canary pull requests were run. So a
canary half is written from one place, once per requirement.

That batch names every pull-request entry when canaries were asked for. When
the run only read the settings, it leaves out an entry for which a canary's
answer is on record and still within its lifetime, unless the settings now
say the entry's check is not required: an observation plants nothing, so it
does not remove a current exercised proof, and the earlier records stay to
age. A register with no pull-request entry gets no such batch, and those
records, if any, are left in place too.

Records are also removed when the register no longer holds their entry, or
the entry no longer serves their requirement. Records of audit findings are
replaced as one set on every run.

### What the audit report contributes

Most requirements are served by no control, so no proof can be run for them.
What is known about them is what the audit found. When
`.lisa/audit/report.json` passes its check, each finding is copied into the
evidence file as one record, dated when the attest step read the report.

What a finding that says "this is there" (`exists-not-enforced`) is worth
depends on what kind of thing answers the requirement, which the catalogue
says:

| requirement's `kind` | the attest step | record |
| --- | --- | --- |
| `artifact` (a record that exists) | opens every file the finding points at and looks for the line, itself, at that moment. It does not rely on the report's own check having run. | Every line found: `observed`, `held`, reason `artifact-located`. The finding points nowhere, or a line is not there: `asserted`, `unknown`, reason `artifact-not-found`. |
| `human-attested` (a person vouches for it) | looks for a person's answer on record to the question `<criterion>@<scope>`. | An answer is on record: `asserted`, `held`, reason `person-attested`, with the question's id and the answer quoted in `detail`. None: `asserted`, `unknown`, reason `no-attestation`. |
| `gate` (a check) | does nothing more. | `asserted`, `held`, with the finding's state as the reason. It never makes the requirement conforming. |

A finding in any other state is written the same way for every kind, at the
`asserted` rung, with the state as the reason and the finding's `what` as
the detail:

| finding's state | record's `result` |
| --- | --- |
| `missing` | `failed` |
| `unknown`, `question` | `unknown` |
| `not-applicable` | `not-applicable`, with the finding's `what` as the fact |
| `proved` | no record: the finding only repeats a record already on file |

They are copied, and not read at verdict time, so that the verdict rests on
the register and the evidence and nothing else, and its digest covers all of
it. When there is no report, or it does not pass its check, no finding is
recorded and the command says so.

A record of an audit finding cannot back a `proved` finding in a later
audit: `lisa controls report-check` turns away a record whose `entry_id` is
`null`, and any record whose `result` is not `held`. An audit that cited
them would be citing itself, or citing a failure as proof.

### Freshness

Every record carries `freshness_seconds`. The default is **30 days**
(2 592 000 seconds). A check wired into a repository changes whenever its
configuration does, so a month is long enough that an attest run on a
monthly schedule keeps a verdict current, and short enough that a control
nobody has run since last quarter stops counting. No lifetime may be longer
than twelve months, which is the specification's ceiling.

The gates declaration cannot change the lifetime. The code that calls the
writer can (`freshnessSeconds` on `recordAttestation`); the command does not
yet offer a flag for it.

A record is current from `completed_at` up to, and not including,
`completed_at + freshness_seconds`. The current time is a parameter
everywhere it is used: the command reads the machine's clock, and everything
below it is handed the time.

### Output and secrets

A record keeps the end of what a check printed, and a check can print
anything. `prepareEvidenceExcerpt` in `src/controls/evidence-write.ts` is the
one place that text enters a record. It does not look for secret values. The
step that does belongs there, before the cut. `detail` on a record of an
audit finding is the finding's `what`, word for word, and is covered by
whatever checks the audit report.

## The verdict

The published contract is `schemas/control-verdict.schema.json`.

```json
{
  "schema_version": 1,
  "requirements": { "specification": "…", "specification_version": "…", "level": 1, "sha256": "…" },
  "result": "non-conforming",
  "prevented_by": ["AC1.1", "…"],
  "counts": { "conforming": 1, "non-conforming": 0, "unknown": 76, "not-applicable": 0 },
  "criteria": [
    {
      "criterion": "SI7",
      "verdict": "conforming",
      "reason": "control-proved",
      "detail": "Every control that serves this requirement held when it was checked: …",
      "kind": "gate",
      "minimum_rung": "exercised",
      "rung": "exercised",
      "entries": ["code-style@."],
      "evidence": ["code-style@./commit/clean/SI7", "code-style@./commit/violation/SI7"],
      "fact": null
    }
  ],
  "evidence_as_of": "…",
  "current_until": "…",
  "digest": { "algorithm": "sha256", "register": "…", "evidence": "…", "value": "…" }
}
```

Nothing in it depends on when it was written. `evidence_as_of` is the newest
record's `completed_at`, and `current_until` is the first instant a record
the verdict rests on stops being current. Both are read from the evidence.

### How a requirement is judged

A requirement is judged on **answers**. Each register entry that lists the
requirement is one answer. Each record of an audit finding for the
requirement is one answer too, unless a control already covers its folder: a
control that serves the requirement covers its own folder, a control for the
whole repository covers every folder, and the audit's finding for the whole
repository is set aside as soon as any control serves the requirement.

One control's answer, first row that applies:

| the evidence on record for this control and this requirement | answer | `reason` |
| --- | --- | --- |
| There is none. | `unknown` | `no-evidence` |
| A current record says `failed`. | `non-conforming` | `control-failed` |
| A record is past its lifetime. | `unknown` | `stale-evidence` |
| A record is dated later than now. | `unknown` | `evidence-dated-later` |
| Nothing held. Exercised evidence holds only as a pair: both halves, for the same moment, each `held`. | `unknown` | `proof-incomplete` |
| What held is weaker than the requirement's `minimum_rung`. | `unknown` | `rung-too-low` |
| Otherwise. | `conforming`, at the strongest rung that held | `control-proved` |

One audit finding's answer, first row that applies:

| the record written from the finding | answer | `reason` |
| --- | --- | --- |
| It is not current. | `unknown` | `stale-evidence` or `evidence-dated-later` |
| `failed` (the audit found nothing). | `non-conforming` | `nothing-found` |
| `unknown`, because the record was not where the audit pointed. | `unknown` | `artifact-not-found` |
| `unknown`, because no person's answer is on record. | `unknown` | `no-attestation` |
| `unknown` for any other reason (an outside system holds the answer, or a question is open). | `unknown` | `audit-unknown` |
| `not-applicable`. | `not-applicable`, citing the record's `detail` as the fact | `not-applicable` |
| `held`, the requirement is `human-attested`, and the record says a person's answer is on record. | `conforming`, rung `asserted` | `person-attested` |
| `held`, the requirement is `human-attested`, and the record does not say so. | `unknown` | `no-attestation` |
| `held`, the requirement is `artifact`, and the record's rung is at least its `minimum_rung`. | `conforming`, rung `observed` | `artifact-located` |
| `held`, the requirement is `artifact`, and the record's rung is below its `minimum_rung`. | `unknown` | `rung-too-low` |
| `held`, the requirement is a `gate` (or of a kind the catalogue does not name). | `unknown` | `rung-too-low` |

The requirement's verdict:

| its answers | verdict |
| --- | --- |
| None at all. | `unknown` (`no-evidence`) |
| Any `non-conforming`. | `non-conforming` |
| Otherwise, any `unknown`. | `unknown` |
| Otherwise, any `conforming`. | `conforming` |
| Every one `not-applicable`. | `not-applicable`, citing each fact |

So a failure in one folder makes the requirement non-conforming, one control
without a proof makes it unknown, and it is not applicable only when it
applies nowhere. `not-applicable` is never a default: it exists only where a
record carries the fact.

What this means for each kind of requirement in the catalogue:

| `kind` | `minimum_rung` | how it becomes conforming | `rung` the verdict shows |
| --- | --- | --- | --- |
| `gate` | `exercised` | A register entry serves it and its paired proof held. | `exercised` |
| `gate` | `observed` | A register entry serves it, and either its paired proof held or a setting read from the platform held. | `exercised` or `observed` |
| `artifact` | `exercised` | A register entry serves it and its paired proof held. A located file is not enough. | `exercised` |
| `artifact` | `observed` | The audit points at where it is recorded and the attest step finds every line; or a register entry serves it. | `observed`, or the entry's rung |
| `human-attested` | `asserted` | The audit found it written down and a person answered the audit's question for it; or a register entry serves it. | `asserted`, or the entry's rung |

A requirement that is conforming always carries the weakest rung it rests
on, so a reader can see which answers rest on a proof and which on something
weaker. The three rungs do not mean the same thing, and each has a limit:

- `exercised` is a proof: a change that breaks the rule was planted and
  turned away, and a clean one was let through.
- `observed`, on a requirement of kind `artifact`, is a located file. Code
  confirmed that the file and line the audit pointed at exist. That the file
  is the record the requirement asks for, and that it says what it should,
  is the judgement of the agent that ran the audit. Nobody and nothing
  checked that judgement.
- `asserted`, on a requirement of kind `human-attested`, is a person's word.
  It is as good as the person who gave it. An agent's finding alone never
  produces it: with no answer on record the requirement is `unknown`.

A finding never makes a `gate` requirement conforming, and never makes an
`artifact` requirement that needs exercised evidence conforming. Those are
met only by a control declared in the gates block, with a change that breaks
its rule and one that does not.

### The Level 1 result

`conforming` only when every in-scope requirement is `conforming` or
`not-applicable`. Unknown is never conforming. `prevented_by` names every
requirement that stands in the way, in the catalogue's order.

### The digest

```
register = sha256(canonical(register.json))
evidence = sha256(canonical(evidence.json))
value    = sha256(canonical({ "evidence": <evidence.json>, "register": <register.json> }))
```

`canonical` is the JSON value written with object keys in code-unit order at
every depth, no spaces, and lists in their own order
(`src/controls/canonical-json.ts`). Two files that hold the same values give
the same digest however they are indented. `requirements.sha256` is the same
digest of the requirements catalogue the verdict was computed against.

### The order of writing

1. The evidence.
2. The register. It is generated from the declaration and the evidence, so
   new evidence can change it: an entry stops reading `unproved` once both
   halves of its proof held.
3. The verdict, from that register and that evidence.

In any other order the digest would cover a register that
`lisa controls register --check` then calls out of date.

## The check

`lisa controls attest --check` runs no proof and writes nothing.

| it compares | with | and says, for example |
| --- | --- | --- |
| The committed register | The register generated now from the declaration and the evidence. This is the comparison `lisa controls register --check` makes. | `The entry "code-style@api" in .lisa/controls/register.json does not match the gates declaration: tier differs.` |
| The committed evidence file | The exact shape the attest step writes: every object closed, every value in its word list, every identifier the one its record's fields give. | `.lisa/controls/evidence.json: Record 3 ("by-hand"): "entry_id" is missing.` |
| The digests in the verdict | The digests of the register and the evidence now. | `.lisa/controls/evidence.json is not the evidence this verdict was computed from: …` |
| The Level 1 result | The result computed now. | `.lisa/controls/verdict.json says the Level 1 result is "conforming"; the register and the evidence give non-conforming.` |
| Each requirement's verdict | The verdict computed now, at the current time. | `SI7: .lisa/controls/verdict.json says "conforming"; the register and the evidence give unknown. Evidence record "…" is too old to rely on: it stopped being current at …` |
| Everything else in the verdict | The same value computed now. | `.lisa/controls/verdict.json says "current_until" is …; the register and the evidence give ….` |

| exit | means |
| --- | --- |
| 0 | The committed verdict is what the register and the evidence give. This says the verdict is authentic and current, not that the result is conforming; the line it prints says which. |
| 1 | Something differs. Each difference was named. |
| 2 | Nothing could be compared: the path is not a folder, or the gates declaration was refused. |

### What each kind of edit runs into

| someone | the check |
| --- | --- |
| edits the verdict to read conforming | computes it again and names the result and each requirement that differs |
| edits an evidence record to flip a result | finds the evidence digest no longer matches, and that the verdict differs from what the edited evidence gives |
| edits an evidence record and the digest in the verdict to match | still computes the verdict again from the edited evidence, and names every requirement whose word differs |
| removes a record of a failure | finds the evidence digest no longer matches |
| lengthens a record's lifetime, or moves its time | finds the evidence digest no longer matches |
| edits the register | finds the register differs from what the declaration and the evidence produce |
| waits until a record's lifetime is over | finds the requirement is now `unknown` |

### What a local check cannot show

The check shows that the three files agree with each other, with the gates
declaration, and with the clock. It cannot show that the evidence records are
what a run really produced. Someone who rewrites the evidence, the register
and the verdict together, consistently, leaves three files that agree, and
nothing checked on the same machine with no secret can tell that from a real
run. A clock set back makes old evidence current again in the same way.

What can tell the difference lies outside this command: running
`lisa controls attest` again at the commit the records name and comparing;
the history of the three files in version control, where a change to the
evidence with no attest run behind it is visible; or a signature made
somewhere the author of the change cannot reach.

`commit` on a record is the HEAD commit when the run's results were written
down. It does not say the working tree was clean. A proof run on uncommitted
changes records the commit underneath them.
