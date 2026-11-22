/**
 * What each coding agent offers for refusing a file write, and where its
 * edit-time carrier is registered.
 *
 * This table is the one place that says which agents can be made to run the
 * declared checks after they write a file. An agent has the surface when
 * three things hold:
 *
 * 1. it runs a hook after one of its file-writing tools finishes,
 * 2. that hook can be registered in a file the agent reads from the
 *    repository, so it is there for everyone who clones it, and
 * 3. the hook's result reaches the agent as a failure it has to act on.
 *
 * An agent that fails any of the three is listed with the reason, and
 * `lisa controls install-carriers --agents` records it as unenforceable
 * instead of installing something that would run and change nothing.
 *
 * ## Where the facts come from
 *
 * Each row says how the third point is known ({@link RefusalEvidence}):
 *
 * - Claude Code: a hook that exits 2 after a tool ran is shown to the agent.
 *   This repository's own rule for enforcement hooks states it.
 * - Codex: `PostToolUse` with exit status 2 replaces the tool's result with
 *   the hook's standard error. Stated by Codex's hook documentation; project
 *   hooks need the operator's one-time `/hooks` trust before they run.
 * - Cursor: read from the Cursor agent's shipped program. Exit status 2 from
 *   a `postToolUse` hook is not passed to the agent; the hook's
 *   `additional_context` is. So the carrier answers Cursor in that field.
 * - OpenCode: an error thrown from `tool.execute.after` is shown to the
 *   agent. Recorded as verified by run in
 *   `wiki/architecture/lisa-hook-per-agent-ship-list.md`.
 * - Copilot: reads `.github/hooks/*.json` from the repository (its own
 *   `help config` says so). Whether it shows the agent a failing
 *   `postToolUse` hook has not been measured; Lisa's other Copilot hooks
 *   rely on exit status 2, and so does this one.
 * - Devin: reads `.devin/hooks.v1.json`, and exit status 2 is the status it
 *   blocks on before a tool runs (measured, see
 *   `src/devin/enforcement-fallback-installer.ts`). After a tool runs it has
 *   not been measured.
 * - Antigravity: it runs a `PostToolUse` hook, and its own hooks guide says
 *   that hook must answer with an empty object, so nothing a hook finds after
 *   a write reaches the agent. Lisa's measured record
 *   (`wiki/architecture/lisa-hook-per-agent-ship-list.md`) is also that its
 *   hooks do not run in a non-interactive session. It fails the third point,
 *   so it has no surface.
 *
 * A row marked `assumed` is the place to look first when an agent appears to
 * ignore a failing write: one measured run settles it, and moving the agent
 * to {@link NoAgentHookSurface} is a one-row change.
 * @module controls/carrier-agent-surfaces
 */
import type { AgentRefusal, RefusalEvidence } from "./carrier-types.js";
import type { CodingAgent } from "./coding-agents.js";

/**
 * A hook entry merged into a settings file the agent and the repository both
 * write: a matcher and a list of handlers (`nested`), or one object holding
 * the command and the matcher (`flat`).
 */
export interface MergedRegistration {
  readonly kind: "merged";
  /** The settings file, from the repository root. */
  readonly file: string;
  /** The keys that lead to the list of hooks for the event. */
  readonly path: readonly string[];
  /** How one entry of that list is written. */
  readonly shape: "nested" | "flat";
  /** The tools the hook runs after, as the agent's matcher spells them. */
  readonly matcher: string;
  /** What a new file holds beside the hook; empty for nothing. */
  readonly skeleton: Readonly<Record<string, unknown>>;
}

/** A whole file Lisa places and owns: nothing of the repository's is in it. */
export interface PlacedRegistration {
  readonly kind: "placed";
  /** The file, from the repository root. */
  readonly file: string;
  /** What the file is: a hooks file the agent reads, or a plugin it loads. */
  readonly format: "copilot-hooks" | "opencode-plugin";
  /**
   * The tools that write a file, as the agent names them. The agent cannot
   * narrow the hook itself, so the carrier or the plugin does.
   */
  readonly tools: readonly string[];
}

