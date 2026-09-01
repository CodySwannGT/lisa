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
 * more text before the CLI name.
 *
 * It reaches past the command text in the two places the canonical guard does:
 * into the contents of any file the command names — which is what closes
 * `bash create.sh`, `node wrapper.mjs` and `curl --data-binary @payload.json`
 * — and into the lifecycle-role declaration a state-based tracker has to use
 * because no flag on `curl` can carry a workflow state.
 *
 * One deliberate difference remains, in the permissive direction so this port
 * can never refuse something the canonical guard would allow: remote execution
 * (`ssh host '…'`) is not intercepted, matching the shell guard's documented
 * limit.
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
  /**
   * The repository a creation is ADDRESSED at, which decides whose ready role
   * answers for it. `-R` is honored here even though short flags are refused
   * for labels above: `--repo`/`-R` is one flag on one CLI with one meaning,
   * where the label short forms collide across trackers.
   */
  const REPO_FLAG = /(?:^|\s)(?:--repo|-R)(?:=|\s+)(['"]?)([^'"\s]+)\1/;
  const ISSUES_ENDPOINT = /repos\/([^/\s]+)\/([^/\s]+)\/issues\b/;
  const DEFAULT_READY_ROLE = "status:ready";
  const DEFAULT_UPSTREAM_REPO = "CodySwannGT/lisa";
  /**
   * The build-ready declaration for a tracker whose ready role is a workflow
   * STATE rather than a label.
   *
   * GitHub's role is a label and labels are argv-native, so `--label` has
   * always been writable there. JIRA's and Linear's are states living in the
   * request payload, and the mandated client is `curl`, which has no flag that
   * carries one — so the only declaration those trackers could satisfy was
   * `[lisa-human-gate]`, a false statement about a build-ready item. A guard
   * that leaves an honest operator no compliant command and one dishonest one
   * fails in the harmful direction.
   *
   * The role is what the access layer already consumes: it refuses a
   * caller-supplied state id, takes `lifecycle_role`, resolves it against the
   * tracker's own catalog and fails closed. So the token decides the lane
   * rather than decorating the command.
   */
  const LIFECYCLE_ROLE_READY =
    /(?:^|[^\w.-])(?:lifecycle_role|LIFECYCLE_ROLE)\s*[:=]\s*["']?ready\b|(?:^|[^\w.-])--role[=\s]+["']?ready\b/;
  /** A creation verb, and a tracker endpoint to send it to. */
  const GRAPHQL_CREATE = /createIssue|issueCreate/;
  const TRACKER_ENDPOINT =
    /api\.linear\.app\/graphql|api\.github\.com|atlassian\.net\/rest\/api|repos\/[^/\s?#'"]+\/[^/\s?#'"]+\/issues/i;
  /** Bounds on reading files a command names, so a hook stays a hook. */
  const MAX_FILE_BYTES = 262_144;
  const MAX_FILES = 8;
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
    github?: {
      org?: string;
      repo?: string;
      labels?: { build?: { ready?: string } };
    };
    jira?: { workflow?: { ready?: string } };
    linear?: { workflow?: { ready?: string } };
    hardening?: { upstreamRepo?: string; upstreamReadyRole?: string };
  }

  /** Everything the guard needs to decide whose ready role answers. */
  interface FilingPolicy {
    /** The calling project's own build-ready role. */
    readonly readyRole: string;
    /** The calling project's own repository, when it declares one. */
    readonly ownRepo: string | undefined;
    /** The repository upstream defects are filed at. */
    readonly upstreamRepo: string;
    /** The ready role that repository runs its build queue off. */
    readonly upstreamReadyRole: string;
    /** Whether the caller's ready role is a GitHub label at all. */
    readonly callerIsGithub: boolean;
    /** Whether the caller's ready role is a workflow state, not a label. */
    readonly stateRoleTracker: boolean;
  }

  /** Which roles satisfy a filing, and the target a refusal should name. */
  interface Verdict {
    readonly roles: readonly string[];
    /** Set only when the filing is provably addressed at another repository. */
    readonly named: string | undefined;
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
   * The filing policy, or undefined when no tracker is set.
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
   * @returns The filing policy, or undefined.
   */
  const resolvePolicy = async (): Promise<FilingPolicy | undefined> => {
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
    const org = local.github?.org ?? base.github?.org;
    const name = local.github?.repo ?? base.github?.repo;
    const hardening = { ...base.hardening, ...local.hardening };
    return {
      readyRole: pick(local) ?? pick(base) ?? DEFAULT_READY_ROLE,
      ownRepo: org && name ? `${org}/${name}`.toLowerCase() : undefined,
      upstreamRepo: (
        hardening.upstreamRepo ?? DEFAULT_UPSTREAM_REPO
      ).toLowerCase(),
      upstreamReadyRole: hardening.upstreamReadyRole ?? DEFAULT_READY_ROLE,
      callerIsGithub: tracker === "github",
      stateRoleTracker: tracker === "jira" || tracker === "linear",
    };
  };

  const policy = await resolvePolicy();

  /**
   * The readable files a command names, with their contents.
   *
   * The guard used to match the command text and nothing else, so a creation
   * one file away was invisible: `bash create.sh` is two words, and the
   * conjunction it looks for — an endpoint and a creation verb together — never
   * formed. Lisa's own guards push agents into exactly that shape, telling them
   * to write payloads to a file and execute the file, so complying with the
   * guidance produced the bypass.
   *
   * Which programs execute their operands is unbounded and every gap in such a
   * list fails open, so the question is inverted the same way the wrapper
   * question was: which tokens name a file? That is bounded by the command.
   * @param props Helper inputs.
   * @param props.text The command being inspected.
   * @returns Each named file's path and contents, bounded in count and size.
   */
  const namedFiles = async ({
    text,
  }: Readonly<{ text: string }>): Promise<
    readonly { readonly path: string; readonly text: string }[]
  > => {
    const found: { path: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const raw of text.split(/[\s'"]+/)) {
      if (found.length >= MAX_FILES) break;
      const token = raw.replace(/^@/, "");
      if (!token || token === "-" || seen.has(token)) continue;
      seen.add(token);
      try {
        const handle = Bun.file(token);
        // A file too large to inspect is skipped rather than half-read: a
        // truncated scan reports a confident allow about text it never saw.
        if (handle.size === 0 || handle.size > MAX_FILE_BYTES) continue;
        if (!(await handle.exists())) continue;
        found.push({ path: token, text: await handle.text() });
      } catch {
        continue;
      }
    }
    return found;
  };

  /**
   * A repository token reduced to a comparable `owner/name`.
   *
   * gh accepts `OWNER/REPO`, `HOST/OWNER/REPO`, and a full browser URL, and
   * GitHub is case-insensitive about both halves — so comparing raw tokens
   * would call one repository two different places depending on how it was
   * typed.
   * @param props Helper inputs.
   * @param props.value The raw token.
   * @returns The `owner/name` pair with the caller's casing preserved, or
   *   undefined when it names no repository. Callers fold case to compare.
   */
  const normaliseRepo = ({
    value,
  }: Readonly<{ value: string }>): string | undefined => {
    const text = value.replace(/\.git$/, "");
    const parts = text.split("/").filter(part => part && !part.endsWith(":"));
    if (parts.length < 2) return undefined;
    // Casing preserved; folded only where it is compared. The refusal names
    // this back to an operator, and echoing a lowercased slug at someone who
    // typed the canonical spelling reads as a different repository.
    return `${parts.at(-2)}/${parts.at(-1)}`;
  };

  /**
   * The repository this creation is addressed at, when it names one.
   * @param props Helper inputs.
   * @param props.declarable The command text up to a bare `--`.
   * @returns The original-casing `owner/name` when the command names a target
   *   repository, or undefined when it names no target repository.
   */
  const targetRepository = ({
    declarable,
  }: Readonly<{ declarable: string }>): string | undefined => {
    const flag = REPO_FLAG.exec(declarable);
    if (flag?.[2]) return normaliseRepo({ value: flag[2] });
    const endpoint = ISSUES_ENDPOINT.exec(declarable);
    if (endpoint)
      return normaliseRepo({ value: `${endpoint[1]}/${endpoint[2]}` });
    return undefined;
  };

  /**
   * Which ready-role tokens satisfy a creation addressed at `target`.
   *
   * A declaration is demanded either way; this decides only WHOSE vocabulary
   * it is written in. The last branch is the indeterminate case — a
   * GitHub-tracked project declaring no `github.org`/`github.repo` cannot be
   * compared against a target, so both roles are accepted rather than
   * inventing a refusal, and no cross-repo target is reported: the cross-repo
   * message would claim this project's role does not answer, which is false in
   * exactly that branch.
   * @param resolved The filing policy.
   * @param target The addressed repository, or undefined.
   * @returns The acceptable role tokens, and the target to name in a refusal.
   */
  const rolesFor = (
    resolved: FilingPolicy,
    target: string | undefined
  ): Verdict => {
    // GitHub is case-insensitive about owner and name, so the comparison folds
    // case while the reported string keeps the operator's own spelling.
    const folded = target?.toLowerCase();
    if (folded === undefined || folded === resolved.ownRepo)
      return { roles: [resolved.readyRole], named: undefined };
    const role =
      folded === resolved.upstreamRepo
        ? resolved.upstreamReadyRole
        : DEFAULT_READY_ROLE;
    if (resolved.ownRepo !== undefined || !resolved.callerIsGithub)
      return { roles: [role], named: target };
    return { roles: [resolved.readyRole, role], named: undefined };
  };

  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args?: { command?: string } }
    ) => {
      if (input.tool !== "bash") return;
      if (policy === undefined) return;
      const command = String(output.args?.command ?? "");
      if (!command) return;
      if (/--help\b|\s-h(\s|$)/.test(command)) return;
      // The override is honored only from the ambient environment. An inline
      // assignment is the agent granting itself the exemption, so it
      // disqualifies the override rather than supplying it.
      const inlineOverride = /LISA_ALLOW_DIRECT_ISSUE_CREATE=/.test(command);
      if (process.env["LISA_ALLOW_DIRECT_ISSUE_CREATE"] && !inlineOverride)
        return;
      const inline = CREATION_SIGNATURES.find(entry => entry.re.test(command));
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
      // WHICH repository's vocabulary answers is decided by where the create
      // is addressed, not by whose config file is nearest. A filing aimed at
      // another repository used to be judged against this project's role,
      // which that repository does not carry — and on a JIRA or Linear caller
      // the demanded token was a workflow STATE, so there was no satisfiable
      // answer at all. The property is unchanged: a declaration is still
      // required, wherever the item lands.
      const { roles, named } = rolesFor(
        policy,
        targetRepository({ declarable })
      );
      // The role escape is scoped: accepted only where no argv flag on the
      // mandated client can carry a state, and never on a GitHub target where
      // the label IS writable and a second weaker spelling would be a hole.
      const stateRoleOk = policy.stateRoleTracker && named === undefined;
      const declares = (text: string): boolean =>
        [...text.matchAll(LABEL_FLAG)].some(match =>
          (match[2] ?? "")
            .split(",")
            .map(part => part.trim())
            .some(candidate => roles.includes(candidate))
        ) ||
        text.includes(HUMAN_GATE_MARKER) ||
        (stateRoleOk && LIFECYCLE_ROLE_READY.test(text));
      // A creation the command does not spell out itself, because it lives in
      // a file the command runs or submits. The conjunction may straddle the
      // two: `curl <endpoint> --data-binary @payload.json` keeps the endpoint
      // in argv and the mutation in the file.
      const fromFile = inline
        ? undefined
        : (await namedFiles({ text: command })).flatMap(file => {
            const signature =
              CREATION_SIGNATURES.find(entry => entry.re.test(file.text))
                ?.name ??
              (GRAPHQL_CREATE.test(file.text) &&
              (TRACKER_ENDPOINT.test(file.text) ||
                TRACKER_ENDPOINT.test(command))
                ? "a tracker creation"
                : undefined);
            if (signature === undefined || declares(file.text)) return [];
            return [`${signature} inside ${file.path}`];
          })[0];
      const signatureName = inline?.name ?? fromFile;
      if (signatureName === undefined) return;
      if (declares(declarable)) return;
      if (named !== undefined)
        throw new Error(
          [
            `block-direct-issue-create: refusing ${signatureName} — this filing declares no readiness.`,
            "",
            "WHY: a work item filed without the build-ready role is an incomplete",
            "handoff. Build-intake scans the ready lane and nothing else, so nothing",
            "will ever pick it up: the write succeeds and the work still dies.",
            "",
            `THIS FILING IS ADDRESSED AT ANOTHER REPOSITORY: ${named}.`,
            "That repository runs its own build queue off its own ready role, so this",
            "project's role does not answer for it — and this project's filing flow",
            "writes to this project's tracker, so it cannot reach the target at all.",
            "",
            "FILE IT THE SANCTIONED WAY:",
            "",
            "1. An upstream defect or hardening report. Use the upstream filing path,",
            "   which composes a redacted, public-safe body through an allowlist",
            "   projection instead of free-form prose:",
            "",
            "     bunx @codyswann/lisa file-upstream --input <filing-event>.json",
            "",
            "   lisa-persist-learning step 6 runs exactly this, headless, on a cron.",
            "2. If you must run the CLI directly, the command has to carry the TARGET",
            `   repository's build-ready role — ${roles.join(", ")} — as the value of a`,
            "   --label flag. Configure it as hardening.upstreamReadyRole when the",
            "   target renamed its lane.",
            "",
            `DO NOT reach for ${HUMAN_GATE_MARKER} to get past this one. It still`,
            "satisfies the guard, but on an upstream defect report it is a false",
            "declaration: the target's build queue scans the ready role and nothing",
            "else, so the report is filed and never picked up.",
            "",
            "OPERATOR ESCAPE: a human can export LISA_ALLOW_DIRECT_ISSUE_CREATE=1 in",
            "the environment before starting the session. Setting it inline on this",
            "command is deliberately refused.",
          ].join("\n")
        );
      throw new Error(
        [
          `block-direct-issue-create: refusing ${signatureName} — this filing declares no readiness.`,
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
          `two declarations itself: the configured build-ready role "${policy.readyRole}",`,
          `or a ${HUMAN_GATE_MARKER} marker in the body it submits.`,
          ...(policy.stateRoleTracker
            ? [
                "",
                `Your role "${policy.readyRole}" is a workflow STATE, not a label, and the`,
                "mandated client is curl, which has no flag that carries a state. So",
                "declare the lifecycle role the access layer resolves the state from:",
                "",
                "  LIFECYCLE_ROLE=ready curl -sS -X POST <the tracker endpoint> …",
                "",
                'or lifecycle_role:"ready" in the request payload, or a --state /',
                "--status flag where the CLI has one.",
              ]
            : []),
          "",
          "WHERE THE DECLARATION IS READ FROM: the command, and the contents of any",
          "file it runs or submits. Moving the create into a script no longer moves",
          "it out of sight, so the declaration can live wherever the create does.",
          "",
          "OPERATOR ESCAPE: a human can export LISA_ALLOW_DIRECT_ISSUE_CREATE=1 in",
          "the environment before starting the session. Setting it inline on this",
          "command is deliberately refused.",
        ].join("\n")
      );
    },
  };
};
