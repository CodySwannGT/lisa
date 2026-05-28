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
 *   - Cursor: strip inject-rules.sh (Cursor auto-loads rules/ natively), strip
 *     Claude-team-specific scripts and `entire hooks claude-code *` calls
 *   - agy: ship NOTHING (agy plugin hooks do not fire in -p mode per verified-by-run)
 *   - Copilot: strip SubagentStart hooks (event missing), strip Claude-team-specific
 *     scripts, conditionally strip inject-rules.sh if the rules-auto-load probe is
 *     positive (caller passes copilotRulesAutoLoads via options)
 *
 * @module scripts/lib/per-agent-hook-filter
 */

/** Per-script applicability rules from the Wave 1 audit. */
const SCRIPT_RULES = {
  "block-no-verify.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
  },
  "enforce-team-first.sh": {
    claude: true,
    codex: false,
    cursor: false,
    agy: false,
    copilot: false,
  },
  "inject-rules.sh": {
    claude: true,
    codex: true,
    cursor: false, // collision: Cursor auto-loads rules/ natively
    agy: false, // hooks don't fire in -p
    copilot: true, // conservative default; conditionally stripped if rules-auto-load probe positive
  },
  "inject-flow-context.sh": {
    claude: true,
    codex: true,
    cursor: false, // SubagentStart unverified on Cursor; conservative default
    agy: false,
    copilot: false, // Copilot lacks SubagentStart event
  },
  "install-pkgs.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
  },
  "notify-ntfy.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
  },
  "setup-jira-cli.sh": {
    claude: true,
    codex: true,
    cursor: true,
    agy: false,
    copilot: true,
  },
  // Unregistered scripts — exclude by default until classified.
  "ticket-sync-reminder.sh": {
    claude: false,
    codex: false,
    cursor: false,
    agy: false,
    copilot: false,
  },
  "track-plan-sessions.sh": {
    claude: false,
    codex: false,
    cursor: false,
    agy: false,
    copilot: false,
  },
};

/** Universal exclude pattern: development helpers. */
const SCRIPT_EXCLUDE_PATTERNS = [/debug/i];

/** Hook command shape: { type: "command", command: "..." } */
const isEntireClaudeCodeCommand = cmd =>
  typeof cmd === "string" &&
  /^command -v entire >\/dev\/null 2>&1 && entire hooks claude-code /.test(cmd);

const scriptNameFromCommand = cmd => {
  if (typeof cmd !== "string") return null;
  const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([^/\s]+\.sh)/.exec(cmd);
  return match ? match[1] : null;
};

/**
 * Translate Claude PascalCase event names to a target agent's native casing.
 *
 * Per the Wave 1 audit's Wave 3 contract step 4 + step 6:
 *   - Cursor: keep PascalCase (loader auto-normalizes)
 *   - Codex: keep PascalCase
 *   - Copilot: rewrite to lowercase / camelCase per Copilot's docs
 *
 * @param {string} eventName Claude event name (e.g. "PreToolUse")
 * @param {"cursor"|"agy"|"copilot"} agent Target agent slug
 * @returns {string} Translated event name
 */
export function translateEventName(eventName, agent) {
  if (agent !== "copilot") return eventName;
  const COPILOT_EVENTS = {
    PreToolUse: "preToolUse",
    PostToolUse: "postToolUse",
    SessionStart: "sessionStart",
    SessionEnd: "sessionEnd",
    UserPromptSubmit: "userPromptSubmitted",
    Stop: "agentStop",
    SubagentStart: "subagentStart", // not supported but include for symmetry
    SubagentStop: "subagentStop",
  };
  return COPILOT_EVENTS[eventName] ?? eventName;
}

/**
 * Whether a script ships to the given agent under the Wave 1 audit ship-list.
 *
 * Falls through to true (ship) for scripts not in the rules table — the
 * conservative default for unknown scripts is to include them; explicit
 * exclusions live in SCRIPT_RULES.
 *
 * @param {string} scriptName e.g. "inject-rules.sh"
 * @param {"claude"|"codex"|"cursor"|"agy"|"copilot"} agent
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
 * @param {"cursor"|"agy"|"copilot"|"codex"} agent
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
 * For agy this function returns undefined regardless of input because agy
 * variants ship no hooks.
 *
 * @param {Record<string, Array<{ matcher?: string, hooks: Array<object> }>>} hookBlock
 *   The Claude-format hook block from .claude-plugin/plugin.json.
 * @param {"cursor"|"agy"|"copilot"|"codex"} agent
 * @param {{ copilotRulesAutoLoads?: boolean }} [opts]
 * @returns {Record<string, Array<{ matcher?: string, hooks: Array<object> }>> | undefined}
 */
export function filterHooksForAgent(hookBlock, agent, opts = {}) {
  if (agent === "agy") return undefined;
  if (!hookBlock || typeof hookBlock !== "object") return undefined;

  /** @type {Record<string, Array<{ matcher?: string, hooks: Array<object> }>>} */
  const out = {};

  for (const [claudeEventName, entries] of Object.entries(hookBlock)) {
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
 * @param {"cursor"|"agy"|"copilot"|"codex"} agent
 * @returns {string[]}
 */
export function filterScriptsForAgent(scriptFilenames, agent) {
  if (agent === "agy") return [];
  return scriptFilenames.filter(name => shouldShipScript(name, agent));
}
