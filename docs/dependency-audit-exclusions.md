# Dependency-audit exclusions

An audit exception accepts a particular risk. Restrict it to the copies that
were reviewed so a future vulnerable production dependency still blocks a push
or a CI run. Prefer `paths` over an advisory-wide exception whenever the
accepted vulnerable copy belongs only to a development tool.

Lisa reads `audit.ignore.config.json` and `audit.ignore.local.json`. The managed
file carries shared decisions; the local file carries repository decisions.
Keep a repository-specific exception in the local file. Each file contains an
`exclusions` array:

```json
{
  "exclusions": [
    {
      "id": "GHSA-xxxx-xxxx-xxxx",
      "package": "schema-lib",
      "versions": ">=3.0.0 <4.0.0",
      "paths": ["lint-tool/schema-lib"],
      "reason": "The reviewed lint tool requires this old major; application copies must remain fixed."
    }
  ]
}
```

`id` identifies the advisory. A `cve` can also identify it in a manager's
report. `package`, `versions`, and `paths` are optional restrictions, and all
present restrictions must hold together. `package` is the npm package name the
audit reports, in lowercase: `tar`, not `node-tar`; `jspdf`, not `jsPDF`.
`versions` is a semver range checked against installed vulnerable versions,
rather than a note in `reason` or a comparison of two advisory ranges. Keep the
reason readable and record the owner, tracking item, and review date required
by the project's exception policy.

The documented fields are `id`, `cve`, `package`, `versions`, `paths`,
`active`, and the decision record: `reason`, `notes`, `justification`,
`decision`, `rationale`, `comment`, `owner`, `tracking`, `review_by`, and
`expiry_enforced`. Advisory metadata copied from an audit report — `cwe`,
`ghsa`, `url`, `title`, `severity`, `cvss`, and `advisory` — is accepted too,
and doctor does not report it. Keys that start with `//` are comments. A key that nearly
matches one of the five scope fields fails the audit with a diagnostic that
names the field it expected. This covers a different case (`Paths`), a
singular or plural (`path`, `version`, `packages`), or a small typo
(`pathes`). Without that check the misspelled scope would be ignored and the
entry would excuse every copy instead of the one you meant. Any other extra key,
such as `href` or `ticket`, is ignored by the audit as before, and doctor notes
it so nobody mistakes it for a scope.

For a matching advisory, the matcher reads the resolved package name and exact
version of every lockfile copy inside the advisory's vulnerable range. An npm
alias keeps its own lockfile key but is checked using the real package it
resolves to. Fixed copies need no exception. Every vulnerable copy must fall
within the accepted path and version scope. Listing one development copy does
not exclude another vulnerable application copy, even when the application
uses an alias. Git, file, link, tarball, workspace and patch entries are not
registry copies, so the matcher skips them. A registry entry whose name or
version cannot be read still fails the audit.

Use keys from the selected package manager's lockfile:

| Lockfile | Path key | What the key isolates |
| --- | --- | --- |
| `bun.lock` | A key in the text JSONC `packages` map, such as `lint-tool/schema-lib` or an alias key | The copy nested under that parent package |
| `package-lock.json` | A v2/v3 `packages` key, such as `node_modules/lint-tool/node_modules/schema-lib` | A nested key isolates the parent. A hoisted key such as `node_modules/schema-lib` names an install location, and any package that resolves to that hoisted copy shares it |
| `yarn.lock` | The dependency selector key exposed by the lockfile parser, such as `schema-lib@^3.0.0` | The requested range, not a parent: every dependent asking for that range shares the copy |

Bun keys and nested npm keys tie an exception to one dependent. Yarn selectors
and hoisted npm keys are weaker. A later production dependency that requests
the same range, or resolves to the same hoisted copy, is covered by the same
key. Pair such a key with a tight `versions` range and review it whenever a
new dependent appears.

Paths are exact keys, without glob expansion. A package-name basename does not
stand for every nested copy. Refresh the reviewed keys when a lock update
changes the accepted dependency layout.

A path-scoped match reports `excluded GHSA-… for <paths> (reason)`. A finding
outside the scope fails and names the vulnerable lockfile paths. The failure
also says what to do next. Upgrade or override the named copy. If it is
dev-only and reviewed, add its lockfile path to `paths`. Empty `paths`, invalid
or unknown scope fields, missing or unreadable lockfiles, malformed lockfile
data, and unknown resolved package data fail with a diagnostic. They never
turn into an advisory-wide exclusion. A present scope requires readable
lockfile data even when the audit reports no high or critical findings. Binary
`bun.lockb` cannot establish text lockfile path coverage.

A narrower entry always wins. When a `paths` or `versions` entry exists for an
advisory and package, a wider entry for the same advisory and package cannot
accept a copy that the narrower entry rejected. A wider entry names no
`paths` or `versions`, and is typically a shared managed decision. The audit
prints that the advisory-wide exclusion was not applied, and doctor explains
which file's narrower entry took precedence.

