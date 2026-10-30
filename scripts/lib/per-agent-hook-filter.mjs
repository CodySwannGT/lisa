/**
 * Per-agent hook ship/strip filter for Pattern B plugin variant generators.
 *
 * Implements the per-agent ship-list from
 * wiki/architecture/lisa-hook-per-agent-ship-list.md (Wave 1 audit).
 *
 * Each Pattern B per-agent plugin variant generator imports `filterHooksForAgent`
 * to walk the source plugin's hook block and the on-disk hook scripts, returning
 * an agent-appropriate filtered set.
 *
 * Agent strategies:
 *   - Claude: keep everything (this module is not invoked for the Claude variant)
 *   - Codex: ship universal + SubagentStart (handled by the Codex generator's own
 *     ship list — this module is not invoked for Codex; Codex uses the existing
 *     generate-codex-plugin-artifacts.mjs path)
 *   - Cursor: emit hooks to a Cursor-native hooks/hooks.json (camelCase events,
 *     flattened {command, matcher} entries, ${CURSOR_PLUGIN_ROOT}/hooks/ command
 *     paths) via buildCursorHooksJson; strip inject-rules.sh (rules ship as native
 *     rules/*.mdc — the single delivery path; injecting would double-deliver),
 *     Claude-team-specific scripts, and `entire hooks claude-code *` calls
 *   - agy: this filter is NOT consumed for agy. agy hooks ship as a
 *     plugin-bundled ROOT hooks.json emitted by
 *     generate-agy-plugin-artifacts.mjs (its own AGY_PLUGIN_HOOKS map is the
 *     source of truth), and only `block-no-verify` (PreToolUse) is portable —
 *     agy doesn't support SessionStart, so install-pkgs / setup-jira-cli can't
 *     ship as agy hooks. The agy column below is retained only as conceptual
 *     ship-list documentation (block-no-verify.sh, install-pkgs.sh,
 *     setup-jira-cli.sh; strips inject-rules.sh — no full rules tree on agy
 *     — enforce-team-first.sh, inject-flow-context.sh, and `entire ...` calls).
 *   - Copilot: strip SubagentStart hooks (event missing), strip Claude-team-specific
 *     scripts, conditionally strip inject-rules.sh if the rules-auto-load probe is
 *     positive (caller passes copilotRulesAutoLoads via options)
 *   - Devin: the Copilot ship list (Devin has no SubagentStart either, and does
 *     not load the nested rules/ tree, so inject-rules.sh stays), emitted as a
 *     root hooks.json with Devin tool-name matchers and a tool-name shim via
 *     buildDevinHooksJson (CodySwannGT/lisa#4426)
 *
 * @module scripts/lib/per-agent-hook-filter
 */

