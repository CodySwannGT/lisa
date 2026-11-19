---
name: lisa-security-audit-handling
description: "When the dependency security audit blocks a push or CI, in order: refresh, upgrade, override, exclude an unreachable advisory with a reason, replace or remove, fix upstream, and only last, behind a human gate, fork, patch or vendor the library. Never bypasses the hook."
---

# Security Audit Handling

Use this when `git push` (or a CI audit gate) fails because the dependency audit reports high or critical advisories. Work the ladder below **autonomously**. Never use `--no-verify`, `HUSKY=0`, `core.hooksPath`, or any other hook bypass to skip the security audit.

## The fix ladder

The remedy for a high/critical advisory is an ordered decision, not a question to forward to the user. For each advisory, work the steps **in this order** and stop at the first one that resolves it. The audit's failure message prints the same order.

1. **Refresh the lockfile within the current range.** Most transitive fixes are published inside the range the parent already accepts; a stale lockfile is the usual cause.
2. **Upgrade the direct dependency** that pulls the vulnerable copy to a release that depends on a patched one.
3. **Add a targeted override** that pins the vulnerable **leaf** package to the fixed version.
4. **Evaluate reachability, and exclude with a stated reason if unaffected** — before considering any code change. If the advisory cannot affect this project, add a scoped exclusion with a concrete reason to `audit.ignore.local.json`. No human is needed. Typical unreachable cases: the package is used only by dev or build tooling, or the vulnerable input is never untrusted (for example, globs or patterns written in the repository itself). The evaluation is this project's own: Lisa's template exclusions cannot vouch for a host's reachability, so a host the audit flags records its own entry in `audit.ignore.local.json`. **If reachability cannot be proven, treat the advisory as affecting the project** and continue at step 5.
5. **Replace or remove the dependency** when it affects the project and no fixed version exists: a maintained alternative, a newer major of the parent that no longer pulls the package, or dropping it.
6. **Contribute the fix upstream** — an issue or pull request on the library. This is fine to do in parallel with step 5.
7. **Fork, patch or vendor the library — last, and only through a human gate.** Our own copy of an open-source library (a fork, a patch through patch-package, Bun or pnpm `patchedDependencies` or `yarn patch`, a `patches/` directory, or a vendored copy) is reached only when steps 1–6 cannot resolve the advisory. File the work held through `lisa-track` with `human_gate: "approve maintaining our own copy of <pkg>"` (the `own-dependency-copy` act in `ready-role-filing`), and write none of that code until a person releases the gate.

**Why step 7 is a gate.** The no-assumed-human rule still holds: every other step is a decision you make and record yourself. A fork, patch or vendored copy is different. It is maintenance we take on indefinitely, and it travels with whatever the project distributes: in Lisa itself, copy-overwrite ships it to every host. So it is one of the explicitly declared human gates, not a decision.

If steps 1–6 do not resolve it in this change, **file a build-ready ticket** in the configured tracker (through `lisa-tracker-write` with `build_ready: true`) carrying the evidence: the advisory, the dependency path that reaches the vulnerable copy, and what was tried at each step and why it failed. The factory then carries the replacement or removal as work. Stop only when the next act needs access you do not have, and then say exactly what is missing.

## Node.js Projects (GHSA advisories)

