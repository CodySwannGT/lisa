# Intent Routing (load-bearing)

**On the first user message of a session**, before responding to the substance of the request, before running any tool, before asking any clarifying question:

1. **Classify the flow.** One of: Research, Plan, Implement (Build/Fix/Improve/Investigate-Only), Verify, Monitor, Intake, Debrief, or No flow. If a slash command was invoked, the flow is already determined.
2. **Echo the chosen flow** with a one-sentence justification. Example:
   > **Flow: Implement/Fix** — bug report with reproduction steps.
3. **Echo orchestration mode in the same message.** One of:
   > **Orchestration: agent team** — Research, Plan, Implement, Intake, Debrief, and any flow that invokes Review.
   > **Orchestration: single agent** — Verify (standalone), Monitor (standalone), product-walkthrough standalone, debrief-apply, one-off diagnostic sessions.
4. **Check the readiness gate.** If gate fails interactively, ask for what's missing with recommended answers; do not start work. Headless/`-p` sessions infer from available context instead of blocking.
5. **Cascade rule.** If you are already inside an agent team (a TeamCreate succeeded earlier this session, or you were spawned into a team context), do **not** create a second team. Add specialists through the existing lead. On Claude, teams are flat — message the lead with teammate + assignment. On Codex, use `multi_agent_v1.spawn_agent`.

Once a flow is established, **do not re-classify** on later messages, even if a follow-up looks vague ("now run the tests", "thanks"). Subsequent messages inherit the established flow unless the user explicitly changes scope.

Skipping classification or orchestration echo leads to unstructured responses that bypass readiness gates.

Full reference (flow definitions, readiness gates, orchestration matrix, sub-flows): [reference/intent-routing.md](../reference/intent-routing.md).