/** Per-script applicability rules from the Wave 1 audit. */
const SCRIPT_RULES = {
  "block-no-verify.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: true,
    copilot: true,
    devin: true,
  },
  "block-shell-json-parsing.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: true, // ships via AGY_PLUGIN_HOOKS (agy-protocol adapter), like the other PreToolUse guards
    copilot: true,
    devin: true,
  },
  "block-instruction-file-edits.sh": {
    claude: true,
    codex: true,
    cursor: true,
    // agy receives only the Bash arm: agy's plugin hooks match `run_command`,
    // so its file-edit tool calls cannot be intercepted. Documented gap — the
    // redirection/tee/sed-i signatures still hold there.
    agy: true,
    copilot: true,
    devin: true,
  },
  // Bash-only by construction, so every agent that can intercept a shell
  // command gets the WHOLE guard rather than an arm of it — including agy,
  // whose `run_command` matcher is exactly the surface this needs.
  "block-direct-issue-create.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: true,
    copilot: true,
    devin: true,
  },
  // Bash-only by construction, like the guard above, and about a command every
  // agent runs on every PR it opens. Nothing in it reads a Claude-only
  // capability: it tokenizes a shell command and asks `gh` one question.
  "block-blind-automerge.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: true,
    copilot: true,
    devin: true,
  },
  // Fires after a `gh pr create` / `gh pr edit` and checks the two work-item
  // gates a push could not reach. Nothing in it is Claude-specific: it reads a
  // shell command out of the tool payload and runs a node script.
  //
  // Documented gap: agy gets it nowhere, and not through this table. agy's
  // plugin hooks are wired by the AGY_PLUGIN_HOOKS map in
  // `generate-agy-plugin-artifacts.mjs`, which carries PreToolUse
  // `run_command` entries only — there is no PostToolUse surface to attach to,
  // so the flag below is documentation rather than a switch. The compensating
  // rung is shared rather than agent-layer, which is the layer AGENTS.md
  // requires: the pre-push report names both gates as UNRESOLVED with the
  // discharge command on every agent, and CI enforces both regardless.
  "discharge-work-item-gates.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
    devin: true,
  },
  // Portable everywhere the agent has a session-start event, because the
  // question it answers — can this agent reach the credentials its work needs
  // — is not vendor-specific. It only reads config and asks the provider for
  // names, so nothing in it depends on a Claude-only capability.
  //
  // Documented gap: agy has no SessionStart event at all, so it cannot receive
  // this and its sessions get no credential preflight. The compensating rung is
  // shared rather than agent-layer — `lisa doctor` and CI run the same
  // `preflight-secrets.mjs` and exit non-zero on it — which is the layer
  // AGENTS.md requires a gap be compensated at when a harness cannot represent
  // a control.
  "secrets-preflight.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: true, // PreToolUse run_command adapter; agy still has no SessionStart.
    copilot: true,
    devin: true,
  },
  "enforce-team-first.sh": {
    claude: true,
    codex: false,
    cursor: false,
    agy: false,
    copilot: false,
    devin: false,
  },
  "inject-rules.sh": {
    claude: true,
    codex: true,
    cursor: false, // rules ship as native rules/*.mdc (single delivery path); injecting would double-deliver
    agy: false, // no full rules tree on agy; AGENTS.md carries only bounded bridges
    copilot: true, // conservative default; conditionally stripped if rules-auto-load probe positive
    devin: true,
  },
  // Ships wherever the agent has a session-start event, on the same reasoning
  // as `secrets-preflight.sh` and NOT on `inject-rules.sh`'s. Cursor strips
  // rule injection because rules are also delivered as native `rules/*.mdc`, so
  // injecting would double-deliver; a RESOLVED CONFIG has no second delivery
  // path on any agent — it is computed per session from two files on disk and
  // is never emitted as a static artifact — so that reason does not transfer
  // and Cursor gets it.
  //
  // Documented gap: agy has no SessionStart event at all, so agy sessions get
  // no injected config. The compensating rung is the same one AGENTS.md
  // requires when a harness cannot represent a control — shared rather than
  // agent-layer: the gate runner refuses a config it cannot read, and
  // `lisa doctor` exits non-zero on a broken one, on every agent.
  "inject-resolved-config.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
    devin: true,
  },
  // Ships wherever the agent has a session-start event, on the same reasoning
  // as `inject-resolved-config.sh`. The question it answers — WHICH COPY of
  // Lisa is executing in this session — is not vendor-specific: every harness
  // resolves a plugin copy once at session start and then runs it unchanged,
  // so every harness can hand an agent a stale contract while the repository
  // is green.
  //
  // Documented gap: agy has no SessionStart event at all, so agy sessions get
  // no vintage block. The compensating rung is the shared one AGENTS.md
  // requires when a harness cannot represent a control — the Bash enforcement
  // dispatcher still names the producing copy and its vintage in every refusal
  // it prints, and `lisa doctor` reports the same resolution on every agent.
  "enforcement-vintage.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
    devin: true,
  },
  // Session-start local Lisa update (CodySwannGT/lisa#4337). Every harness with
  // a session-start event gets it; OpenCode runs the same engine from its
  // session bootstrap plugin. Documented gap: agy has no SessionStart event, so
  // agy sessions never auto-update — the project still updates the next time a
  // session on any other harness starts in it, and `lisa doctor` reports a
  // stale install on every agent.
  "auto-update.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
    devin: true,
  },
  "inject-flow-context.sh": {
    claude: true,
    codex: true,
    cursor: false, // SubagentStart unverified on Cursor; conservative default
    agy: false, // SubagentStart-only; not in agy's universal ship-list
    copilot: false, // Copilot lacks SubagentStart event
    devin: false,
  },
  "install-pkgs.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: true,
    copilot: true,
    devin: true,
  },
  "setup-jira-cli.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: true,
    copilot: true,
    devin: true,
  },
  "threshold-ratchet.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false, // agy hooks ship only via AGY_PLUGIN_HOOKS (root hooks.json) and don't fire headless; the pre-commit + CI ratchet layers carry parity there
    copilot: true,
    devin: true,
  },
  // Unregistered scripts — exclude by default until classified.
  "ticket-sync-reminder.sh": {
    claude: false,
    codex: false,
    cursor: false,
    agy: false,
    copilot: false,
    devin: false,
  },
  "track-plan-sessions.sh": {
    claude: false,
    codex: false,
    cursor: false,
    agy: false,
    copilot: false,
    devin: false,
  },
};

