/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Refuses a direct tracker-creation command that declares no readiness. The
 * `ready-role-filing` rule says every filing carries either `build_ready: true`
 * or an explicit `human_gate:` reason and goes through `lisa-track` /
 * `lisa-tracker-write`. An audit of one working session found 13 of 13 issues
 * filed in violation of it, several by the agent that wrote the rule — while
 * the one obligation backed by a git hook was honored 50 out of 50 times. This
 * is that rule promoted from prose to an executable control.
 *
 * Port of Lisa's canonical hook `block-direct-issue-create.sh`. OpenCode
 * exposes the shell as the `bash` tool, so the command arrives on
 * `output.args.command`. Throwing in `tool.execute.before` cancels the tool
 * call and surfaces the message to the agent.
 *
 * Two deliberate simplifications against the shell original, both in the
 * permissive direction so this port can never refuse something the canonical
 * guard would allow:
 *   - the build-ready role is read from `.lisa.config.json` when present and
 *     falls back to `status:ready`, matching the shell guard's resolution;
 *   - `--body-file` contents are not read, so an OpenCode caller declaring a
 *     human gate puts the `[lisa-human-gate]` marker on the command line.
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export /**
 *
 */
const LisaBlockDirectIssueCreate = async () => {
  const HUMAN_GATE_MARKER = "[lisa-human-gate]";
  /**
   * A label / workflow-state assignment and its value.
   *
   * Long forms only, deliberately: short flags are per-CLI (`-s` is `--state`
   * on one and `--summary` on another), so accepting them would re-open the
   * free-text hole one letter smaller. Every Lisa writer emits the long form.
   */
  const LABEL_FLAG =
    /--(?:label|labels|add-label|status|state)(?:=|\s+)(['"]?)([^'"\s]+)\1/g;
  const CREATION_SIGNATURES: readonly {
    readonly re: RegExp;
    readonly name: string;
  }[] = [
    {
      re: /(^|[;&|(\s])gh\s+issue\s+(?:--?\S+(?:[= ]\S+)?\s+)*create(\s|$)/,
      name: "gh issue create",
    },
    {
      re: /(^|[;&|(\s])linear\s+issue\s+(?:--?\S+(?:[= ]\S+)?\s+)*create(\s|$)/,
      name: "linear issue create",
    },
    {
      re: /(^|[;&|(\s])jira\s+issue\s+(?:--?\S+(?:[= ]\S+)?\s+)*create(\s|$)/,
      name: "jira issue create",
    },
    {
      re: /(^|[;&|(\s])acli\s+[^;&|]*\b(workitem|issue)s?\s+create\b/,
      name: "acli … create",
    },
    {
      re: /\b(createIssue|issueCreate)\b/,
      name: "a GraphQL issue-creation mutation",
    },
    {
      re: /repos\/[^/\s]+\/[^/\s]+\/issues\b[^;&|]*(-X\s*POST|--method\s+POST|\s-[fF]\s|--input\b|--data\b)/,
      name: "a POST to the issues endpoint",
    },
    {
      re: /atlassian\.net\/rest\/api\/[^/\s]+\/issue\b[^;&|]*(-X\s*POST|--request\s+POST|--data\b)/,
      name: "a POST to the JIRA issue endpoint",
    },
  ];

  const readyRole = await (async () => {
    try {
      const raw = await Bun.file(".lisa.config.json").text();
      const config = JSON.parse(raw) as {
        tracker?: string;
        github?: { labels?: { build?: { ready?: string } } };
        jira?: { workflow?: { ready?: string } };
        linear?: { workflow?: { ready?: string } };
      };
      // No configured tracker means no `lisa-tracker-write` to route through —
      // the bootstrapping case, detected rather than asserted.
      if (!config.tracker) return undefined;
      return (
        config.github?.labels?.build?.ready ??
        config.jira?.workflow?.ready ??
        config.linear?.workflow?.ready ??
        "status:ready"
      );
    } catch {
      return undefined;
    }
  })();

  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args?: { command?: string } }
    ) => {
      if (input.tool !== "bash") return;
      if (readyRole === undefined) return;
      const command = String(output.args?.command ?? "");
      if (!command) return;
      if (/--help\b|\s-h(\s|$)/.test(command)) return;
      // The override is honored only from the ambient environment. An inline
      // assignment is the agent granting itself the exemption, so it
      // disqualifies the override rather than supplying it.
      const inlineOverride = /LISA_ALLOW_DIRECT_ISSUE_CREATE=/.test(command);
      if (process.env["LISA_ALLOW_DIRECT_ISSUE_CREATE"] && !inlineOverride)
        return;
      const signature = CREATION_SIGNATURES.find(entry =>
        entry.re.test(command)
      );
      if (!signature) return;
      // The build-ready role counts ONLY as the value of a label / state flag.
      // A free-text scan of the command let a bug report's own title declare
      // readiness — `gh issue create --title "status:ready is broken"` — which
      // is the same position-blind matching that turned #2469's hardening
      // allowlist into a bypass. The human-gate marker is matched anywhere by
      // contrast, because it is a marker with no other meaning.
      const declaresRole = [...command.matchAll(LABEL_FLAG)].some(match =>
        (match[2] ?? "")
          .split(",")
          .map(part => part.trim())
          .includes(readyRole)
      );
      if (declaresRole || command.includes(HUMAN_GATE_MARKER)) return;
      throw new Error(
        [
          `block-direct-issue-create: refusing ${signature.name} — this filing declares no readiness.`,
          "",
          "WHY: a work item filed without the build-ready role is an incomplete",
          "handoff. Build-intake scans the ready lane and nothing else, so nothing",
          "will ever pick it up: the write succeeds and the work still dies.",
          "",
          "FILE IT THE SANCTIONED WAY — one of these two, always explicit:",
          "",
          '1. Complete enough to build? Run /lisa:track "<what needs building>",',
          "   which resolves or creates exactly one live leaf through",
          "   lisa-tracker-write with build_ready: true, validates it before the",
          "   write, and claims it.",
          "2. A human product call is pending? Route the same way but pass",
          '   human_gate: "<why a human must judge this first>", which stamps',
          `   ${HUMAN_GATE_MARKER} on the item so the hold is auditable.`,
          "",
          "Filed, not ready, and no human_gate is the incomplete-handoff case. See",
          "the ready-role-filing rule for the full contract.",
          "",
          "If you must run the CLI directly, the command has to carry one of the",
          `two declarations itself: the configured build-ready role "${readyRole}",`,
          `or a ${HUMAN_GATE_MARKER} marker in the body it submits.`,
          "",
          "OPERATOR ESCAPE: a human can export LISA_ALLOW_DIRECT_ISSUE_CREATE=1 in",
          "the environment before starting the session. Setting it inline on this",
          "command is deliberately refused.",
        ].join("\n")
      );
    },
  };
};
