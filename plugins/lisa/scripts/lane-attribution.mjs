#!/usr/bin/env node
/**
 * Say which lane performed an agent-authored action, without saying which
 * session.
 *
 * ## The defect
 *
 * Lisa lanes share the operator's GitHub credential, so GitHub records every
 * agent merge, dismissal and auto-merge change as an action by the account
 * owner. A later reader cannot tell an agent's action from the operator's own,
 * or tell two concurrent lanes apart (CodySwannGT/lisa#3625). With one shared
 * key there is no actor field that can carry lane identity — `botActor` is
 * null and the actor resolves to the key owner — so the message body is the
 * only channel that exists.
 *
 * ## Why the identifier is NOT the session
 *
 * The obvious identifier is the session id or its URL, and it is exactly the
 * thing this repository forbids publishing: CodySwannGT/lisa#3731 refuses
 * session URLs in commit messages, and one of the write points here IS a merge
 * commit message. The upstream repository is public and `dist/` is published,
 * so a session identifier written into an attribution trailer is a leak with
 * extra steps — and the issue asking for this feature already carries a raw
 * session UUID in its own comment, which is the hazard demonstrating itself.
 *
 * So attribution uses a LANE LABEL: operator-chosen, non-secret, stable, and
 * meaningful across sessions. When none is set, a short digest derived from
 * the session id stands in — it distinguishes concurrent lanes without
 * disclosing the session, and it is one-way. A raw session id or URL is
 * refused outright rather than trimmed, because a value that must never be
 * published should fail loudly at the boundary, not be silently rewritten.
 *
 * ## Shared with the tracker-comment half
 *
 * CodySwannGT/lisa#3563 is the same defect for tracker COMMENTS. The lane
 * resolution, the trailer text and the end-anchored dedupe are common to both
 * and live here so the two cannot drift into separate formats — the
 * `lisa-usage-accounting` precedent, where one appended block is owned by a
 * shared utility rather than by each calling flow. This module does not wire
 * the tracker access layers; that is #3563's remaining work.
 * @module lane-attribution
 */
import * as crypto from "node:crypto";

/** First line of the trailer, and the anchor every dedupe matches on. */
export const TRAILER_MARKER = "-- agent-written, lane:";

/**
 * Session-identifier shapes that must never reach a published artifact.
 *
 * A UUID is matched on its own, not only inside a URL: the leak observed on
 * CodySwannGT/lisa#3625 was a bare `session <uuid>` in an issue comment, with
 * no URL around it.
 */
const SESSION_SHAPES = [
  /https?:\/\/[^\s]*\/session_[A-Za-z0-9]+/i,
  /\bsession_[A-Za-z0-9]{8,}/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
];

/**
 * A lane label safe to publish: short, printable, no whitespace runs.
 * @param {string} value A candidate label.
 * @returns {string} The normalised label, or the empty string.
 */
export function normalizeLane(value) {
  const trimmed = String(value ?? "")
    .trim()
    .replace(/\s+/g, "-");
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(trimmed) ? trimmed : "";
}

/**
 * A non-reversible stand-in for a lane nobody named.
 *
 * Derived from the session id so concurrent lanes differ, truncated so it
 * cannot be walked back to the session, and prefixed so a reader can see it is
 * machine-derived rather than an operator's chosen name.
 * @param {string} sessionId The harness session identifier.
 * @returns {string} A short lane token.
 */
export function derivedLane(sessionId) {
  const digest = crypto
    .createHash("sha256")
    .update(String(sessionId ?? ""))
    .digest("hex");
  return `auto-${digest.slice(0, 8)}`;
}

/**
 * Resolve the lane this process should attribute its actions to.
 *
 * `LISA_LANE` first, because a name an operator chose is the one that means
 * something to an operator reading the artifact months later. The derived
 * token is a fallback, never a preference.
 * @param {Record<string, string | undefined>} env Process environment.
 * @returns {{lane: string, source: string} | null} The lane, or null when
 *   nothing identifies this process at all.
 */
export function resolveLane(env = process.env) {
  const named = normalizeLane(env.LISA_LANE);
  if (named !== "") return { lane: named, source: "LISA_LANE" };
  const session = String(env.CLAUDE_SESSION_ID ?? "").trim();
  if (session !== "")
    return { lane: derivedLane(session), source: "derived-from-session" };
  return null;
}