/** Universal exclude pattern: development helpers. */
// `.agy.sh` scripts are agy-protocol variants emitted into the agy plugin
// artifact by generate-agy-plugin-artifacts.mjs (not via this filter); exclude
// them from every other agent's ship-list so they never leak into cursor /
// copilot / codex variants.
const SCRIPT_EXCLUDE_PATTERNS = [/debug/i, /\.agy\.sh$/];

/** Hook command shape: { type: "command", command: "..." } */
const isEntireClaudeCodeCommand = cmd =>
  typeof cmd === "string" &&
  cmd.startsWith(
    "command -v entire >/dev/null 2>&1 && entire hooks claude-code "
  );

const scriptNameFromCommand = cmd => {
  if (typeof cmd !== "string") return null;
  const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([^/\s]+\.sh)/.exec(cmd);
  return match ? match[1] : null;
};

/**
 * Rewrite a Claude hook command to the Cursor plugin-root form: the
 * `${CLAUDE_PLUGIN_ROOT}/` (or `${CURSOR_PLUGIN_ROOT}/`) prefix is normalized to
 * `${CURSOR_PLUGIN_ROOT}/` (e.g. `${CLAUDE_PLUGIN_ROOT}/hooks/block-no-verify.sh`
 * → `${CURSOR_PLUGIN_ROOT}/hooks/block-no-verify.sh`).
 *
 * Why the token, not a bare `./` (issue #1055, CodeRabbit security review):
 * Cursor plugin hook commands execute with the OPENED PROJECT ROOT as their cwd
 * — NOT the plugin directory (confirmed by a Cursor maintainer on the forum:
 * https://forum.cursor.com/t/inconsistent-working-directory-for-plugin-hook-commands/153236).
 * A bare `./hooks/<script>.sh` would therefore (a) fail to resolve to the
 * plugin's bundled script and (b) let a malicious repo shadow a guard hook with
 * its own project-root `./hooks/*`. `${CURSOR_PLUGIN_ROOT}` is the maintainer-
 * endorsed placeholder for the plugin install dir (`${CLAUDE_PLUGIN_ROOT}` also
 * works in Cursor, but we normalize to the Cursor-native name).
 *
 * @param {string} command
 * @returns {string}
 */
const toCursorCommandPath = command =>
  typeof command === "string"
    ? command.replace(
        /\$\{(?:CLAUDE|CURSOR)_PLUGIN_ROOT\}\//g,
        "${CURSOR_PLUGIN_ROOT}/"
      )
    : command;

/** Claude PascalCase → Copilot event-name map (per Copilot's docs). */
const COPILOT_EVENTS = {
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
  UserPromptSubmit: "userPromptSubmitted",
  Stop: "agentStop",
  // No `SubagentStart`: Copilot has no such event. It is dropped wholesale by
  // AGENT_UNSUPPORTED_EVENTS before translation ever runs (see
  // filterHooksForAgent), so it never needs a mapping here.
  SubagentStop: "subagentStop",
};

/**
 * Claude PascalCase → Cursor event-name map. Verified against the official
 * Cursor hooks reference (issue #1055; the prior "keep PascalCase, loader
 * auto-normalizes" assumption was wrong).
 */
const CURSOR_EVENTS = {
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
  UserPromptSubmit: "beforeSubmitPrompt",
  Stop: "stop",
  SubagentStart: "subagentStart",
  SubagentStop: "subagentStop",
  PreCompact: "preCompact",
};

