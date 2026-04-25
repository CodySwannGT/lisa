/**
 * Tagged-merge writer for `.codex/hooks.json`.
 *
 * Codex's hooks parser is not configured with `deny_unknown_fields` (verified
 * against `codex-rs/config/src/hook_config.rs`), so Lisa can attach
 * `_lisaManaged: true` and `_lisaId: "..."` marker fields to individual hook
 * entries. On every install the merger:
 *
 *   1. Reads the existing hooks.json (if any)
 *   2. Strips every entry where `_lisaManaged === true`
 *   3. Appends the current Lisa hook set with markers attached
 *   4. Preserves all entries the host added (no `_lisaManaged` marker)
 *
 * This mirrors the pattern Lisa uses for `enabledPlugins` deep-merge in
 * `.claude/settings.json` — ownership is keyed on a marker field instead of
 * a key path.
 * @module codex/hooks-merger
 */

/** Markers attached to every Lisa-owned hook entry */
export const LISA_MANAGED_MARKER = "_lisaManaged" as const;
export const LISA_ID_MARKER = "_lisaId" as const;

/** A single hook handler entry (innermost: type/command/timeout/etc.) */
export interface HookHandler {
  readonly type: string;
  readonly command?: string;
  readonly timeout?: number;
  readonly statusMessage?: string;
  /** Lisa ownership marker (set on Lisa-owned entries only) */
  readonly [LISA_MANAGED_MARKER]?: boolean;
  /** Stable identifier so logs can name the hook */
  readonly [LISA_ID_MARKER]?: string;
}

/** A matcher group: a regex matcher + an array of handlers it triggers */
export interface MatcherGroup {
  readonly matcher: string;
  readonly hooks: readonly HookHandler[];
}

/** All hook events Codex understands */
export type CodexHookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop"
  | "SessionStart"
  | "PermissionRequest";

/** The shape of `.codex/hooks.json` */
export interface HooksFile {
  readonly hooks?: Readonly<
    Partial<Record<CodexHookEvent, readonly MatcherGroup[]>>
  >;
}

/** A Lisa-owned hook to be installed (mutable input — markers added by merger) */
export interface LisaHookSpec {
  /** Stable identifier; goes into `_lisaId` so logs can name the hook */
  readonly id: string;
  /** Codex hook event the entry applies to */
  readonly event: CodexHookEvent;
  /** Matcher regex for `matcher` field (use "" for events that don't match) */
  readonly matcher: string;
  /** Shell command to run */
  readonly command: string;
  /** Optional timeout in seconds (Codex default is 600) */
  readonly timeout?: number;
  /** Optional human-readable status message */
  readonly statusMessage?: string;
}

/**
 * Merge Lisa's current hook set into an existing hooks.json document,
 * preserving any host-authored entries.
 * @param existing - Parsed hooks.json (or {} if none)
 * @param lisaHooks - Lisa-owned hook specs to install
 * @returns New HooksFile object with Lisa entries replaced and host entries preserved
 */
export function mergeLisaHooks(
  existing: HooksFile,
  lisaHooks: readonly LisaHookSpec[]
): HooksFile {
  // Step 1: drop every matcher-group that's pure-Lisa, strip Lisa handlers
  // out of mixed-ownership groups, keep purely-host groups unchanged.
  const existingEvents = Object.keys(existing.hooks ?? {}) as CodexHookEvent[];
  const hostOnly: Partial<Record<CodexHookEvent, readonly MatcherGroup[]>> =
    Object.fromEntries(
      existingEvents
        .map(event => {
          const filtered = stripLisaHandlers(existing.hooks?.[event] ?? []);
          return [event, filtered] as const;
        })
        .filter(([, groups]) => groups.length > 0)
    );

  // Step 2: append Lisa's current hook set, grouping by event
  const lisaByEvent = lisaHooks.reduce<
    Partial<Record<CodexHookEvent, readonly MatcherGroup[]>>
  >((acc, spec) => {
    const existingGroups = acc[spec.event] ?? [];
    return {
      ...acc,
      [spec.event]: [...existingGroups, lisaSpecToMatcherGroup(spec)],
    };
  }, {});

  // Step 3: combine — for events touched by both, host first then Lisa
  const allEvents = new Set<CodexHookEvent>([
    ...(Object.keys(hostOnly) as CodexHookEvent[]),
    ...(Object.keys(lisaByEvent) as CodexHookEvent[]),
  ]);
  const merged: Partial<Record<CodexHookEvent, readonly MatcherGroup[]>> =
    Object.fromEntries(
      Array.from(allEvents).map(event => [
        event,
        [...(hostOnly[event] ?? []), ...(lisaByEvent[event] ?? [])],
      ])
    );

  return { hooks: merged };
}

/**
 * Serialize a HooksFile to JSON suitable for writing to disk. Two-space
 * indent, trailing newline.
 * @param file - Hooks file to serialize
 * @returns JSON string ending with a newline
 */
export function serializeHooksFile(file: HooksFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Type guard: parse raw JSON into a HooksFile, validating only the shape we
 * touch. We do NOT reject unknown fields since Codex's parser allows them
 * and we want to preserve host extensions on round-trip.
 * @param raw - Untrusted JSON string from disk
 * @returns Parsed HooksFile
 */
export function parseHooksFile(raw: string): HooksFile {
  if (raw.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("hooks.json must contain a JSON object at the root");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.hooks === undefined) {
    return {};
  }
  if (typeof obj.hooks !== "object" || obj.hooks === null) {
    throw new Error("hooks.json: 'hooks' field must be an object");
  }
  return parsed as HooksFile;
}

/**
 * Drop every Lisa-managed handler from a list of matcher groups. Groups
 * whose only handlers were Lisa-managed are removed entirely. Groups with
 * mixed ownership keep their host handlers.
 * @param groups - Existing matcher groups for one event
 * @returns The same groups with Lisa-managed handlers removed (empty groups dropped)
 */
function stripLisaHandlers(
  groups: readonly MatcherGroup[]
): readonly MatcherGroup[] {
  return groups
    .map(group => ({
      matcher: group.matcher,
      hooks: group.hooks.filter(
        handler => handler[LISA_MANAGED_MARKER] !== true
      ),
    }))
    .filter(group => group.hooks.length > 0);
}

/**
 * Convert a LisaHookSpec into a MatcherGroup with markers attached.
 * @param spec - One Lisa hook spec to install
 * @returns A matcher group containing one Lisa-marked handler
 */
function lisaSpecToMatcherGroup(spec: LisaHookSpec): MatcherGroup {
  const handler: HookHandler = {
    type: "command",
    command: spec.command,
    [LISA_MANAGED_MARKER]: true,
    [LISA_ID_MARKER]: spec.id,
    ...(spec.timeout !== undefined ? { timeout: spec.timeout } : {}),
    ...(spec.statusMessage !== undefined
      ? { statusMessage: spec.statusMessage }
      : {}),
  };
  return {
    matcher: spec.matcher,
    hooks: [handler],
  };
}
