# T1 Research — #1982 (explorer-1982 deliverable, persisted by lead)

Root causes CONFIRMED on current main (unshifted by PR #1994):
- RM_CATASTROPHIC_TARGET (L208-209) trailing boundary class lacks `)` — `-rf /)` fails to match.
- Token-walk guard 1b (L244-255) strips only one leading quote — `"$(rm` -> `$(rm` != rm, seen_rm never trips.
- Statement splitter (L291) + RM_CMD (L187) DO deliver the statement to the guards; flag gate matches.
- Weaknesses UNIQUE to rm two-gate design. SQL (L467-469), dd/mkfs/shred (L455-463), custom rules (L472-482) already block subst-wrapped forms (verified empirically exit=2).
- BONUS gap: bare command-proper `$(rm -rf /)` at top level also exit=0 (same token-walk cause).
- Signaling: pure exit code — block()=stderr+exit 2, allow=exit 0; harness asserts status only.
- Tests: fixtures tests/helpers/safety-net-guard-fixtures.ts (fx(id,command,expected,guard); guard consts L27-47; STATELESS_FIXTURES L80-314; QUOTE_BOUNDARY template QB-B1..B6 L164-179, QB-A1..A3 L180-182). Harness runs FANNED copy plugins/lisa/hooks/parity-safety-net.sh — must build:plugins after src edit. New family in STATELESS_FIXTURES is auto-consumed by it.each in parity-safety-net-guards.test.ts (no test-file change needed).
- Env in harness: GIT_* stripped, CLAUDE_PROJECT_DIR=cwd, SAFETY_NET_RULES_FILE=nonexistent.
- Documented text-scan class: in-file header L48-52 + plugins/src/base/skills/lisa-parity-safety-net-rules/SKILL.md L98-101 (update both if class widens; fanned x4 + .codex-plugin).
- Empirical baseline: exit=0 for `echo "$(rm -rf /)"` (BUG), `echo '$(rm -rf /)'` (correct allow), bare `$(rm -rf /)` (bonus gap); exit=2 for subst-wrapped SQL/dd/shred and QB-B1 baseline.
- Fixer seams: (a) add `)` to trailing boundary class L209; (b) normalize `$(`/`"$(` prefix in token-walk so `"$(rm` -> rm. Preserve single-quote-inert ALLOW.
