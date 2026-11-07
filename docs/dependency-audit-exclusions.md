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
`expiry_enforced`. Keys that start with `//` are comments. A key that nearly
matches one of the five scope fields fails the audit with a diagnostic that
names the field it expected. This covers a different case (`Paths`), a
singular or plural (`path`, `version`, `packages`), or a small typo
(`pathes`). Without that check the misspelled scope would be ignored and the
entry would excuse every copy instead of the one you meant. Any other extra key,
such as `url` or `title`, is ignored by the audit as before, and doctor notes
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

The pre-push built-in, dependency-vulnerability registry task, CI audit job,
and doctor share the canonical audit implementation. Lisa owns the governed
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
