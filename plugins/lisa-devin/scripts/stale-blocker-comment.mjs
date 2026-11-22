#!/usr/bin/env node
/**
 * The operator comment and marker dedupe for the stale-link sweep
 * (CodySwannGT/lisa#5065), split from `stale-blocker-sweep.mjs`.
 *
 * The comment is read by a non-technical operator, so it says in plain words
 * which links went and why, which blockers still hold the item, and which
 * could not be opened. It starts with the prefix of whoever posts it (the
 * session manager, or build intake on a runtime without one), and ends with
 * one `[lisa-stale-blocker-link] blocker=<ref>` marker per removed link.
 * @module stale-blocker-comment
 */

import { adfText } from "./ready-queue-order.mjs";

/** Visible marker, one per removed blocker, so a re-run never re-comments. */
export const STALE_LINK_MARKER = "[lisa-stale-blocker-link]";

/** Who may post the comment, and the prefix each one posts under. */
export const STALE_LINK_POSTERS = Object.freeze({
  "session-manager": "[lisa-session-manager]",
  "build-intake": "[claude-build-intake]",
});

/**
 * The marker line for one blocker.
 * @param {string} blockerRef
 * @returns {string}
 */
export const markerLine = blockerRef =>
  `${STALE_LINK_MARKER} blocker=${blockerRef}`;

/**
 * An item's comments as one flat `{ body }` list, whatever envelope the
 * vendor read used: a flat array (`comments: [{ body }]`), Linear's
 * connection (`comments: { nodes: [...] }`), or Jira's issue field
 * (`fields.comment.comments`). A comment given as a bare string is a body.
 * Anything else is skipped, never thrown on, so a marker in any of these
 * shapes is always found.
 * @param {Record<string, any> | null | undefined} raw - The raw item
 * @returns {{ body: unknown }[]}
 */
export function commentsOf(raw) {
  const list = value => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.nodes)) return value.nodes;
    if (Array.isArray(value?.comments)) return value.comments;
    return [];
  };
  return [...list(raw?.comments), ...list(raw?.fields?.comment)]
    .map(comment => (typeof comment === "string" ? { body: comment } : comment))
    .filter(comment => comment && typeof comment === "object");
}

/**
 * Blockers this item's comments already record as removed. A Jira comment
 * body is Atlassian Document Format, so it is flattened to text first.
 * @param {readonly { body?: unknown }[] | undefined} comments
 * @returns {Set<string>}
 */
export function markedBlockers(comments) {
  const pattern = /\[lisa-stale-blocker-link\] blocker=(\S+)/g;
  return new Set(
    (Array.isArray(comments) ? comments : []).flatMap(comment =>
      [...adfText(comment?.body).matchAll(pattern)].map(match => match[1])
    )
  );
}

/**
 * A plain-English list: "A", "A and B", "A, B and C".
 * @param {readonly string[]} refs
 * @returns {string}
 */
const listOf = refs =>
  refs.length < 2
    ? refs.join("")
    : `${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}`;

/**
 * "is" or "are", "was" or "were", matched to how many refs there are.
 * @param {readonly string[]} refs
 * @param {string} one
 * @param {string} many
 * @returns {string}
 */
const agree = (refs, one, many) => (refs.length === 1 ? one : many);

/**
 * @param {readonly { blockerRef: string }[]} edges
 * @returns {string[]} Unique blocker refs
 */
const unique = edges => [...new Set(edges.map(edge => edge.blockerRef))];

/**
 * The sentences about the links this sweep removes.
 * @param {readonly { blockerRef: string, verdict: string }[]} stale
 * @returns {string[]}
 */
function removedSentences(stale) {
  const finished = unique(stale.filter(e => e.verdict !== "cancelled"));
  const cancelled = unique(stale.filter(e => e.verdict === "cancelled"));
  const lines = [];
  if (finished.length > 0) {
    lines.push(
      `This was marked as waiting on ${listOf(finished)}, which ${agree(finished, "is", "are")} done or closed, so ${agree(finished, "it", "they")} cannot hold this up.`
    );
  }
  if (cancelled.length > 0) {
    const lead = finished.length > 0 ? "It was also" : "This was";
    lines.push(
      `${lead} marked as waiting on ${listOf(cancelled)}, which ${agree(cancelled, "was", "were")} cancelled and will not be built, so ${agree(cancelled, "it", "they")} cannot hold this up.`
    );
  }
  const removed = unique(stale);
  lines.push(
    `I removed ${agree(removed, "the link", "those links")}. Nothing else changed.`
  );
  return lines;
}

/**
 * The one comment an operator reads for this item's clean-up.
 * @param {{ stale: object[], real: object[], crossProject: object[], inaccessible: object[] }} sorted
 * @param {string} [poster] - A key of {@link STALE_LINK_POSTERS}
 * @param {string} [posterName] - The configured name of who posts it (the
 *   session manager's `sessionManager.name`), so the operator sees which
 *   manager acted; the prefix stays the machine-read marker
 * @returns {string}
 */
export function formatStaleLinkComment(
  sorted,
  poster = "session-manager",
  posterName = ""
) {
  if (!Object.hasOwn(STALE_LINK_POSTERS, poster)) {
    throw new Error(
      `Unknown stale-link poster '${poster}'. Expected one of: ${Object.keys(STALE_LINK_POSTERS).join(", ")}.`
    );
  }
  const lines = [
    `${STALE_LINK_POSTERS[poster]} ${posterName.trim() ? `${posterName.trim()} cleared` : "Cleared"} waiting-on links.`,
    ...removedSentences(sorted.stale),
  ];
  const open = unique([
    ...sorted.real,
    ...sorted.crossProject.filter(edge => edge.verdict === "open"),
  ]);
  if (open.length > 0) {
    lines.push(
      `It is still waiting on ${listOf(open)}, which ${agree(open, "is", "are")} not finished yet.`
    );
  }
  const unreadable = unique(sorted.inaccessible);
  if (unreadable.length > 0) {
    lines.push(
      `I could not open ${listOf(unreadable)}, so I left ${agree(unreadable, "that link", "those links")} alone.`
    );
  }
  return [lines.join(" "), "", ...unique(sorted.stale).map(markerLine)].join(
    "\n"
  );
}

/**
 * The comment as an Atlassian Document Format document. Jira Cloud's REST v3
 * comment endpoint takes ADF, not a string, so a Jira plan posts this: one
 * paragraph per non-empty line, so each marker stays on its own line and
 * {@link markedBlockers} finds it again through `adfText`.
 * @param {string} comment - From {@link formatStaleLinkComment}
 * @returns {{ type: "doc", version: 1, content: object[] }}
 */
export function staleLinkCommentAdf(comment) {
  return {
    type: "doc",
    version: 1,
    content: comment
      .split("\n")
      .filter(line => line.trim() !== "")
      .map(line => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      })),
  };
}