/**
 * Events a target agent's hook runner does NOT recognize. A hook block under one
 * of these events is dropped wholesale for that agent — even when an individual
 * handler script would otherwise ship — because emitting the event yields a
 * manifest the agent rejects.
 *
 * Copilot has no `SubagentStart` event. Worse, the emitted `subagentStart` entry
 * carries an empty `matcher`, and GitHub Copilot CLI (verified against 1.0.55)
 * rejects the ENTIRE inline hooks config on it — `Invalid inline hooks config
 * ...: hooks.subagentStart[0].matcher: matcher cannot be empty` — so NONE of the
 * plugin's hooks fire, not just the subagent one. Dropping the event restores
 * Copilot hook firing; `inject-rules.sh` still ships under `SessionStart`, so no
 * rule delivery is lost. (Issue #1056, verified by run: with `subagentStart`
 * present zero hooks fired; with it removed the `SessionStart` hooks fired and
 * `${CLAUDE_PLUGIN_ROOT}` resolved.)
 *
 * @type {Record<string, Set<string>>}
 */
const AGENT_UNSUPPORTED_EVENTS = {
  copilot: new Set(["SubagentStart"]),
  // Devin CLI's hook runner documents PreToolUse, PostToolUse,
  // PermissionRequest, UserPromptSubmit, Stop, PostCompaction, SessionStart and
  // SessionEnd. Claude's subagent and compaction events have no Devin
  // counterpart, so their blocks are dropped rather than emitted under a name
  // Devin never fires. Documented gap: a Devin SUB-AGENT gets no injected
  // rules, config, or vintage block — the session that spawned it does.
  devin: new Set([
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "Notification",
  ]),
};

/**
 * Claude tool name → Devin CLI tool name, for hook matchers.
 *
 * Measured by run on Devin CLI 3000.11.3 (CodySwannGT/lisa#4426): Devin's
 * PreToolUse payload names its tools in lowercase — `exec`, `write`, `edit`,
 * `read` — while the tool-input field names (`command`, `file_path`,
 * `content`, `old_string`, `new_string`) are Claude's. A Claude matcher such as
 * `Bash` or `Write|Edit|MultiEdit` therefore never fires on Devin. Names Devin
 * has no tool for (TeamCreate, EnterWorktree, …) map to nothing, and a matcher
 * left with no Devin tool is dropped with its handlers.
 *
 * `apply_patch` rides along with the edit tools: Devin exposes it, and the
 * guards that read file edits already handle Codex's `apply_patch` payload.
 *
 * @type {Record<string, readonly string[]>}
 */
const DEVIN_TOOL_NAMES = {
  Bash: ["exec"],
  Write: ["write", "apply_patch"],
  Edit: ["edit", "apply_patch"],
  MultiEdit: ["edit", "apply_patch"],
  NotebookEdit: ["notebook_edit"],
  Read: ["read"],
  Grep: ["grep"],
  Glob: ["glob"],
  WebFetch: ["webfetch"],
  Task: ["run_subagent"],
  Agent: ["run_subagent"],
  Skill: ["skill"],
  TodoWrite: ["todo_write"],
};

/**
 * Translate a Claude hook matcher into an anchored Devin matcher.
 *
 * An empty matcher matches every tool on both runtimes and is kept empty.
 * Otherwise each `|`-separated Claude tool name is mapped through
 * DEVIN_TOOL_NAMES; MCP tool names (`mcp__…`) are kept verbatim because Devin
 * names MCP tools the same way. The result is anchored (`^(…)$`) because Devin
 * treats the matcher as a regex, and an unanchored `exec` would also match any
 * tool whose name merely contains it.
 *
 * @param {unknown} matcher Claude matcher string (non-strings are skipped).
 * @returns {string | null} Devin matcher, `""` for match-all, or null when no
 *   Claude tool in the matcher exists on Devin.
 */
export function translateMatcherForDevin(matcher) {
  if (matcher === undefined || matcher === "") return "";
  // A malformed (non-string) matcher names no tool Lisa can translate; skip
  // the entry rather than throw mid-build.
  if (typeof matcher !== "string") return null;
  const names = new Set();
  for (const claudeName of matcher.split("|").map(n => n.trim())) {
    if (claudeName.startsWith("mcp__")) {
      names.add(claudeName);
      continue;
    }
    for (const devinName of DEVIN_TOOL_NAMES[claudeName] ?? []) {
      names.add(devinName);
    }
  }
  if (names.size === 0) return null;
  return `^(${[...names].join("|")})$`;
}

/** Devin events whose matcher is tested against the payload's `tool_name`. */
const DEVIN_TOOL_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
]);

/** Hook-relative path of the Devin tool-name shim the generator emits. */
export const DEVIN_TOOL_SHIM = "devin-tool-name-shim.sh";

