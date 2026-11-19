# Security Audit Handling

The procedure for a push or CI run blocked by the dependency security audit lives in the `lisa-security-audit-handling` skill. Its steps run in this order:

1. Refresh the lockfile within the current range.
2. Upgrade the direct dependency that pulls the vulnerable copy.
3. Add a targeted override to the fixed version.
4. Evaluate reachability before any code change. An advisory that cannot affect the project gets a scoped exclusion with a concrete reason in the project's own `audit.ignore.local.json`, with no human needed; Lisa's template cannot vouch for a host's reachability. If reachability cannot be proven, the advisory affects the project.
5. Replace or remove the dependency.
6. Contribute the fix upstream, in parallel if useful.
7. Last: fork, patch or vendor the library, only through a declared human gate (`own-dependency-copy` in `ready-role-filing`), with no code before a person releases it. It is a gate, not a decision, because our own copy is maintenance we take on indefinitely, and copy-overwrite ships it to every host.

When steps 1–6 do not resolve it, file a build-ready ticket with the evidence (advisory, dependency path, what each step tried) so the factory carries the replacement or removal; stop only when the next act needs access you lack, and say exactly what is missing. The audit's failure message prints the same order and names the skill, so it loads when it is needed instead of in every session. Never bypass the hook.
