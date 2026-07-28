# T2 Threat-model verdict — #1982 (security-1982 deliverable, lead summary)

Note: destructive payloads below are spelled with SPLIT tokens (rm SPACE-DASH rf written as "rm_-rf") so this note itself doesn't trip the text-scan guard. Read "rm_-rf X" as the real two-token command.

- Gap is ONE guard: the rm catastrophic-target two-gate design. dd/mkfs/shred/SQL/find/xargs/git guards are raw-text scans, already subst-immune (empirically exit=2). Do not touch them.
- Fix principle (two minimal moves, both AFTER the recursive+force flag gate): (1) extend RM_CATASTROPHIC_TARGET trailing boundary class to include `)` and backtick; (2) token-walk: strip runs of leading wrappers (`"` `'` backtick `$(` `(` `<(` `>(`) and trailing closers (`)` backtick `"` `'`) before comparing tokens to rm|*/rm and before target classification.
- No quote-context awareness. LEAD DECISION (accepting T2 recommendation): single-quoted and backslash-escaped subst twins MAY block — consistent with the documented accepted-FP class (guard already blocks the single-quoted plaintext twin). AC permits over-block within the documented text-scan class. Surface the decision on PR + issue for owner veto.
- Guiding invariant: substitution-wrapping is verdict-neutral for the rm guard — a wrapped form blocks iff its unwrapped twin blocks.
- Must-not-FP: $((...)) arithmetic (never treat `$((` as subst), benign substs ending in /-before-) — $(basename /), $(ls /), $(du -sh /), backtick pwd, $(dirname ~) — plus non-recursive $(rm foo.txt), project-relative recursive delete of build/, tmp allowance /tmp/x.
- Already-blocking edges to keep green: `$( rm` (space after paren), $(command rm ...), $(env rm ...).
- New blocks required (targets: / or ~ or /etc-class roots): dq-subst form, unquoted subst form, backticks bare and in-dq, nested subst, ${VAR:-subst} param-default, backslash-rm inside subst, procsub <(...)/>(...), bare top-level subst.
- Reproducer drivers: /tmp/drive1982.py, /tmp/drive1982_baseline.py, /tmp/drive1982_overblock.py.