/**
 * Build the Devin plugin's root `hooks.json` from a Claude-format hook block.
 *
 * Devin loads plugin hooks only from a root `hooks.json` shaped
 * `{ "hooks": { "<Event>": [ { matcher, hooks: [ { type, command } ] } ] } }`
 * — inline hooks in `.claude-plugin/plugin.json` are ignored (measured by run,
 * CodySwannGT/lisa#4426). Event names stay PascalCase. Each surviving handler:
 *
 *   1. passes the per-agent ship list (`shouldShipHook(…, "devin")`);
 *   2. gets its matcher translated by `translateMatcherForDevin`; and
 *   3. has its command prefixed with the tool-name shim, which rewrites the
 *      payload's lowercase Devin `tool_name` back to the Claude name before the
 *      guard reads it. Lisa's guards test `tool_name == "Bash"`, so without the
 *      shim a firing hook would still stand down.
 *
 * `${CLAUDE_PLUGIN_ROOT}` is kept: Devin expands it in plugin hook commands,
 * while `${PLUGIN_ROOT}` is left unexpanded (measured by run).
 *
 * @param {Record<string, Array<{ matcher?: string, hooks: Array<{ type?: string, command: string, [key: string]: unknown }> }>> | undefined} hookBlock
 * @returns {{ hooks: Record<string, Array<{ matcher?: string, hooks: Array<object> }>> } | undefined}
 */
export function buildDevinHooksJson(hookBlock) {
  if (!hookBlock || typeof hookBlock !== "object") return undefined;

  /** @type {Record<string, Array<{ matcher?: string, hooks: Array<object> }>>} */
  const hooks = {};

  for (const [eventName, entries] of Object.entries(hookBlock)) {
    if (isUnsupportedEvent(eventName, "devin")) continue;
    if (!Array.isArray(entries)) continue;
    const translated = [];
    for (const entry of entries) {
      if (!Array.isArray(entry?.hooks)) continue;
      // Only tool events carry a tool-name matcher. A SessionStart matcher
      // (`startup`) names a session source, not a tool, and Devin's runner
      // tests matchers against `tool_name` only — so on every other event
      // the matcher is dropped and the handler fires on each occurrence.
      // Documented gap: a startup-only hook (install-pkgs, auto-update) also
      // runs on a resumed Devin session; both are idempotent.
      const matcher = DEVIN_TOOL_EVENTS.has(eventName)
        ? translateMatcherForDevin(entry.matcher)
        : "";
      if (matcher === null) continue;
      const handlers = entry.hooks
        .filter(h => shouldShipHook(h, eventName, "devin"))
        .map(h => ({
          ...h,
          command: `\${CLAUDE_PLUGIN_ROOT}/hooks/${DEVIN_TOOL_SHIM} ${h.command}`,
        }));
      if (handlers.length === 0) continue;
      translated.push(
        matcher === "" ? { hooks: handlers } : { matcher, hooks: handlers }
      );
    }
    if (translated.length > 0) hooks[eventName] = translated;
  }

  return Object.keys(hooks).length > 0 ? { hooks } : undefined;
}

/**
 * Whether a Claude event name is unsupported by the target agent and must be
 * dropped wholesale (not translated, not partially filtered).
 *
 * @param {string} claudeEventName Claude event name (e.g. "SubagentStart")
 * @param {"cursor"|"agy"|"copilot"|"devin"|"codex"} agent Target agent slug
 * @returns {boolean}
 */
export function isUnsupportedEvent(claudeEventName, agent) {
  return Boolean(AGENT_UNSUPPORTED_EVENTS[agent]?.has(claudeEventName));
}

/**
 * Translate Claude PascalCase event names to a target agent's native casing.
 *
 * Per the Wave 1 audit's Wave 3 contract step 4 + step 6:
 *   - Cursor: rewrite to Cursor camelCase event names (preToolUse, postToolUse,
 *     sessionStart, beforeSubmitPrompt, stop, …)
 *   - Codex / agy: keep PascalCase
 *   - Copilot: rewrite to lowercase / camelCase per Copilot's docs
 *
 * @param {string} eventName Claude event name (e.g. "PreToolUse")
 * @param {"cursor"|"agy"|"copilot"} agent Target agent slug
 * @returns {string} Translated event name
 */
