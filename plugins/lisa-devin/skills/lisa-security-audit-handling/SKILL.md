---
name: lisa-security-audit-handling
description: "What to do when the dependency security audit blocks a push or CI, in order: upgrade or override, exclude an advisory that cannot reach the project, replace or remove the dependency, fix upstream, and only last, behind a human gate, fork, patch or vendor it. Never bypasses the hook."
---

# Security Audit Handling

Use this when `git push` (or a CI audit gate) fails because the dependency audit reports high or critical advisories. Work the decision ladder below **autonomously**. Exactly one rung waits for a person, `own-copy`, and it is a declared human gate in every mode; under `humanGate.mode: "strict"` one more stop applies (see `replace-or-remove`). Never use `--no-verify`, `HUSKY=0`, `core.hooksPath`, or any other hook bypass to skip the security audit.

## The decision ladder

The remediation for any high/critical advisory is an ordered decision, not a question to forward to the user. For each advisory, work the rungs **in this order** and stop at the first one that resolves it. The audit's failure message prints the same order.

- **(a) `upgrade`** — upgrade the offending package to a fixed version. When it is transitive and no straight upgrade lands the fix, force a resolution/override on the vulnerable **leaf** package.
- **(b) `exclude-unreachable`** — evaluate reachability **before considering any code change**. If the advisory cannot affect this project, add a scoped exclusion with a concrete reason to `audit.ignore.local.json`. No human is needed. Typical unreachable cases: the package is used only by dev or build tooling, or the vulnerable input is never untrusted (for example, globs or patterns written in the repository itself). The evaluation is this project's own: Lisa's template exclusions cannot vouch for a host's reachability, so a host the audit flags records its own entry in `audit.ignore.local.json`. **If reachability cannot be proven, treat the advisory as affecting the project** and continue at (c) and (d).
- **(c) `replace-or-remove`** — replace or remove the dependency, or switch to an alternative. Guarding our own call site so untrusted input cannot reach the vulnerable path also counts here, but the audit still reports the package afterwards: re-run the (b) evaluation and record a scoped exclusion whose `reason` cites the guard as the evidence. Changing the library's own code does not count (that is `own-copy`).
- **(d) `fix-upstream`** — contribute the fix upstream. This is fine to do in parallel with (c).
- **(e) `own-copy`** — **last, and only through a human gate:** fork the library, patch it (patch-package, Bun or pnpm `patchedDependencies`, `yarn patch`, a `patches/` directory), or vendor a copy of it. File the work held through `lisa-track` with `human_gate: "approve maintaining our own copy of <pkg>"` (the `own-dependency-copy` act in `ready-role-filing`), and write none of that code until a person releases the gate.

**Why `own-copy` is a gate.** The no-assumed-human rule still holds: every other rung is a decision you make and record yourself. A fork, patch or vendored copy is different. It is maintenance we take on indefinitely, and it travels with whatever the project distributes: in Lisa itself, copy-overwrite ships it to every host. So it is one of the explicitly declared human gates, not a decision.

**While the project is exposed.** If the advisory affects the project and (c) is not possible now, you may accept the risk for a bounded time while (d) is pending: add an exclusion entry whose `reason` records the impact, why no fix or replacement is possible now, and an expiry date, and file a build-ready follow-up work item to remove it when the fix ships. Under `humanGate.mode: "strict"`, stop for a human instead: post on the work item which advisory affects the project, how it is reached, and why no fix exists, and mark the item needs-human (in an interactive session, ask the operator).

## Node.js Projects (GHSA advisories)

