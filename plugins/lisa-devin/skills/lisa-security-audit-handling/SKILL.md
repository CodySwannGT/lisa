---
name: lisa-security-audit-handling
description: "What to do when a push or CI is blocked by the dependency security audit: upgrade, override the vulnerable package, assess real impact, then record a scoped exclusion or accept the risk with a reason and expiry. Never bypasses the hook."
---

# Security Audit Handling

Use this when `git push` (or a CI audit gate) fails because the dependency audit reports high or critical advisories. Work the decision ladder below **autonomously**. No rung stops for a human unless the project sets `humanGate.mode: "strict"`. Never use `--no-verify`, `HUSKY=0`, `core.hooksPath`, or any other hook bypass to skip the security audit.

## The decision ladder

The remediation for any high/critical advisory is a simple, ordered decision — not a question to forward to the user. For each advisory, take the **first** action that is possible:

1. **Update the offending package** to a patched version.
2. **If that's not possible**, force a resolution/override on the vulnerable leaf package.
3. **If that's not possible**, evaluate whether the advisory actually affects the project.
4. **If it affects the project** (and 1 and 2 weren't possible), decide yourself: mitigate it, or accept the risk with your reasoning and an expiry recorded. Under `humanGate.mode: "strict"`, stop for a human instead: post on the work item which advisory affects the project, how it is reached, and why no fix exists, and mark the item needs-human (in an interactive session, ask the operator).
5. **If it doesn't affect the project**, add it to the ignore list yourself.

Every step is autonomous by default. Take step 4 only after you have genuinely attempted steps 1 and 2 and performed the step-3 evaluation; under `strict`, it is the one step that stops for a human.

## Node.js Projects (GHSA advisories)

1. Note the GHSA ID(s), affected package(s), and advisory URL from the error output.
2. Check the advisory URL to determine whether a patched version of the vulnerable package exists.
3. **Step 1 — update:** If a patched version exists and is compatible, add a resolution/override in `package.json` to force the patched version (add to **both** `resolutions` and `overrides`), run the package manager install to regenerate the lockfile, commit, and retry the push.
4. **Step 2 — force override:** If no straight upgrade lands the patched version but a compatible patched version exists somewhere on the graph, pin it via `resolutions` + `overrides` on the **leaf** package (see "Override the vulnerable package, not its parent" below), regenerate the lockfile, commit, and retry.
5. **Step 3 — evaluate impact:** If neither an upgrade nor an override is possible (no fixed version exists, or every compatible pin breaks a dependent), determine whether the vulnerability actually affects this project. Consider: is the vulnerable code path reachable from this project's usage? Does it process untrusted input? Is the dependency runtime, or dev/build-only? Record the conclusion.
6. **Step 4 — decide:** If the evaluation shows the vulnerability **does** affect the project and neither step 1 nor step 2 was possible, make the call yourself and record it on the work item so a person can reverse it:
   - **Mitigate** if you can: replace or remove the vulnerable package, or guard the reachable code path so untrusted input cannot reach it, then retry.
   - **Otherwise accept the risk**: add an exclusion entry (as in step 5) whose `reason` records the impact, why no fix or mitigation is possible now, and an expiry date, and file a build-ready follow-up work item to remove the exclusion when a fix ships.
   - Under `humanGate.mode: "strict"`, stop for a human as described in rung 4 instead. That is the only step that pauses for a human in strict mode.
7. **Step 5 — ignore:** If the evaluation shows the vulnerability **does not** affect the project, add an exclusion entry to `audit.ignore.local.json` yourself, in the format `{"id": "GHSA-xxx", "package": "pkg-name", "reason": "<impact evaluation: why this advisory does not affect this project>"}`, then commit and retry the push. No human approval is required for this step — the `reason` field is the record of your evaluation.
   - **Scope the exclusion to the copy you evaluated.** An entry with only `id` (and `package`) hides the advisory for every copy of the package, including one a production dependency pulls in later. Two optional fields narrow it, and every field present must hold together:
     - `versions` — a semver range the excused installed copies must fall inside, such as `">=3.0.0 <4.0.0"`.
     - `paths` — a non-empty array of exact lockfile key paths for the excused copies: a `bun.lock` `packages` key such as `"lint-plugin/pkg"`, a `package-lock.json` `packages` key such as `"node_modules/lint-plugin/node_modules/pkg"`, or a `yarn.lock` selector key. No globs. Bun keys and nested npm keys isolate one parent. A `yarn.lock` selector names a requested range, not a parent, and a hoisted npm key (`"node_modules/pkg"`) names an install location; any later dependent that asks for that range or resolves to that hoisted copy is covered too, so pair those keys with a tight `versions` range.
     - `package` is the lowercase npm name the audit reports (`tar`, not `node-tar`). A misspelled scope field (`path`, `version`, `Paths`) fails the audit instead of silently excusing every copy; other extra keys are ignored.
   - **Whenever the vulnerable copy is dev-only** (reached only through a devDependency, such as a lint plugin pinned to an old major), add `versions` and `paths` rather than an ID-wide entry:
     ```json
     {"id": "GHSA-xxx", "package": "pkg", "versions": ">=3.0.0 <4.0.0", "paths": ["lint-plugin/pkg"], "reason": "<impact evaluation>"}
     ```
     Then any other vulnerable copy — on an unlisted path or through an npm alias — still fails the audit and is named by its lockfile path. An empty `paths` array, an invalid range, or an unreadable lockfile fails the audit with a diagnostic; it never widens into an ID-wide exclusion. The pre-push hook, the gate registry, and CI use the same matcher. `lisa doctor` checks the scope fields and that the lockfile is readable, and reports any remaining exclusion without `versions` or `paths`, but it does not match advisories against lockfile copies — a valid-looking path that names the wrong copy can pass doctor and still be rejected by the audit. Doctor also does not reject an entry with no `id` or an exclusion file that does not parse; the audit does. Only the audit proves the exclusion files are accepted. In CI, the reusable workflow audits the manager its `package_manager` input names (default `npm`), so set that input to the project's manager. A scoped entry always wins over a wider entry for the same advisory and package. Full contract: https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md

### Critical: Override the vulnerable package, not its parent

When the audit output shows a dependency chain like `@expo/cli › glob › minimatch`, the vulnerable package is **minimatch**, not glob. Always override the **leaf package** that has the actual vulnerability.

**Never override a parent package to force a lower major version** — other packages in the project may depend on a newer major version, and a resolution/override forces ALL installations to the specified version. For example, overriding `glob` to `^8.1.0` will break `@expo/cli` which requires `glob@^13.0.0`, causing `expo prebuild` to fail with `files.map is not a function`.

Before adding a resolution/override (step 2), verify:
- You are targeting the **actually vulnerable package**, not a parent in the chain.
- The override version is **compatible with all dependents** (check with `bun why <package>` or `npm ls <package>`).
- The override does not **downgrade** a package across a major version boundary that other dependencies require.

If any of these checks fail, the override is "not possible" for the purposes of the ladder — drop to step 3 (evaluate impact).

### Never

- Never add a blanket audit bypass or lower the configured audit level.
- Never jump to step 4 (decide or, under `strict`, stop for a human) before genuinely attempting steps 1–3.
- Never add a step-5 ignore entry without an impact evaluation recorded in its `reason`.

## Rails Projects (bundler-audit)

Same ladder, bundler mechanics:

1. Note the advisory ID, affected gem, and advisory URL from the error output.
2. Check whether a patched version of the gem exists.
3. **Step 1 — update:** If a patched version exists:
   - **Direct dependency** (in Gemfile): update its version constraint, run `bundle update <gem>`, commit, retry.
   - **Transitive dependency** (only in Gemfile.lock): run `bundle update <gem>` to pull the patched version without changing the Gemfile, commit the lockfile change, retry.
4. **Steps 3–5 — no patch:** If no patched version exists, evaluate whether the advisory affects the project. If it **does** and no fix is possible, decide it yourself (step 4; stop for a human under `strict`). If it **does not**, document the exception and retry (step 5).
