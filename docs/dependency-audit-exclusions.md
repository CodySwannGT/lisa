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
present restrictions must hold together. `versions` is a semver range checked
against installed vulnerable versions, rather than a note in `reason` or a
comparison of two advisory ranges. Keep the reason readable and record the
owner, tracking item, and review date required by the project's exception
policy.

For a matching advisory, the matcher reads the resolved package name and exact
version of every lockfile copy inside the advisory's vulnerable range. An npm
alias keeps its own lockfile key but is checked using the real package it
resolves to. Fixed copies need no exception. Every vulnerable copy must fall
within the accepted path and version scope. Listing one development copy does
not exclude another vulnerable application copy, even when the application
uses an alias.

Use keys from the selected package manager's lockfile:

| Lockfile | Path key |
| --- | --- |
| `bun.lock` | A key in the text JSONC `packages` map, such as `lint-tool/schema-lib` or an alias key |
| `package-lock.json` | A v2/v3 `packages` key, such as `node_modules/lint-tool/node_modules/schema-lib` |
| `yarn.lock` | The dependency selector key exposed by the lockfile parser |

Paths are exact keys, without glob expansion. A package-name basename does not
stand for every nested copy. Refresh the reviewed keys when a lock update
changes the accepted dependency layout.

A path-scoped match reports `excluded GHSA-… for <paths> (reason)`. A finding
outside the scope fails and names the vulnerable lockfile paths. Empty `paths`,
invalid scope fields, missing or unreadable lockfiles, malformed lockfile data,
and unknown resolved package data fail with a diagnostic. They never turn
into an advisory-wide exclusion. A present scope requires readable lockfile
data even when the audit reports no high or critical findings. Binary
`bun.lockb` cannot establish text lockfile path coverage.

An entry without `paths` keeps its existing non-path behavior. Any declared
`package` or `versions` restriction still applies. Omitting all three scope
fields retains the legacy advisory-ID-only behavior; doctor warns that such
an exception is unscoped. A written reason does not make an invalid scope valid.

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
