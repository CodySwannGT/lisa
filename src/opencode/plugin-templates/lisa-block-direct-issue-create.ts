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
 * The port matches on the raw command text rather than tokenising it, which
 * makes it naturally immune to the prefix and tokenisation bypass classes the
 * shell guard had to be restructured to close — an unrecognised wrapper is just
 * more text before the CLI name. Two deliberate differences remain, both in the
 * permissive direction so this port can never refuse something the canonical
 * guard would allow:
 *   - `--body-file` contents are not read, so an OpenCode caller declaring a
 *     human gate puts the `[lisa-human-gate]` marker on the command line;
 *   - remote execution (`ssh host '…'`) is not intercepted, matching the shell
 *     guard's documented limit.
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
      re: /(^|[;&|("'\s])gh\s+issue\s+(?:--?\S+(?:[= ]\S+)?\s+)*create(\s|$)/,
      name: "gh issue create",
    },
    {
      re: /(^|[;&|("'\s])linear\s+issue\s+(?:--?\S+(?:[= ]\S+)?\s+)*create(\s|$)/,
      name: "linear issue create",
    },
    {
      re: /(^|[;&|("'\s])jira\s+issue\s+(?:--?\S+(?:[= ]\S+)?\s+)*create(\s|$)/,
      name: "jira issue create",
    },
    {
      re: /(^|[;&|("'\s])acli\s+[^;&|]*\b(workitem|issue)s?\s+create\b/,
      name: "acli … create",
    },
    {
      // Scoped to a tracker API call on purpose. A bare mutation NAME is just a
      // word: `git commit -m "fix issueCreate typo"` and `rg issueCreate` are
      // ordinary commands, and matching them made the guard refuse work it has
      // no business refusing. The mutation only means a creation when it is
      // being SENT, so `gh api` or an HTTP write to Linear's endpoint must
      // appear on the same command.
      re: /(?:(^|[;&|("'\s])gh\s+[^;&|]*\bapi\b|api\.linear\.app\/graphql)[^;&|]*\b(createIssue|issueCreate)\b/,
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

  interface LisaConfig {
    tracker?: string;
    github?: { labels?: { build?: { ready?: string } } };
    jira?: { workflow?: { ready?: string } };
    linear?: { workflow?: { ready?: string } };
  }

  /**
   * Read one config file, tolerating absence.
   * @param file Path relative to the project root.
   * @returns The parsed config, or an empty object.
   */
  const readConfig = async (file: string): Promise<LisaConfig> => {
    try {
      return JSON.parse(await Bun.file(file).text()) as LisaConfig;
    } catch {
      return {};
    }
  };

  /**
   * The configured build-ready role, or undefined when no tracker is set.
   *
   * Keyed off the resolved `tracker` rather than provider precedence: reading
   * whichever provider block happened to appear first could hand a GitHub label
   * to a Linear project, so the guard and the writer would disagree about what
   * a declaration even looks like. The local overlay is layered over the base
   * with field-level precedence, matching how `lisa-tracker-read` and
   * `lisa-tracker-write` resolve it — a project that overrides its tracker only
   * in `.lisa.config.local.json` was previously invisible here.
   *
   * Resolved once per session at plugin init. That is a deliberate snapshot: a
   * config edit mid-session needs a session restart to take effect, which is
   * the same lifetime as the rest of this plugin's state.
   * @returns The role token, or undefined.
   */
  const resolveReadyRole = async (): Promise<string | undefined> => {
    const base = await readConfig(".lisa.config.json");
    const local = await readConfig(".lisa.config.local.json");
    const tracker = local.tracker ?? base.tracker;
    // No configured tracker means no `lisa-tracker-write` to route through —
    // the bootstrapping case, detected rather than asserted.
    if (!tracker) return undefined;
    const pick = (config: LisaConfig): string | undefined => {
      if (tracker === "github") return config.github?.labels?.build?.ready;
      if (tracker === "jira") return config.jira?.workflow?.ready;
      if (tracker === "linear") return config.linear?.workflow?.ready;
      return undefined;
    };
    return pick(local) ?? pick(base) ?? "status:ready";
  };

  const readyRole = await resolveReadyRole();

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
      // Everything after a bare `--` is an operand and cannot reach the
      // created item, so no declaration may be read from there. gh rejects
      // post-`--` flags outright; acli parses straight past them and creates
      // the item with the flag silently unapplied (verified). Fails closed.
      const declarable = command.split(/(?:^|\s)--(?:\s|$)/)[0] ?? command;
      const declaresRole = [...declarable.matchAll(LABEL_FLAG)].some(match =>
        (match[2] ?? "")
          .split(",")
          .map(part => part.trim())
          .includes(readyRole)
      );
      if (declaresRole || declarable.includes(HUMAN_GATE_MARKER)) return;
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
