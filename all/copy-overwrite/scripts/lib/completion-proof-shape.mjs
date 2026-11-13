// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Strict shared data contract for accepted-for-completion records. */
import { createHash } from "node:crypto";
import {
  markdownSection,
  topLevelLines,
} from "./completion-proof-markdown.mjs";
import {
  canonicalCompletionBlock,
  usageSpecRemainder,
} from "./completion-proof-projection.mjs";
import {
  CompletionProofError,
  requireProof,
} from "./completion-proof-errors.mjs";

const CLI_OUTPUT = "cli-output";
const TEST_RUN_LOG = "test-run-log";

export {
  CompletionProofError,
  requireProof,
} from "./completion-proof-errors.mjs";

export const PROOF_MARKER = "[lisa-completion-authorization]";
export const PROOF_KIND = "lisa-completion-authorization";
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;
// Native subjects and slurped listings have an independent byte ceiling. The
// separate page/row ceilings do not promise that arbitrarily large rows fit.
export const MAX_NATIVE_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const KINDS = [
  "screenshot",
  "recording",
  "http-transcript",
  CLI_OUTPUT,
  "log-snippet",
  "db-query-output",
  "perf-trace",
  TEST_RUN_LOG,
  "deploy-log",
  "state-dump",
];
export const BOUNDARIES = {
  "code-unit": [TEST_RUN_LOG],
  browser: ["screenshot", "recording"],
  "http-api": ["http-transcript"],
  cli: [CLI_OUTPUT],
  data: ["db-query-output", "state-dump"],
  "deploy-health": ["deploy-log"],
  performance: ["perf-trace"],
  "standards-compat": [CLI_OUTPUT, TEST_RUN_LOG],
};

/** Hash actual bytes, never a caller's claimed digest. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Unambiguous typed fields used by the producer and reader. */
export const isObject = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const isText = value =>
  typeof value === "string" && value.trim().length > 0;
export const isDigest = value =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isOid = value =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export const isId = value => Number.isSafeInteger(value) && value > 0;
export const isTime = value =>
  typeof value === "string" &&
  /(?:Z|\+00:00)$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** Remove only exact canonical machine-owned sections, retaining unknown prose. */
export function primarySpecProjection(body) {
  requireProof(
    typeof body === "string",
    "The primary work-item description is unreadable."
  );
  const headings = topLevelLines(body).filter(row => row.heading);
  const usage = headings.filter(row => row.text === "## Lisa Usage");
  requireProof(
    usage.length <= 1,
    "Duplicate canonical usage sections make the primary specification ambiguous."
  );
  let result = body;
  if (usage.length) {
    const start = usage[0].start;
    const end = headings.find(row => row.start > start)?.start ?? body.length;
    result =
      body.slice(0, start) +
      usageSpecRemainder(body.slice(start, end)) +
      body.slice(end);
  }
  for (const name of ["authorization", "postcondition"]) {
    const start = `<!-- lisa:completion-${name}:start -->`;
    const end = `<!-- lisa:completion-${name}:end -->`;
    const rows = topLevelLines(result);
    const starts = rows.filter(row => row.text === start);
    const ends = rows.filter(row => row.text === end);
    if (!starts.length && !ends.length) continue;
    requireProof(
      starts.length === 1 &&
        ends.length === 1 &&
        ends[0].start > starts[0].start,
      `The canonical completion ${name} block has ambiguous boundaries.`
    );
    if (
      !canonicalCompletionBlock(
        name,
        result.slice(starts[0].end, ends[0].start).trim()
      )
    )
      continue;
    result = result.slice(0, starts[0].start) + result.slice(ends[0].end);
  }
  return result;
}

/** Read the maximal code-fence run without letting its suffix repartition it. */
function claimingFence(line) {
  let start = 0;
  while (start < 3 && line[start] === " ") start += 1;
  const character = line[start];
  if (character !== "`" && character !== "~") return null;
  let end = start;
  while (line[end] === character) end += 1;
  if (end - start < 3) return null;
  const suffix = line.slice(end);
  if (/[\r\n\u2028\u2029]/.test(suffix)) return null;
  return { character, length: end - start, suffix };
}