/** An agent that can be made to refuse a file write. */
export interface AgentHookSurface {
  readonly refuses: true;
  /** The agent's own name for the hook that runs after a write. */
  readonly event: string;
  /** Where and how the carrier is registered. */
  readonly registration: MergedRegistration | PlacedRegistration;
  /** How the agent is told a write failed. */
  readonly refusal: AgentRefusal;
  /** How it is known that the agent acts on that. */
  readonly evidence: RefusalEvidence;
}

/** An agent that cannot be made to refuse a file write. */
export interface NoAgentHookSurface {
  readonly refuses: false;
  /** Why, in a sentence an operator can read. */
  readonly why: string;
}

/** How long, in seconds, an agent lets the carrier run. */
export const AGENT_HOOK_TIMEOUT_SECONDS = 150;

/** The Lisa-owned hooks file Copilot reads from the repository. */
const COPILOT_HOOKS_FILE = ".github/hooks/lisa-controls.json";

/**
 * The Lisa-owned plugin OpenCode loads from the repository. It sits in the
 * folder `lisa apply` writes OpenCode plugins to (a suite holds the two
 * together), under a name that command does not manage, so neither removes
 * the other's file.
 */
export const OPENCODE_PLUGIN_FILE = ".opencode/plugin/lisa-controls-carrier.js";

/** The event name Claude Code, Codex and Devin share. */
const POST_TOOL_USE = "PostToolUse";

/** The event name Cursor and Copilot share. */
const POST_TOOL_USE_CAMEL = "postToolUse";

/** What every coding agent offers, by agent. */
export const AGENT_SURFACES: Readonly<
  Record<CodingAgent, AgentHookSurface | NoAgentHookSurface>
> = {
  claude: {
    event: POST_TOOL_USE,
    evidence: "documented",
    refusal: "exit-2",
    refuses: true,
    registration: {
      file: ".claude/settings.json",
      kind: "merged",
      matcher: "Write|Edit|MultiEdit|NotebookEdit",
      path: ["hooks", POST_TOOL_USE],
      shape: "nested",
      skeleton: {},
    },
  },
  codex: {
    event: POST_TOOL_USE,
    evidence: "documented",
    refusal: "exit-2",
    refuses: true,
    registration: {
      file: ".codex/hooks.json",
      kind: "merged",
      matcher: "Edit|Write|apply_patch",
      path: ["hooks", POST_TOOL_USE],
      shape: "nested",
      skeleton: {},
    },
  },
  cursor: {
    event: POST_TOOL_USE_CAMEL,
    evidence: "documented",
    refusal: "additional-context",
    refuses: true,
    registration: {
      file: ".cursor/hooks.json",
      kind: "merged",
      matcher: "Write|Edit",
      path: ["hooks", POST_TOOL_USE_CAMEL],
      shape: "flat",
      skeleton: { version: 1 },
    },
  },
  agy: {
    refuses: false,
    why: "Antigravity has no hook that can refuse a file write: a hook that runs after one of its tools must answer with an empty result, so nothing the hook finds reaches the agent.",
  },
  copilot: {
    event: POST_TOOL_USE_CAMEL,
    evidence: "assumed",
    refusal: "exit-2",
    refuses: true,
    registration: {
      file: COPILOT_HOOKS_FILE,
      format: "copilot-hooks",
      kind: "placed",
      tools: ["edit", "create", "write", "str_replace_editor", "apply_patch"],
    },
  },
  opencode: {
    event: "tool.execute.after",
    evidence: "measured",
    refusal: "thrown-error",
    refuses: true,
    registration: {
      file: OPENCODE_PLUGIN_FILE,
      format: "opencode-plugin",
      kind: "placed",
      tools: ["edit", "write", "multiedit", "patch", "apply_patch"],
    },
  },
  devin: {
    event: POST_TOOL_USE,
    evidence: "assumed",
    refusal: "exit-2",
    refuses: true,
    registration: {
      file: ".devin/hooks.v1.json",
      kind: "merged",
      matcher: "^(write|apply_patch|edit|notebook_edit)$",
      path: [POST_TOOL_USE],
      shape: "nested",
      skeleton: {},
    },
  },
};
