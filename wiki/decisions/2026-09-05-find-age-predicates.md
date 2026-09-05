# Decision: File Age Is Asked in Minutes, Never in Days

Date: 2026-09-05

Status: Accepted

Ticket: CodySwannGT/lisa#3905

## Context

`find -mtime +N` does **not** mean "older than N days". `find` divides the age
by 86400 and **discards the remainder**, so `-mtime +N` matches only files older
than **N+1** days. Someone writing `-mtime +2` intending "older than two days"
silently under-selects by a full 24 hours.

The direction is what makes it worth a ruling rather than a note. The
under-selection reports **"nothing to do"**, and nobody questions an empty
result from a cleanup predicate — so it prevents needed work instead of causing
visible harm. It reproduced live during a `$TMPDIR` sweep: a node scan counted
5,232 entries at age >= 2 days while `find -maxdepth 1 -name 'cdk.*' -mtime +2`
returned 0. Both were correct answers to different questions; every one of those
5,232 sat inside the 2–3 day band.

## The measurement

Files stamped at known ages, asked of both instruments on the same directory:

| file age | `-mtime +2` | `-mmin +2880` |
| -------- | ----------- | ------------- |
| 47h      | no          | no            |
| 49h      | **no**      | **yes**       |
| 55h      | **no**      | **yes**       |
| 65h      | **no**      | **yes**       |
| 71h      | **no**      | **yes**       |
| 73h      | yes         | yes           |
| 95h      | yes         | yes           |

The **49h–71h band is the entire disagreement**. This table is not prose: it is
executed by `tests/unit/core/find-age-predicate-truncation.test.ts`, which
stamps the fixtures with `utimes` and runs the system `find`. A fixture at ten
days would pass under both readings and pin neither, so the boundary is the
whole measurement.

## The correction that has to travel with the fact

This was first reported — by the person who then disproved it — as a **broken
instrument**, a BSD `find` defect producing false zeros. That characterisation
is wrong, and any remediation built on "distrust `find`" would be aimed at the
wrong thing. Two controls disprove it:

- On files of unambiguous age (10 days, 3 days), `-mtime +2` returns 2 of 2.
- On the same `$TMPDIR`, `-mmin +360` returned exactly 7001 with exit 0,
  matching an independent count of 7001.

`find` is correct. It answers a **different question** than the flag appears to
ask, which is precisely why the form survives review — and why the remedy is a
structural rule rather than a bug fix.

A contributing factor worth naming separately: the original observation was
taken with `2>/dev/null`, a habit that converts "this broke" into "this returned
nothing". It was not the cause here, but it is why the wrong mechanism stayed
plausible as long as it did.

## The ruling

**Ask for age in minutes.** In tracked shell, `-mtime`, `-atime` and `-ctime`
are refused by `ast-grep/rules/no-day-truncating-file-age-predicate.yml`, which
ships to every stack template that carries an `sgconfig.yml`.

| you mean          | write                                       |
| ----------------- | ------------------------------------------- |
| older than N days | `-mmin +$((N * 1440))`                      |
| older than N days | `! -newermt "<ISO timestamp N days back>"`  |
| older than N hours| `-mmin +$((N * 60))`                        |
| never             | `-mtime +N`                                 |

`-mmin` is minute-granularity and is not truncated to days, so it means what it
reads. `-newermt` is exact but needs a timestamp, and **the two `date`
implementations disagree on how to produce one**: `date -v-2d` is BSD/macOS,
`date -d '2 days ago'` is GNU/Linux. Prefer `-mmin` in anything that runs on
both — which is every shell hook Lisa ships.

The truncation itself is POSIX rather than a BSD quirk. GNU `find` documents the
same behaviour ("any fractional part is ignored"), so the rule is not
platform-specific and neither is the test.

## What was deliberately not changed

Every age predicate in shipped code already uses `-mmin` and is correct as
written. Those eight sites are left exactly as they are; the rule exists because
`-mtime` is the form a maintainer reaches for by reflex, and the three hook
scripts carrying these predicates are copied across five per-agent plugin
variants — so one wrong edit lands in eight files at once.