/** Remove comment contents while preserving text on both sides of their ends. */
function withoutClaimingComments(line, state) {
  let visible = "";
  let offset = 0;
  while (offset < line.length) {
    const boundary = line.indexOf(state.comment ? "-->" : "<!--", offset);
    if (boundary < 0) {
      if (!state.comment) visible += line.slice(offset);
      break;
    }
    if (!state.comment) visible += line.slice(offset, boundary);
    offset = boundary + (state.comment ? 3 : 4);
    state.comment = !state.comment;
  }
  return visible;
}

/**
 * Measure leading whitespace in columns, a tab advancing to the next multiple
 * of four as CommonMark specifies.
 * @param {string} line - Text to measure
 * @param {number} [start] - Column the text begins at
 * @returns {{ columns: number, rest: string }} Column after the whitespace,
 *   and the text from the first non-whitespace character
 */
function leadingColumns(line, start = 0) {
  let columns = start;
  let offset = 0;
  for (; offset < line.length; offset += 1) {
    if (line[offset] === " ") columns += 1;
    else if (line[offset] === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return { columns, rest: line.slice(offset) };
}

/**
 * The content column of a list item whose marker starts at `indent`, or null
 * when the line opens no list item. Following CommonMark, one to four spaces
 * after the marker set the content column; five or more mean the content is
 * indented code one space past the marker; an empty item behaves as one space.
 * @param {number} indent - Column of the first non-whitespace character
 * @param {string} rest - Line text from that character
 * @returns {number | null} Column the item's continuation lines align to
 */
function listContentColumn(indent, rest) {
  const opener = /^(?:[-+*]|\d{1,9}[.)])/.exec(rest);
  if (!opener) return null;
  const markerEnd = indent + opener[0].length;
  const gap = leadingColumns(rest.slice(opener[0].length), markerEnd);
  const width = gap.columns - markerEnd;
  if (!gap.rest) return markerEnd + 1;
  if (width === 0) return null;
  return width > 4 ? markerEnd + 1 : gap.columns;
}

/** A fence may only open where indented code would not, relative to its container. */
function openingFence(relative, rest) {
  const marker = claimingFence(" ".repeat(relative) + rest);
  return marker && !(marker.character === "`" && marker.suffix.includes("`"))
    ? marker
    : null;
}

/**
 * Track list-item containers so indentation is judged against the item that
 * holds a line, not the page margin (CodySwannGT/lisa#4700). A line is
 * indented code only when it sits four or more columns past its container's
 * content column and no paragraph is open; a paragraph continuation (lazy or
 * not) stays prose however deeply it is indented. A blank line closes the
 * paragraph but not the list item, and a less-indented line closes every item
 * whose content column it falls short of.
 * @param {string} line - One line with no comment open at its start
 * @param {{ fence: object | null, items: number[], paragraph: boolean }} state
 *   - Mutable block state carried between lines
 * @returns {boolean} True when the line is visible claiming text
 */
function claimingBlock(line, state) {
  const { columns, rest } = leadingColumns(line);
  if (!rest) {
    state.paragraph = false;
    return true;
  }
  if (!state.paragraph) closeItemsBefore(state, columns);
  const relative = Math.max(0, columns - (state.items.at(-1) ?? 0));
  if (relative >= 4) return state.paragraph;
  return claimingShallowBlock(columns, rest, relative, state);
}

/** Close every list item whose content column a line falls short of. */
function closeItemsBefore(state, columns) {
  while (state.items.length && state.items.at(-1) > columns) state.items.pop();
}

/**
 * A thematic break (`---`, `***`, `___`, `* * *`), or a setext underline
 * after an open paragraph, ends the paragraph and opens no list item, so a
 * line indented after it is code again. A break outranks a list item, which
 * is why `* * *` and `- - -` are read here before `listContentColumn`.
 * @param {string} rest - Line text from its first non-whitespace character
 * @param {boolean} paragraph - Whether a paragraph is open before the line
 * @returns {boolean} True when the line is a break or a setext underline
 */
function breaksParagraph(rest, paragraph) {
  if (/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(rest))
    return true;
  return paragraph && /^(?:=+|-+)[ \t]*$/.test(rest);
}

/**
 * Read a line that starts less than four columns past its container: it may
 * open a fence, end the paragraph, or open a list item at `columns`.
 * @param {number} columns - Column of the line's first non-whitespace character
 * @param {string} rest - Line text from that character
 * @param {number} relative - Columns past the container's content column
 * @param {{ fence: object | null, items: number[], paragraph: boolean }} state
 *   - Mutable block state carried between lines
 * @returns {boolean} True when the line is visible claiming text
 */
function claimingShallowBlock(columns, rest, relative, state) {
  const fence = openingFence(relative, rest);
  if (fence) {
    state.fence = { ...fence, base: state.items.at(-1) ?? 0 };
    state.paragraph = false;
    return false;
  }
  if (breaksParagraph(rest, state.paragraph)) {
    state.paragraph = false;
    return true;
  }
  const content = listContentColumn(columns, rest);
  if (content !== null) {
    closeItemsBefore(state, columns);
    state.items.push(content);
  }
  // A heading or an HTML comment block is not a paragraph, so an indented
  // line after one is code again.
  state.paragraph = !/^(?:#{1,6}(?:[ \t]|$)|<!--)/.test(rest);
  return true;
}

/** A fence closes on a bare marker no deeper than its container allows. */
function closesFence(line, fence) {
  const { columns, rest } = leadingColumns(line);
  const relative = columns - Math.min(columns, fence.base);
  if (relative >= 4) return false;
  const marker = claimingFence(" ".repeat(relative) + rest);
  return Boolean(
    marker &&
    marker.character === fence.character &&
    marker.length >= fence.length &&
    !marker.suffix.trim()
  );
}

/**
 * A fenced block cannot outlive the list item that holds it: a non-blank line
 * indented less than the item's content column ends the item and the fence
 * with it, so that line is read as ordinary Markdown. Lazy continuation never
 * applies inside a fence.
 */
function endsFenceContainer(line, fence) {
  const { columns, rest } = leadingColumns(line);
  return Boolean(rest) && columns < fence.base;
}

/** Fence and comment contents cannot change the other construct's state. */
function claimingLine(line, state) {
  if (state.fence && endsFenceContainer(line, state.fence)) {
    state.fence = null;
    state.paragraph = false;
  }
  if (state.fence) {
    if (closesFence(line, state.fence)) state.fence = null;
    return "";
  }
  if (!state.comment && !claimingBlock(line, state)) return "";
  return withoutClaimingComments(line, state);
}

/** Claim discovery keeps closing-line suffixes; full-spec projection is separate. */
function claimingText(body) {
  const state = { comment: false, fence: null, items: [], paragraph: false };
  return body
    .split("\n")
    .map(raw =>
      claimingLine(raw.endsWith("\r") ? raw.slice(0, -1) : raw, state)
    )
    .join("\n");
}

/** Decode one Markdown escape layer of ASCII punctuation (#4341). */
function unescapedProse(text) {
  return text.replace(
    /\\([\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e])/gu,
    "$1"
  );
}

/**
 * Split one line into prose and inline code spans, CommonMark style: an
 * opening run of N backticks closes at the next run of exactly N, a
 * backslash-escaped backtick never opens a span, and an unclosed run is
 * literal text. An autolink or raw HTML tag (`<` then a letter, `/`, `!` or
 * `?`, closed by `>` on the same line) outranks a code span, so a backtick
 * inside one never opens a span that would hide a real marker; a prose `<`
 * followed by a space, as in `a < b`, is not a tag. A span is only recognised within one line: one that wraps
 * across a soft line break is read as prose. That is a known gap and it fails
 * safe, because prose can only refuse or over-require evidence, never drop an
 * obligation; it also keeps a stray backtick from swallowing a later line.
 * @param {string} line - One claiming line
 * @returns {string[]} Prose at even indexes, an empty placeholder at each odd
 *   index where an inline code span was removed
 */
function inlineCodeParts(line) {
  const parts = [];
  const token = /\\[\s\S]|<[A-Za-z/!?][^>\n]*>|`+/gu;
  let prose = 0;
  for (let open = token.exec(line); open; open = token.exec(line)) {
    if (!open[0].startsWith("`")) continue;
    const close = new RegExp(`(?<!\`)${open[0]}(?!\`)`, "gu");
    close.lastIndex = token.lastIndex;
    if (!close.exec(line)) continue;
    parts.push(line.slice(prose, open.index), "");
    prose = close.lastIndex;
    token.lastIndex = prose;
  }
  return [...parts, line.slice(prose)];
}

/**
 * Decode one stored Markdown escape layer and mask inline code spans.
 * Linear stores `[EVIDENCE: kind: name]` as `\[EVIDENCE: kind: name\]`; the
 * same one-pass ASCII-punctuation projection the human-gate parser uses
 * (`normalizeProviderMarkdown`, CodySwannGT/lisa#4341) makes the stored and
 * written forms parse identically (#4670). Fences, indented code and comments
 * are already removed by `claimingText`. An inline code span of any
 * backtick-run length is an example too, so it is neither a declaration nor a
 * malformed one (#4689). Each span becomes a lone backtick, which no marker
 * grammar accepts, so the prose on either side cannot splice into a marker.
 * @param {string} text - Claiming text with fences and comments removed
 * @returns {string} Prose with one escape layer decoded and code spans masked
 */
function decodedMarkdown(text) {
  return text
    .split("\n")
    .map(line =>
      inlineCodeParts(line)
        .map((part, index) => (index % 2 ? "`" : unescapedProse(part)))
        .join("")
    )
    .join("\n");
}

/**
 * Exact visible claiming markers; examples and other-item refs do not claim.
 * @param {string} body - Work-item description as the provider returns it
 * @returns {{ kind: string, name: string }[]} Declared local evidence markers
 */
export function localMarkers(body) {
  const text = decodedMarkdown(claimingText(body));
  const matches = [
    ...text.matchAll(/\[EVIDENCE:\s*([a-z-]+):\s*([a-z][a-z0-9-]*)\s*\]/g),
  ];
  const legacy = [...text.matchAll(/\[SCREENSHOT:\s*([a-z][a-z0-9-]*)\s*\]/g)];
  requireProof(
    matches.length === (text.match(/\[EVIDENCE:/g) ?? []).length,
    "A local evidence declaration is malformed; repair its type and name."
  );
  const markers = [
    ...matches.map(row => ({ kind: row[1], name: row[2] })),
    ...legacy.map(row => ({ kind: "screenshot", name: row[1] })),
  ];
  requireProof(
    markers.every(row => KINDS.includes(row.kind)),
    "A local evidence declaration has an unsupported type."
  );
  requireProof(
    new Set(markers.map(row => row.name)).size === markers.length,
    "Local evidence declarations must have unique names."
  );
  return markers;
}

/** Read a markdown section without discarding unknown source sections. */
export function section(body, heading, options) {
  return markdownSection(body, heading, options);
}

/** Preserve the first whitespace-delimited environment suffix in linear work. */
function environmentValue(declaration) {
  let whitespaceStart = -1;
  for (let index = 0; index < declaration.length; index += 1) {
    const character = declaration[index];
    if (/\s/.test(character)) {
      if (whitespaceStart < 0) whitespaceStart = index;
    } else {
      if (
        whitespaceStart >= 0 &&
        (character === "-" || character === "—") &&
        /\s/.test(declaration[index + 1] ?? "")
      )
        return declaration.slice(0, whitespaceStart).trim();
      whitespaceStart = -1;
    }
  }
  return declaration.trim();
}

/**
 * The closed set of reasons a `## Target Backend Environment` declaration may
 * give for `None — no runtime behavior change: <reason>`. It is the one grammar
 * shared by the issue validators (S8), the writers, and this completion checker:
 * a reason outside it was once accepted at validate time and then refused here
 * as pending-proof forever (CodySwannGT/lisa#4684), so the prose surfaces are
 * pinned to this export by a consistency test.
 */
export const NO_RUNTIME_REASONS = Object.freeze([
  "doc-only",
  "config-only",
  "type-only",
  "test-only",
]);

const NO_RUNTIME_DECLARATION = new RegExp(
  `^None\\s*[—-]\\s*no runtime behavior change:\\s*(${NO_RUNTIME_REASONS.map(
    reason => reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|")})\\s*$`,
  "i"
);

/** Exemptions are explicit declarations, never an absent environment. */
export function declaredScope(body, environment) {
  const declaration = section(body, "Target Backend Environment");
  const exemption = NO_RUNTIME_DECLARATION.exec(declaration);
  if (exemption) return { runtime: false, reason: exemption[1].toLowerCase() };
  const value = environmentValue(
    declaration.replace(/^(Assumption|Inferred|Confirmed):\s*/i, "")
  );
  requireProof(
    value === environment,
    `The primary item does not declare target environment ${environment}; run canonical verification for its actual target.`,
    "pending-proof"
  );
  return { runtime: true, reason: null };
}

/** Positive shape validation before any network-selected record is interpreted. */
export function validateRecordShape(record) {
  requireProof(
    isObject(record) &&
      record.schema_version === 1 &&
      record.kind === PROOF_KIND,
    "The completion record schema is unsupported or malformed."
  );
  requireProof(
    isText(record.record_id) &&
      isId(record.revision) &&
      ["accepted-for-completion", "pending", "revoked"].includes(
        record.state
      ) &&
      isTime(record.captured_at) &&
      (record.supersedes === null || isDigest(record.supersedes)),
    "The completion record identity, revision, state or capture time is malformed."
  );
  requireProof(
    isObject(record.subject) &&
      ["github", "linear"].includes(record.subject.provider) &&
      isText(record.subject.ref) &&
      isText(String(record.subject.native_id ?? "")) &&
      isText(record.subject.scope),
    "The completion record must identify the exact native work item and provider scope."
  );
  requireProof(
    isObject(record.repository) &&
      isId(record.repository.id) &&
      /^[^/\s]+\/[^/\s]+$/.test(record.repository.name ?? ""),
    "The implementation repository identity is malformed."
  );
  requireProof(
    isObject(record.producer) && isId(record.producer.github_actor_id),
    "The completion record has no stable publisher identity."
  );
  requireProof(
    isText(record.environment) &&
      isText(record.branch) &&
      isDigest(record.spec_sha256),
    "The completion record environment, branch or full-spec digest is malformed."
  );
  if (record.state !== "accepted-for-completion") return record;
  const source = record.source;
  requireProof(
    isObject(source) &&
      isId(source.pull_request) &&
      isOid(source.tested_head) &&
      isOid(source.pr_head) &&
      isOid(source.merge_sha) &&
      isOid(source.production_snapshot_sha) &&
      isOid(source.delivered_sha) &&
      Array.isArray(source.declaring_commits) &&
      source.declaring_commits.length > 0 &&
      source.declaring_commits.every(isOid),
    "The accepted record lacks exact primary PR, source, merge and delivered identities."
  );
  requireProof(
    Array.isArray(record.manifest) &&
      Array.isArray(record.verdicts) &&
      record.verdicts.length > 0 &&
      Array.isArray(record.evidence) &&
      Array.isArray(record.requirements) &&
      record.requirements.length > 0,
    "The accepted record lacks an enumerable proof manifest, verdicts or requirement map."
  );
  requireProof(
    [
      record.manifest,
      record.verdicts,
      record.evidence,
      record.requirements,
    ].every(rows => rows.every(isObject)),
    "The accepted proof contains malformed attachment or requirement rows."
  );
  const names = [
    "remote",
    "conformance",
    "typed_manifest",
    "delivery",
    "usage",
    "linkage",
    "acceptance",
  ];
  requireProof(
    isObject(record.obligations) &&
      Object.keys(record.obligations).sort().join() === names.sort().join(),
    "The accepted record must explicitly account for every completion obligation."
  );
  return record;
}

/** Native locator content is discovery, never acceptance or a free-form URL. */
export function parseLocator(body) {
  if (typeof body !== "string" || !body.startsWith(`${PROOF_MARKER}\n`))
    return null;
  try {
    const value = JSON.parse(body.slice(PROOF_MARKER.length).trim());
    requireProof(
      value.schema_version === 1 &&
        isId(value.asset_id) &&
        isDigest(value.sha256) &&
        isId(value.revision) &&
        isText(value.record_id) &&
        isText(value.repository),
      "The completion locator is malformed."
    );
    return value;
  } catch (error) {
    if (error instanceof CompletionProofError) throw error;
    throw new CompletionProofError(
      "invalid-proof",
      "The completion locator is not readable structured JSON."
    );
  }
}
