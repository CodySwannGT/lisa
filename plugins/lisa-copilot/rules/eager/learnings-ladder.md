# Learnings Ladder — Where Does This Go? (load-bearing)

When you learn something durable, route it by **what it costs to carry**, not by whichever file you happen to have open. Six rungs, strongest enforcement first:

| Rung | Destination | Enters context |
| --- | --- | --- |
| EXECUTABLE-CONTROL | Lint / ast-grep / type / test / hook / `package.lisa.json` force | Never — the diagnostic fires on violation |
| EAGER-RULE | The host rules directory `.agents/rules/` (Lisa's own shipped rules live in the plugin rules tree) | Unconditionally, every session |
| SKILL | A `SKILL.md` procedure | Description only; body on invoke |
| WIKI | Wiki page plus an index entry | Only when queried |
| KEEP-IN-LEDGER | The learnings ledger (`.lisa/PROJECT_LEARNINGS.md`) | Bounded projection only |
| RETIRE | Nowhere — delete the prose | Never |

**Take the cheapest rung that actually works.** Anything a machine can decide is EXECUTABLE-CONTROL. KEEP-IN-LEDGER is the default landing zone. EAGER-RULE is earned only by evidence of repeated misses despite the knowledge already being reachable, and the tier is demotion-biased — every session pays for it.

**You capture; you do not promote.** Record the learning through `lisa-persist-learning`. The gardener (`/lisa:learnings:audit`, an opt-in weekly automation) routes candidates through the `skill-evaluator` and files human-gated promotion tickets. Never hand-append a learning to `AGENTS.md` or a host rules file.

Full prose: [reference/learnings-ladder.md](../reference/learnings-ladder.md).