export function translateEventName(eventName, agent) {
  if (agent === "copilot") return COPILOT_EVENTS[eventName] ?? eventName;
  if (agent === "cursor") return CURSOR_EVENTS[eventName] ?? eventName;
  return eventName;
}

/**
 * Whether a script ships to the given agent under the Wave 1 audit ship-list.
 *
 * Falls through to true (ship) for scripts not in the rules table — the
 * conservative default for unknown scripts is to include them; explicit
 * exclusions live in SCRIPT_RULES.
 *
 * @param {string} scriptName e.g. "inject-rules.sh"
 * @param {"claude"|"codex"|"cursor"|"agy"|"copilot"|"devin"} agent
 * @returns {boolean}
 */
export function shouldShipScript(scriptName, agent) {
  // Universal exclude (debug helpers etc.)
  if (SCRIPT_EXCLUDE_PATTERNS.some(re => re.test(scriptName))) return false;
  const rules = SCRIPT_RULES[scriptName];
  if (!rules) return true;
  return Boolean(rules[agent]);
}

/**
 * Whether a hook command entry ships to the given agent.
 *
 * Three classes of hook commands:
 *   1. `entire hooks claude-code *` — Claude-only, strip for everyone else
 *   2. `${CLAUDE_PLUGIN_ROOT}/hooks/<script>` — ship per script rules
 *   3. Anything else — ship by default (rare; conservative)
 *
 * @param {{ type: string, command: string }} hook
 * @param {string} eventName
 * @param {"cursor"|"agy"|"copilot"|"devin"|"codex"} agent
 * @param {{ copilotRulesAutoLoads?: boolean }} [opts]
 * @returns {boolean}
 */
export function shouldShipHook(hook, _eventName, agent, opts = {}) {
  if (!hook || typeof hook.command !== "string") return false;
  const { command } = hook;

  // entire calls are Claude-only.
  if (isEntireClaudeCodeCommand(command)) return false;

  // Script reference: look up per-script rules.
  const scriptName = scriptNameFromCommand(command);
  if (scriptName) {
    // Cursor collision rule for rules + Copilot conditional rules strip
    if (scriptName === "inject-rules.sh") {
      if (agent === "cursor") return false;
      // Belt-and-suspenders rules-once guard: agy gets rules via the AGENTS.md
      // bake, not a hook (rules-once invariant). The SCRIPT_RULES table already
      // sets agy:false, but keep this explicit so the invariant survives a
      // future table edit.
      if (agent === "agy") return false;
      if (agent === "copilot" && opts.copilotRulesAutoLoads === true)
        return false;
    }
    return shouldShipScript(scriptName, agent);
  }

  // Anything else (rare) — ship by default
  return true;
}

/**
 * Filter the plugin's hook block for a target agent and translate event names.
 *
 * Returns the new hook block (or undefined when the block ends up empty after
 * filtering, which means the manifest should omit the hooks field entirely).
 *
 * This function returns the Claude-NESTED block shape (with translated event
 * keys) and is used by the Copilot generator. Cursor does NOT use it — Cursor
 * needs the flattened hooks/hooks.json schema and goes through
 * buildCursorHooksJson instead. The "agy" branch still works (3 universal
 * scripts survive, PascalCase events) and is exercised by unit tests as
 * conceptual ship-list documentation, but agy hooks are NOT emitted through this
 * path — they ship as a plugin-bundled root hooks.json built by
 * generate-agy-plugin-artifacts.mjs (only block-no-verify is portable; agy lacks
 * SessionStart).
 *
 * @param {Record<string, Array<{ matcher?: string, hooks: Array<object> }>>} hookBlock
 *   The Claude-format hook block from .claude-plugin/plugin.json.
 * @param {"cursor"|"agy"|"copilot"|"devin"|"codex"} agent
 * @param {{ copilotRulesAutoLoads?: boolean }} [opts]
 * @returns {Record<string, Array<{ matcher?: string, hooks: Array<object> }>> | undefined}
 */