An entry without `paths` keeps its existing non-path behavior. Any declared
`package` or `versions` restriction still applies. Omitting all three scope
fields retains the legacy advisory-ID-only behavior. Doctor's report lists any
entry with neither `paths` nor `versions` as a non-blocking observation, whether
or not it names a `package`. Such an entry still hides every copy of the
package, so doctor names the file and advisory and recommends adding `versions`
and `paths`. A written reason does not make an invalid scope valid.

The pre-push built-in, dependency-vulnerability registry task, and CI audit job
share the canonical audit implementation. The hook and the registry task choose
the package manager the same way: the `packageManager` field, then an engines
`please-use-<pm>` sentinel, then the lockfiles the engines do not forbid. The
CI fallback does not detect a manager. It audits the one its `package_manager`
input names, and that input defaults to `npm`. A caller of the reusable quality
workflow must set `package_manager` to the project's manager, or CI can audit a
different lockfile than the hook does — for example, a stale
`package-lock.json` in a Bun project.

Doctor uses the same field and scope validation and checks that the lockfile is
readable, but it does not perform every check the audit does. It does not match
advisories against lockfile copies, so a valid-looking path that names the
wrong copy can pass doctor and still be rejected by the audit. It names an
entry with no `id` by its package or position rather than rejecting it, while
the audit refuses that entry. It also passes over an exclusion file that does
not parse, which the audit refuses too. A doctor pass is not proof that the
audit will accept the exclusion files; the audit itself is. Lisa owns the governed
`security:audit:lisa` task and supplies `security:audit` as its default alias.
Applying Lisa preserves a project's existing `security:audit` composition and
its additional checks. Project-owned provers can call the governed task or
import `@codyswann/lisa/audit` instead of copying an ID filter.

The reusable CI fallback runs a workflow-owned action at an immutable source
revision. The action installs its pinned dependencies in its own directory and
bundles the same canonical matcher into temporary runtime output. It needs
neither a newly applied adapter file nor the new audit export in the caller's
installed Lisa package. Its dependency installation does not replace the
caller's dependency tree. An explicitly declared project security task still
replaces the fallback and remains responsible for invoking the helper and
retaining its other security checks.

```js
import { runDependencyAudit } from "@codyswann/lisa/audit";

const verdict = await runDependencyAudit(process.cwd());
for (const message of verdict.messages) console.log(message);
process.exitCode = verdict.passed ? 0 : 1;
```

`evaluateAuditReport(root, manager, report)` evaluates an already captured
manager report with the same exclusions and lockfile checks. Controlled report
fixtures prove matcher behavior only; a project still needs a successful live
audit query to claim that its dependency tree was audited.

## Advisory patches

An advisory that no published release fixes can be resolved by patching the
vulnerable copy instead of excluding it. This is not an exclusion: the audit
proves the fix on every run. A Bun project declares the patch in
`patchedDependencies`, and the patch file's own header names what it fixes:

```
Lisa-Advisory: GHSA-xxxx-xxxx-xxxx
Lisa-Regression-Test: .lisa/patches/<name>.regression.mjs
Lisa-Patched-File: lib/parse.js sha256:<hex of the file after patching>
```

The canonical audit (`runDependencyAudit`, `verifyCapturedAudit`, the
`security:audit:lisa` task and the pre-push hook) treats such an advisory as
resolved only when all of these hold:

- every vulnerable copy in the lockfile and in `node_modules` has a declared
  patch whose header names the advisory;
- every `Lisa-Patched-File` is a file the patch's `diff --git` lines change,
  as a relative path inside the package, and every installed copy's file
  hashes to the declared SHA-256. Every copy is found, including one under a
  linked workspace package: symlinks are followed and each copy is checked
  once by its real path;
- the patch's `name@version` is the advisory's package and inside its
  vulnerable range, and at least one locked or installed copy is in that range;
- the named regression test (a relative path inside the project) is **run**:
  it must exit 0 against every installed copy and exit non-zero against the
  same package with the patch reversed, each run bounded to two minutes. A
  test that passes either way (an empty test, a patch that changes no code)
  proves nothing and fails the audit;
- the npm registry publishes no non-prerelease version newer than the patched
  one and outside the advisory's vulnerable range.

When the last condition stops holding, the audit fails and names the fixed
version: upgrade and delete the patch. A registry that cannot be reached, or
does not answer within 30 seconds, fails the audit closed. `evaluateAuditReport` cannot query the registry, so it never
credits a patch.

The header is a claim; running the test is the proof. Because the header
travels with the patch, there is no separate list mapping patches to
advisories to fall out of date.

Lisa ships its own patches (currently picomatch, GHSA-fc5q-39xc-vjpf) to every
TypeScript project through `.lisa/patches/` and `force.patchedDependencies`.
Only Bun applies `patchedDependencies`, so the audit credits a patch only when
it runs for Bun. npm and Yarn classic ignore the field Lisa forces, so the
installed copy there is the unpatched one: the patch gets no credit, the
advisory remains a finding, and the failing audit names the patch and the real
fix (switch the project to Bun, or upgrade once a fixed release exists) rather
than a reinstall that could never apply it. pnpm can apply patches natively,
but Lisa's audit does not run for pnpm at all; its refusal names the same fix
when the project carries advisory patches.