1. Note the GHSA ID(s), affected package(s), vulnerable lockfile path(s), and advisory URL from the error output.
2. Check the advisory for the patched version in each affected major (`gh api /advisories/<GHSA-id>`). Also check whether it was withdrawn.
3. **Step 1 — refresh:** if the patched version satisfies the range the parent declares, update the lockfile for that package (`bun update <pkg>`, `npm update <pkg>`, or `yarn upgrade <pkg>`), confirm with `bun why <pkg>` / `npm ls <pkg>` that every copy is patched, commit, and retry.
4. **Step 2 — upgrade:** otherwise upgrade the direct dependency whose chain pulls the copy to a release that accepts the patched version, regenerate the lockfile, run the project's tests, commit, and retry.
5. **Step 3 — override:** otherwise pin the **leaf** package in both `overrides` and `resolutions` in `package.json` (see below), regenerate the lockfile, run the tests, commit, and retry. In a Lisa host, if the fix should reach every project on the stack, propose it upstream in Lisa's `package.lisa.json`.
6. **Step 4 — evaluate reachability:** if no refresh, upgrade or override lands a patched copy (no fixed version exists, or every compatible pin breaks a dependent), decide whether the vulnerability can affect this project **before changing any code**. Consider: is the vulnerable code path reachable from this project's usage? Does it process untrusted input? Is the dependency runtime, or dev/build-only? If it cannot affect the project, add an exclusion entry to `audit.ignore.local.json` yourself, in the format `{"id": "GHSA-xxx", "package": "pkg-name", "reason": "<impact evaluation: why this advisory does not affect this project>"}`, then commit and retry the push. No human approval is required for this step — the `reason` field is the record of your evaluation. If you cannot show it is unreachable, it affects the project: go on to step 5.
   - **Scope the exclusion to the copy you evaluated.** An entry with only `id` (and `package`) hides the advisory for every copy of the package, including one a production dependency pulls in later. Two optional fields narrow it, and every field present must hold together:
     - `versions` — a semver range the excused installed copies must fall inside, such as `">=3.0.0 <4.0.0"`.
     - `paths` — a non-empty array of exact lockfile key paths for the excused copies: a `bun.lock` `packages` key such as `"lint-plugin/pkg"`, a `package-lock.json` `packages` key such as `"node_modules/lint-plugin/node_modules/pkg"`, or a `yarn.lock` selector key. No globs. Bun keys and nested npm keys isolate one parent. A `yarn.lock` selector names a requested range, not a parent, and a hoisted npm key (`"node_modules/pkg"`) names an install location; any later dependent that asks for that range or resolves to that hoisted copy is covered too, so pair those keys with a tight `versions` range.
     - `package` is the lowercase npm name the audit reports (`tar`, not `node-tar`). A misspelled scope field (`path`, `version`, `Paths`) fails the audit instead of silently excusing every copy; other extra keys are ignored.
   - **Whenever the vulnerable copy is dev-only** (reached only through a devDependency, such as a lint plugin pinned to an old major), add `versions` and `paths` rather than an ID-wide entry:
     ```json
     {"id": "GHSA-xxx", "package": "pkg", "versions": ">=3.0.0 <4.0.0", "paths": ["lint-plugin/pkg"], "reason": "<impact evaluation>"}
     ```
     Then any other vulnerable copy — on an unlisted path or through an npm alias — still fails the audit and is named by its lockfile path. An empty `paths` array, an invalid range, or an unreadable lockfile fails the audit with a diagnostic; it never widens into an ID-wide exclusion. The pre-push hook, the gate registry, and CI use the same matcher. `lisa doctor` checks the scope fields and that the lockfile is readable, and reports any remaining exclusion without `versions` or `paths`, but it does not match advisories against lockfile copies — a valid-looking path that names the wrong copy can pass doctor and still be rejected by the audit. Doctor also does not reject an entry with no `id` or an exclusion file that does not parse; the audit does. Only the audit proves the exclusion files are accepted. In CI, the reusable workflow audits the manager its `package_manager` input names (default `npm`), so set that input to the project's manager. A scoped entry always wins over a wider entry for the same advisory and package. Full contract: https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md
7. **Step 5 — replace or remove:** if the advisory affects the project, replace the dependency with a maintained alternative or remove it, prove behavior with the tests, commit, and retry.
8. **Step 6 — upstream:** open the upstream fix (an issue or pull request on the library), in parallel with step 5 if useful.
9. If steps 1–6 do not resolve it in this change, file the build-ready ticket described above.
10. **Step 7 — our own copy:** only when steps 1–6 cannot resolve it, file the held `human_gate` work item described above. Do not add `patchedDependencies`, patch-package, `yarn patch`, a `patches/` directory, a git fork in `package.json`, or a vendored copy before a person releases that gate. A fork or vendored copy also inherits the `dependency-internalization-kit` rule's evidence bar once the gate is released.


### Critical: Override the vulnerable package, not its parent

When the audit output shows a dependency chain like `@expo/cli › glob › minimatch`, the vulnerable package is **minimatch**, not glob. Always override the **leaf package** that has the actual vulnerability.

**Never override a parent package to force a lower major version** — other packages in the project may depend on a newer major version, and a resolution/override forces ALL installations to the specified version. For example, overriding `glob` to `^8.1.0` will break `@expo/cli` which requires `glob@^13.0.0`, causing `expo prebuild` to fail with `files.map is not a function`.

Before adding a resolution/override (step 3), verify:
- You are targeting the **actually vulnerable package**, not a parent in the chain.
- The override version is **compatible with all dependents** (check with `bun why <package>` or `npm ls <package>`).
- The override does not **downgrade** a package across a major version boundary that other dependencies require.

If any of these checks fail, the override is "not possible" for the purposes of the ladder — go to step 4 (evaluate reachability).

### Never

- Never add a blanket audit bypass or lower the configured audit level.
- Never add an exclusion without an impact evaluation recorded in its `reason`, and never for an advisory you cannot show is unreachable.
- Never file the ticket before genuinely attempting steps 1–6.
- Never patch, fork or vendor a library (step 7) before evaluating reachability (step 4), and never without a released human gate.
- Never wait on a human the work does not need; stop only for missing access, and name it.

## Rails Projects (bundler-audit)

Same ladder, bundler mechanics:

1. Note the advisory ID, affected gem, and advisory URL from the error output.
2. Check whether a patched version of the gem exists.
3. **Step 1 — update:** If a patched version exists:
   - **Direct dependency** (in Gemfile): update its version constraint, run `bundle update <gem>`, commit, retry.
   - **Transitive dependency** (only in Gemfile.lock): run `bundle update <gem>` to pull the patched version without changing the Gemfile, commit the lockfile change, retry.
4. **No patch:** If no patched version exists, evaluate whether the advisory can affect the project. If it **cannot**, document the exception with the reason and retry. If it **does**, or you cannot show it does not, upgrade or replace the gem that pulls it, or remove it, and contribute the fix upstream. If none of that works, file a build-ready ticket with the evidence, as above. Pointing the Gemfile at a git fork or vendoring the gem is step 7: file the human gate first.