export function filterHooksForAgent(hookBlock, agent, opts = {}) {
  if (!hookBlock || typeof hookBlock !== "object") return undefined;

  /** @type {Record<string, Array<{ matcher?: string, hooks: Array<object> }>>} */
  const out = {};

  for (const [claudeEventName, entries] of Object.entries(hookBlock)) {
    if (isUnsupportedEvent(claudeEventName, agent)) continue;
    if (!Array.isArray(entries)) continue;
    const filteredEntries = [];
    for (const entry of entries) {
      const handlerArray = entry?.hooks;
      if (!Array.isArray(handlerArray)) continue;
      const filteredHandlers = handlerArray.filter(h =>
        shouldShipHook(h, claudeEventName, agent, opts)
      );
      if (filteredHandlers.length > 0) {
        filteredEntries.push({ ...entry, hooks: filteredHandlers });
      }
    }
    if (filteredEntries.length > 0) {
      const translated = translateEventName(claudeEventName, agent);
      out[translated] = filteredEntries;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Walk a hooks/ directory and return the list of script filenames that should
 * ship to the agent. Scripts referenced by no surviving hook entry are
 * naturally excluded by callers (they should call this to enumerate files
 * to keep AFTER filtering the manifest).
 *
 * @param {string[]} scriptFilenames Filenames found in hooks/
 * @param {"cursor"|"agy"|"copilot"|"devin"|"codex"} agent
 * @returns {string[]}
 */
export function filterScriptsForAgent(scriptFilenames, agent) {
  return scriptFilenames.filter(name => shouldShipScript(name, agent));
}

/**
 * Build the Cursor-native `hooks/hooks.json` structure from a Claude-format hook
 * block.
 *
 * Cursor's hooks file uses a flattened schema that differs from Claude's nested
 * `.claude-plugin/plugin.json` block:
 *
 *   Claude: { "<ClaudeEvent>": [ { matcher, hooks: [ { type: "command", command } ] } ] }
 *   Cursor: { version: 1, hooks: { "<cursorEvent>": [ { command, matcher? } ] } }
 *
 * The transformation:
 *   1. Filters each handler for the cursor agent (drops inject-rules.sh,
 *      enforce-team-first.sh, and `entire hooks claude-code *` calls).
 *   2. Translates Claude PascalCase event names to Cursor camelCase.
 *   3. Flattens each matcher-group into one `{ command, matcher? }` per surviving
 *      handler (unwrapping Claude's `{ type: "command", command }`).
 *   4. Rewrites `${CLAUDE_PLUGIN_ROOT}/hooks/<x>` command paths to the
 *      Cursor plugin-root form `${CURSOR_PLUGIN_ROOT}/hooks/<x>` (plugin hooks
 *      run with the project root as cwd, so a bare `./` would not resolve to the
 *      bundled script and could be shadowed by a repo-local `./hooks/*`).
 *
 * Note: this intentionally re-walks the hook block rather than sharing a
 * skeleton with `filterHooksForAgent`. The DRY extraction was deferred (issue
 * #1055 review): `filterHooksForAgent` is on the Copilot path and emits the
 * Claude-NESTED shape, whereas this emits Cursor's FLAT shape — unifying the
 * walk would risk a sibling-generator regression for marginal gain.
 *
 * @param {Record<string, Array<{ matcher?: string, hooks: Array<{ type?: string, command: string }> }>>} hookBlock
 *   The Claude-format hook block from `.claude-plugin/plugin.json`.
 * @returns {{ version: number, hooks: Record<string, Array<{ command: string, matcher?: string }>> } | undefined}
 *   The Cursor hooks structure, or undefined when no hooks survive (the caller
 *   then omits `hooks/hooks.json` entirely).
 */
export function buildCursorHooksJson(hookBlock) {
  if (!hookBlock || typeof hookBlock !== "object") return undefined;

  /** @type {Record<string, Array<{ command: string, matcher?: string }>>} */
  const hooks = {};

  for (const [claudeEventName, entries] of Object.entries(hookBlock)) {
    if (!Array.isArray(entries)) continue;
    const flattened = [];
    for (const entry of entries) {
      const handlerArray = entry?.hooks;
      if (!Array.isArray(handlerArray)) continue;
      for (const handler of handlerArray) {
        if (!shouldShipHook(handler, claudeEventName, "cursor")) continue;
        const command = toCursorCommandPath(handler.command);
        flattened.push(
          entry.matcher ? { command, matcher: entry.matcher } : { command }
        );
      }
    }
    if (flattened.length > 0) {
      hooks[translateEventName(claudeEventName, "cursor")] = flattened;
    }
  }

  return Object.keys(hooks).length > 0 ? { version: 1, hooks } : undefined;
}
