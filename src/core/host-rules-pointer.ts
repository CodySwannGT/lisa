/**
 * The Lisa-managed host-rules pointer block, and the bounded-block editor every
 * managed block in `AGENTS.md` is written through.
 *
 * `.agents/rules/` is the canonical, agent-neutral directory for host-authored
 * operating rules. It is deliberately not a native auto-load tree for any
 * runtime, so every agent reaches it through exactly one surface — this pointer
 * block in `AGENTS.md` (Claude via the `@AGENTS.md` import in `CLAUDE.md`) — and
 * no agent loads host rules twice.
 *
 * Pointer only. Lisa never writes rule bodies into `AGENTS.md` or into
 * `.agents/rules/`; that is what distinguishes this block from the legacy
 * `LISA_RULES_START..END` bake that PR #1150 removed.
 * @module core/host-rules-pointer
 */
import { HOST_RULES_DIR } from "./project-config.js";

/** Marker opening Lisa's bounded host-rules pointer block. */
export const LISA_HOST_RULES_START_MARKER = "<!-- LISA_HOST_RULES_START -->";
/** Marker closing Lisa's bounded host-rules pointer block. */
export const LISA_HOST_RULES_END_MARKER = "<!-- LISA_HOST_RULES_END -->";

/**
 * Add, replace, or remove one bounded Lisa-managed block in an instruction
 * file, leaving every byte outside the markers untouched.
 *
 * Malformed markers are a hard no-op — only one of the pair present, the end
 * before the start, or either marker occurring more than once — because Lisa
 * must never guess which host bytes belong to it.
 * @param body - Existing instruction-file body.
 * @param startMarker - Opening marker for the managed block.
 * @param endMarker - Closing marker for the managed block.
 * @param replacement - Full replacement block, or empty string to remove.
 * @returns Updated body, or the original body for malformed markers.
 */
export function replaceManagedBlock(
  body: string,
  startMarker: string,
  endMarker: string,
  replacement: string
): string {
  const startIdx = body.indexOf(startMarker);
  const endIdx = body.indexOf(endMarker);
  const hasStart = startIdx !== -1;
  const hasEnd = endIdx !== -1;
  const hasDuplicateStart =
    hasStart && body.indexOf(startMarker, startIdx + startMarker.length) !== -1;
  const hasDuplicateEnd =
    hasEnd && body.indexOf(endMarker, endIdx + endMarker.length) !== -1;
  if (
    hasStart !== hasEnd ||
    (hasStart && endIdx < startIdx) ||
    hasDuplicateStart ||
    hasDuplicateEnd
  ) {
    return body;
  }
  if (!hasStart) {
    if (replacement === "") {
      return body;
    }
    const separator = body.endsWith("\n") ? "\n" : "\n\n";
    return `${body}${separator}${replacement}\n`;
  }
  const before = body.slice(0, startIdx);
  const after = body.slice(endIdx + endMarker.length);
  const next = `${before}${replacement}${after}`;
  // Collapse 3+ consecutive newlines to two (bounded quantifier for slow-regex).
  return `${next.replace(/\n\n\n+/g, "\n\n").trim()}\n`;
}

/**
 * Build the exact bounded host-rules pointer block.
 * @param legacyRulesFile - Project-relative path to a surviving legacy
 *   single-file rules document, when one exists. Omit when none does.
 * @returns Managed pointer block with surrounding markers.
 */
export function buildHostRulesPointer(legacyRulesFile?: string): string {
  return [
    LISA_HOST_RULES_START_MARKER,
    "## Host Rules",
    "",
    `This project's durable, host-authored operating rules live in \`${HOST_RULES_DIR}/\`.`,
    "Read those files when you need this project's standing rules. They are not",
    "injected at session start, so consult them on demand — which also means every",
    "agent reads them through this one pointer and no agent loads them twice.",
    "",
    `**Ownership.** The host owns every file in \`${HOST_RULES_DIR}/\`. Lisa never writes`,
    "rule bodies there; Lisa's own rules ship through its per-agent plugins. This",
    "marked block is the only Lisa-managed content in this file — everything outside",
    "the markers belongs to the host and is never touched.",
    ...transitionParagraph(legacyRulesFile),
    LISA_HOST_RULES_END_MARKER,
  ].join("\n");
}

/**
 * Remove the managed host-rules pointer from an AGENTS.md body. Malformed
 * marker pairs are left unchanged.
 * @param body - Existing `AGENTS.md` contents.
 * @returns The body with the managed pointer removed, when a full block exists.
 */
export function stripHostRulesPointer(body: string): string {
  return replaceManagedBlock(
    body,
    LISA_HOST_RULES_START_MARKER,
    LISA_HOST_RULES_END_MARKER,
    ""
  );
}

/**
 * Lines naming a surviving legacy single-file rules document, so its content
 * stays reachable while the project transitions. Empty when the project has
 * none — the paragraph then disappears on its own.
 * @param legacyRulesFile - Project-relative legacy rules path, if any.
 * @returns Zero or more block lines.
 */
function transitionParagraph(legacyRulesFile: string | undefined): string[] {
  if (legacyRulesFile === undefined) {
    return [];
  }
  return [
    "",
    `**Transition.** This project still has host rules at \`${legacyRulesFile}\`.`,
    "They remain authoritative and are left exactly as written — Lisa does not",
    "move, rewrite, or delete them. Agents whose runtime auto-loads that path",
    "(Claude Code auto-loads `.claude/rules/`) already have that content and must",
    "not read it a second time; every other agent should read it alongside",
    `\`${HOST_RULES_DIR}/\`. Reclassifying or relocating it is a human-gated`,
    "decision, never an automated rewrite.",
  ];
}