1. Note the GHSA ID(s), affected package(s), and advisory URL from the error output.
2. Check the advisory URL to determine whether a patched version of the vulnerable package exists.
3. **(a) `upgrade`:** If a patched version exists and is compatible, add a resolution/override in `package.json` to force the patched version (add to **both** `resolutions` and `overrides`), run the package manager install to regenerate the lockfile, commit, and retry the push. If no straight upgrade lands it but a compatible patched version exists somewhere on the graph, pin it via `resolutions` + `overrides` on the **leaf** package (see "Override the vulnerable package, not its parent" below).
4. **(b) `exclude-unreachable`:** If no upgrade or override is possible (no fixed version exists, or every compatible pin breaks a dependent), decide whether the vulnerability can affect this project **before changing any code**. Consider: is the vulnerable code path reachable from this project's usage? Does it process untrusted input? Is the dependency runtime, or dev/build-only? If it cannot affect the project, add an exclusion entry to `audit.ignore.local.json` yourself, scoped to the copy you evaluated, in the format `{"id": "GHSA-xxx", "package": "pkg-name", "versions": "<range of the evaluated copy>", "paths": ["<lockfile key of the evaluated copy>"], "reason": "<impact evaluation: why this advisory does not affect this project>"}` (the scope fields are explained below), then commit and retry the push. No human approval is required for this step — the `reason` field is the record of your evaluation. If you cannot show it is unreachable, it affects the project: go on to step 5.
   - **Scope the exclusion to the copy you evaluated.** An entry with only `id` (and `package`) hides the advisory for every copy of the package, including one a production dependency pulls in later. Two optional fields narrow it, and every field present must hold together:
     - `versions` — a semver range the excused installed copies must fall inside, such as `">=3.0.0 <4.0.0"`.
     - `paths` — a non-empty array of exact lockfile key paths for the excused copies: a `bun.lock` `packages` key such as `"lint-plugin/pkg"`, a `package-lock.json` `packages` key such as `"node_modules/lint-plugin/node_modules/pkg"`, or a `yarn.lock` selector key. No globs. Bun keys and nested npm keys isolate one parent. A `yarn.lock` selector names a requested range, not a parent, and a hoisted npm key (`"node_modules/pkg"`) names an install location; any later dependent that asks for that range or resolves to that hoisted copy is covered too, so pair those keys with a tight `versions` range.
     - `package` is the lowercase npm name the audit reports (`tar`, not `node-tar`). A misspelled scope field (`path`, `version`, `Paths`) fails the audit instead of silently excusing every copy; other extra keys are ignored.
   - **Whenever the vulnerable copy is dev-only** (reached only through a devDependency, such as a lint plugin pinned to an old major), add `versions` and `paths` rather than an ID-wide entry:
     ```json
     {"id": "GHSA-xxx", "package": "pkg", "versions": ">=3.0.0 <4.0.0", "paths": ["lint-plugin/pkg"], "reason": "<impact evaluation>"}
     ```
     Then any other vulnerable copy — on an unlisted path or through an npm alias — still fails the audit and is named by its lockfile path. An empty `paths` array, an invalid range, or an unreadable lockfile fails the audit with a diagnostic; it never widens into an ID-wide exclusion. The pre-push hook, the gate registry, and CI use the same matcher. `lisa doctor` checks the scope fields and that the lockfile is readable, and reports any remaining exclusion without `versions` or `paths`, but it does not match advisories against lockfile copies — a valid-looking path that names the wrong copy can pass doctor and still be rejected by the audit. Doctor also does not reject an entry with no `id` or an exclusion file that does not parse; the audit does. Only the audit proves the exclusion files are accepted. In CI, the reusable workflow audits the manager its `package_manager` input names (default `npm`), so set that input to the project's manager. A scoped entry always wins over a wider entry for the same advisory and package. Full contract: https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md
5. **(c) `replace-or-remove` and (d) `fix-upstream`:** If the advisory affects the project, replace or remove the vulnerable package or switch to an alternative, then retry. If you instead guard our own call site so untrusted input cannot reach it, the audit still reports the package: re-evaluate reachability as in step 4 and add a scoped exclusion whose `reason` cites the guard, then retry. Open the upstream fix (an issue or pull request on the library) in parallel. If the project stays exposed until upstream ships, record the time-boxed risk acceptance described under "While the project is exposed" (under `strict`, stop for a human instead).
6. **(e) `own-copy`:** Only when (a) through (d) cannot resolve it: file a held work item through `lisa-track` with `human_gate: "approve maintaining our own copy of <pkg>"`. Do not add `patchedDependencies`, patch-package, `yarn patch`, a `patches/` directory, a git fork in `package.json`, or a vendored copy before a person releases that gate. A fork or vendored copy also inherits the `dependency-internalization-kit` rule's evidence bar once the gate is released.

### Critical: Override the vulnerable package, not its parent

When the audit output shows a dependency chain like `@expo/cli › glob › minimatch`, the vulnerable package is **minimatch**, not glob. Always override the **leaf package** that has the actual vulnerability.

**Never override a parent package to force a lower major version** — other packages in the project may depend on a newer major version, and a resolution/override forces ALL installations to the specified version. For example, overriding `glob` to `^8.1.0` will break `@expo/cli` which requires `glob@^13.0.0`, causing `expo prebuild` to fail with `files.map is not a function`.

Before adding a resolution/override (step 2), verify:
- You are targeting the **actually vulnerable package**, not a parent in the chain.
- The override version is **compatible with all dependents** (check with `bun why <package>` or `npm ls <package>`).
- The override does not **downgrade** a package across a major version boundary that other dependencies require.

Before adding a resolution/override (rung a), verify:
- You are targeting the **actually vulnerable package**, not a parent in the chain.
- The override version is **compatible with all dependents** (check with `bun why <package>` or `npm ls <package>`).
- The override does not **downgrade** a package across a major version boundary that other dependencies require.

If any of these checks fail, the override is "not possible" for the purposes of the ladder — go to rung b (evaluate reachability).

### Never

- Never add a blanket audit bypass or lower the configured audit level.
- Never patch, fork or vendor a library (rung e) before evaluating reachability (rung b), and never without a released human gate.
- Never accept the risk of an advisory that affects the project before genuinely attempting rungs a–c.
- Never add an exclusion without an impact evaluation recorded in its `reason`.

## Rails Projects (bundler-audit)

Same ladder, bundler mechanics:

1. Note the advisory ID, affected gem, and advisory URL from the error output.
2. Check whether a patched version of the gem exists.
3. **(a) `upgrade`:** If a patched version exists:
   - **Direct dependency** (in Gemfile): update its version constraint, run `bundle update <gem>`, commit, retry.
   - **Transitive dependency** (only in Gemfile.lock): run `bundle update <gem>` to pull the patched version without changing the Gemfile, commit the lockfile change, retry.
4. **(b) `exclude-unreachable` onward — no patch:** If no patched version exists, evaluate whether the advisory can affect the project. If it **cannot**, document the exception and retry. If it **does**, or you cannot show it does not, continue with (c) `replace-or-remove` and (d) `fix-upstream`. Pointing the Gemfile at a git fork or vendoring the gem is (e) `own-copy`: file the human gate first.