### What the picomatch patch changes

The picomatch patch keeps every repeated extglob (`+(...)`, `*(...)`) from
backtracking catastrophically: a `*` at any depth (`+(*a)`, `+(@(*))`), a
negation (`+(!(a))`), a run of `*(c)` groups whose copies can overlap
(`+(*(a)a)`), a repeat hidden inside `@(...)` (`+(@(+([ab])))`), and branches
that can split the same text into copies in two ways (`+([ab]|b)`,
`+(a|b|ab)`, `+(*(ab)c|abc)`, a nested group overlapping its own branch as in
`+(a*([ab]))`, and `+(b|B)` under `nocase`). Branches inside a whole-branch `@(...)` are checked as if
written directly in the repeat.

The check fails closed. It reads only the syntax picomatch is known to
compile to itself: plain characters, `?`, escaped symbols, brackets, `/`,
POSIX classes and groups. Any branch holding something else is treated as
risky, even when it would not backtrack: a brace or range (`+({a,a})`,
`+({a..b}|a)`), a quote (`+(a|"a")`), a regex escape (`+(\w|a)`, since `\w`
reaches the regex as a class), or a bare `+` (`+(a+)`, since inside an extglob
`a+` is a regex quantifier). A POSIX class and `[!a]` count as any character,
so `+(a|[[:alpha:]])` is caught; that overstates, which only ever makes a
pattern literal, never lets one through.

Where an equivalent flat regex exists it is used, so `+(*a|b)`, `+(@(*))` and
`+(!(a))` match exactly what they matched before. Where none exists the
pattern is compiled as a **literal**, as picomatch already does for other
risky repeated extglobs such as `+(a|aa)`: `+(a*|*b)`, `+(a*b|a)`, `+(*(a)a)`,
`+([ab]|b)`, `+(a|b|ab)`, `+(a*([ab]))`, `+({a,b})` and `+(a|"a")` then match
only a file literally named `+(a*|*b)` and so on, which in practice is
nothing. Unambiguous
alternations such as `+(js|ts|jsx)`, `+(foo|far)` and `*(f*(o))` are unchanged,
and `+(@(*(a)))` compiles to the same `a*` as `+(*(a))`. No Lisa
configuration or default tool glob uses any of these shapes.

**The literal fallback is a behaviour change, on purpose.** Failing closed
means some patterns that never backtracked now match only their own text:
`+({a,b})` matches a file named `+({a,b})` and no longer matches `a`, and
`+("a b")` matches only `+("a b")`. The same is true for every branch with a
brace, range, quote or regex escape, and for every branch the check can only
overstate (a POSIX class or `[!a]` beside a branch it might overlap, as in
`+([[:alpha:]]|1)`). Lisa's own source and shipped templates use none of
these: a search of every tracked file outside `plugins/` and `tests/` for an
extglob holding a brace, quote or bracket finds no glob, and the 270 tool
config files (lint-staged, knip, vitest, vite, jest, tsconfig, eslint,
sgconfig, `.prettierignore`, `package.json` and `package.lisa.json`, all
stacks) hold no extglob at all.

**A `+` right after a glob group.** Where `+(` is followed by `?`, or `+`
ends the pattern or precedes anything but `(`, picomatch does not open an
extglob and passes the `+` to the regex as a quantifier on whatever group
came before. After a negation, `!(a)+(?(c))` became `(?:(?!a)[^/]*?)+` and
hung. The patch keeps that `+` literal, as bash reads it, after a closed
`!(...)`, `?(...)`, `+(...)` or `*(...)`, after an `@(...)` whose body is
risky as a repeat (`@(a|a)+`), and after a brace group whose elements are
(`{a,a}+`). A safe group keeps its quantifier: `@(js|ts)+` and the brace
Kleene plus `{ab,c}+` match as before. `*`, `?`, `@` and `!` after a group
never quantify it (`*` is a glob star, `?` makes it optional, `@` and `!` are
text), and the regression script covers each of them after every group
shape. picomatch 2.3.2 also lost the text after a bracket once an earlier
extglob had been made literal, which turned `+(a|aa)|+([a]b|a)` into the
ambiguous `+([a]|a)`; the 2.3.2 patch carries the 4.x fix for that.

**Plain regex groups are out of scope.** picomatch passes a bare group such
as `(a|a)+b` to the regex unchanged; that is its documented regex
passthrough, not glob syntax, so this advisory does not cover it and the
patch leaves it alone. A pattern author who writes regex syntax gets regex
semantics. No Lisa code path gives picomatch or micromatch a pattern from
outside the repository. Lisa never calls either library itself: its own
matching uses minimatch (`src/utils/ignore-patterns.ts`) and `node:fs`
`globSync`, which this advisory does not affect. Patterns reach picomatch
only through the tools a project configures (vitest, vite, jest, knip,
lint-staged), from config the repository itself holds, and through the
vitest `--exclude` arguments `lisa-test-run` builds from repository paths,
with every glob metacharacter escaped first
(`src/cli/lisa-test-run-shard-files.ts`, `literalGlob`).
