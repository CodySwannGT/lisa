# Security Audit Handling

The procedure for a push or CI run blocked by the dependency security audit lives in the `lisa-security-audit-handling` skill: upgrade the package, override the vulnerable leaf, evaluate real impact, then either record a scoped exclusion, or mitigate or accept the risk yourself with the reasoning and an expiry recorded (under `humanGate.mode: "strict"`, stop for a human instead). The audit's failure message names that skill, so it loads when it is needed instead of in every session. Never bypass the hook.