/**
 * The attribution trailer, in plain text.
 *
 * Plain text rather than markdown, and the reason is measured on the tracker
 * side (CodySwannGT/lisa#3563): Linear normalises comment markdown on write,
 * so a trailer using emphasis or a horizontal rule does not round-trip
 * byte-identically and every readback comparison fails. The same formatter
 * serves both surfaces, so it stays plain everywhere.
 *
 * The second line is the load-bearing one. Without it a reader who sees the
 * operator's avatar has no reason to doubt it, and the trailer reads as the
 * operator signing their own name.
 * @param {string} lane The resolved lane label.
 * @param {string} owner The account whose credential performed the write.
 * @returns {string} The trailer text.
 */
export function laneTrailer(lane, owner = "the credential owner") {
  return (
    `${TRAILER_MARKER} ${lane}\n` +
    `This action was performed by a Lisa agent. GitHub shows ${owner} as the actor ` +
    `because every lane shares that credential; the native actor field is unchanged.`
  );
}

/**
 * Refuse text carrying a session identifier.
 * @param {string} text Candidate outbound text.
 * @returns {string} The text, unchanged, when it is safe to publish.
 */
export function assertNoSessionIdentifier(text) {
  const body = String(text ?? "");
  for (const shape of SESSION_SHAPES) {
    if (shape.test(body)) {
      throw new Error(
        "lane-attribution refuses to publish a session identifier. The upstream " +
          "repository is public and CodySwannGT/lisa#3731 forbids session URLs in " +
          "commit messages, which is one of the artifacts this trailer is written " +
          "into. Attribute with a stable lane label (LISA_LANE) instead — a lane " +
          "is what an auditor needs, and it is not a secret."
      );
    }
  }
  return body;
}

/**
 * Strip every lane trailer already present, whatever lane wrote it.
 *
 * Lane-agnostic on purpose. Flows retry and re-post, and two lanes can touch
 * one body, so matching only THIS lane's trailer lets a body signed by one
 * lane collect a second trailer from another — which is worse than no
 * attribution, because it reads as two lanes having acted.
 * @param {string} body The body to clean.
 * @returns {string} The body with any trailing attribution removed.
 */
export function stripLaneTrailer(body) {
  const lines = String(body ?? "").split("\n");
  let end = lines.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith(TRAILER_MARKER)) end = index;
  }
  return lines.slice(0, end).join("\n").replace(/\s+$/, "");
}

/**
 * Append the trailer to a body, idempotently.
 *
 * A body with no lane resolved is returned untouched rather than annotated
 * with a placeholder: "written by an unknown lane" tells a reader nothing they
 * did not already know, and a trailer that is sometimes meaningless trains
 * readers to skip all of them.
 * @param {string} body The action's message body, possibly empty.
 * @param {{lane: string} | null} resolved The resolved lane.
 * @param {string} owner The credential owner GitHub will show as the actor.
 * @returns {string} The body carrying exactly one trailer.
 */
export function withLaneTrailer(body, resolved, owner) {
  if (!resolved?.lane) return String(body ?? "");
  const base = stripLaneTrailer(body);
  const trailer = assertNoSessionIdentifier(laneTrailer(resolved.lane, owner));
  return base === "" ? trailer : `${base}\n\n${trailer}`;
}

/**
 * Read a `--flag value` pair out of argv.
 * @param {readonly string[]} argv Arguments.
 * @param {string} flag The flag, including dashes.
 * @returns {string} The value, or the empty string.
 */
export function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

/**
 * Dispatch on the requested mode.
 * @param {readonly string[]} argv Command-line arguments.
 * @param {string} raw Piped stdin.
 * @param {Record<string, string | undefined>} env Process environment.
 * @returns {{ text: string, code: number }} What to print, and the exit code.
 */
export function main(argv, raw, env = process.env) {
  const resolved = resolveLane(env);
  if (argv.includes("--lane")) {
    return resolved
      ? { text: `${resolved.lane} (${resolved.source})\n`, code: 0 }
      : { text: "no lane resolved; set LISA_LANE\n", code: 1 };
  }
  const owner = flagValue(argv, "--owner") || "the credential owner";
  const body = argv.includes("--body") ? flagValue(argv, "--body") : raw;
  return { text: `${withLaneTrailer(body, resolved, owner)}\n`, code: 0 };
}
