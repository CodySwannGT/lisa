/**
 * The pull-request activity types a nightly-E2E bypass caller must subscribe to.
 *
 * ## The defect this exists for (issues #3476, #3485)
 *
 * A nightly-E2E waiver needs TWO pieces of evidence, and the guard re-checks
 * both on every evaluation: the bypass label, and a `Nightly-E2E-Bypass:
 * <ticket> <reason>` line in the pull-request BODY. The guard reads both live
 * from the API at gate time, so it would reject a body that no longer carries
 * the line — if it ran.
 *
 * It does not run. The caller subscribes to `labeled`/`unlabeled`, so deleting
 * the label re-fires the gate. Nothing subscribes to `edited`, so deleting the
 * BODY line fires nothing, and the previous SUCCESS check-run stands. A
 * check-run is point-in-time by construction: no event, no re-read. Measured on
 * a caller repo in the portfolio: a required check stayed green for 49m47s
 * while vouching for a waiver that was no longer in the pull request, and the
 * merge landed inside that window.
 *
 * **The reading is current; the reading never happened.** That is why a live
 * API read in the guard — which the guard already does — cannot fix this, and
 * why the repair has to be a trigger.
 *
 * ## Why the caller, and why a migration
 *
 * The reusable workflow is `on: workflow_call`, and a reusable workflow cannot
 * declare pull-request activity types. The trigger list is therefore only
 * expressible in the CALLER, which ships from `expo/create-only/` and is marked
 * "this file is YOURS — Lisa will not overwrite it". A template fix reaches new
 * adoptions only; every already-seeded repository keeps its original trigger
 * list permanently. So the migration is the only surface that reaches the
 * installed base, and `doctor` is the only surface that catches a consumer who
 * later hand-edits the list back.
 *
 * All three read this module, so they cannot disagree about what "armed" means.
 * @module core/nightly-e2e-pull-request-triggers
 */
import { loadYaml } from "../utils/yaml.js";

/**
 * The activity type whose absence is the defect.
 *
 * A pull-request body rewrite raises `edited` and nothing else.
 */
export const BODY_CHANGE_ACTIVITY_TYPE = "edited";

/**
 * GitHub's implicit `types:` for `pull_request` when the key is omitted.
 *
 * Recorded because the omission is NOT a neutral state: the default set does
 * not include `edited`, so a caller with no `types:` at all is vulnerable in
 * exactly the same way as one that lists types and leaves `edited` out. Writing
 * this list explicitly alongside `edited` is behaviour-preserving — it states
 * what GitHub was already doing and adds the missing one.
 */
export const IMPLICIT_PULL_REQUEST_TYPES: readonly string[] = [
  "opened",
  "synchronize",
  "reopened",
];

/** Why a caller's trigger list leaves the bypass gate half-armed. */
export type TriggerGap =
  | "types-omit-edited"
  | "types-absent"
  | "pull-request-absent";

/** What a caller's `on:` block says about body-change re-evaluation. */
export interface TriggerAssessment {
  /** True when a body rewrite re-evaluates the gate. */
  readonly armed: boolean;
  /** Why it is not armed; absent when it is. */
  readonly gap?: TriggerGap;
  /** The activity types actually in force, implicit ones included. */
  readonly effectiveTypes: readonly string[];
}

/**
 * Narrow a parsed value to a mapping.
 * @param value - Parsed YAML value
 * @returns The mapping, or undefined for any other shape
 */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Parse YAML without throwing.
 * @param source - YAML text
 * @returns The document, or undefined when it cannot be parsed
 */
const parseYaml = (source: string): unknown => {
  try {
    return loadYaml(source);
  } catch {
    return undefined;
  }
};

/**
 * Read the `on:` mapping from a parsed workflow.
 *
 * YAML 1.1 resolves a bare `on` key to the BOOLEAN true, which is why js-yaml
 * can hand back `{ true: {...} }` for a workflow every GitHub runner accepts.
 * Both spellings are read here; treating only the string one as real would make
 * this silently answer "no pull_request trigger" for ordinary workflows.
 * @param document - Parsed workflow document
 * @returns The `on:` mapping, or undefined when there is none
 */
const readOnBlock = (
  document: unknown
): Record<string, unknown> | undefined => {
  const root = asRecord(document);
  if (root === undefined) return undefined;
  return asRecord(root["on"]) ?? asRecord(root[String(true)]);
};

/**
 * Read a `types:` value as a list of strings.
 *
 * A single scalar is a legal spelling of a one-element list, so it is widened
 * rather than rejected.
 * @param value - The raw `types:` value
 * @returns The declared types, or undefined when absent or unreadable
 */
const readTypes = (value: unknown): readonly string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every(item => typeof item === "string")
    ? (value as readonly string[])
    : undefined;
};

/** The assessment returned whenever no pull-request trigger is readable. */
const NO_PULL_REQUEST: TriggerAssessment = {
  armed: false,
  gap: "pull-request-absent",
  effectiveTypes: [],
};

/**
 * Decide whether a caller re-evaluates when the pull-request body changes.
 *
 * Fails toward "not armed": an unreadable document, a missing `pull_request`
 * trigger, or a `types:` shape this cannot read all report a gap rather than
 * claiming the gate is fine. A check that reports "armed" when it means "I
 * could not tell" is the whole failure mode being repaired here.
 * @param source - Workflow YAML source
 * @returns What the trigger list means for body-change re-evaluation
 */
export const assessBodyChangeTrigger = (source: string): TriggerAssessment => {
  const onBlock = readOnBlock(parseYaml(source));
  if (onBlock === undefined || !("pull_request" in onBlock)) {
    return NO_PULL_REQUEST;
  }
  // `pull_request:` with an empty value is a legal shape meaning "the
  // defaults", so it is the types-absent case rather than an unreadable one.
  const pullRequest = asRecord(onBlock["pull_request"]);
  const declared =
    pullRequest === undefined ? undefined : readTypes(pullRequest["types"]);
  if (declared === undefined) {
    return {
      armed: false,
      gap: "types-absent",
      effectiveTypes: IMPLICIT_PULL_REQUEST_TYPES,
    };
  }
  return declared.includes(BODY_CHANGE_ACTIVITY_TYPE)
    ? { armed: true, effectiveTypes: declared }
    : { armed: false, gap: "types-omit-edited", effectiveTypes: declared };
};

/**
 * Leading-whitespace width of a line.
 * @param line - Source line
 * @returns Number of leading whitespace characters
 */
const indentOf = (line: string): number =>
  line.length - line.trimStart().length;

/**
 * Whether a line carries no YAML structure.
 * @param line - Source line
 * @returns True for blank lines and whole-line comments
 */
const isSkippable = (line: string): boolean =>
  line.trim() === "" || line.trimStart().startsWith("#");

/**
 * Replace one line without mutating the original list.
 * @param lines - Source lines
 * @param index - Line to replace
 * @param value - Replacement text
 * @returns A new list
 */
const replaceAt = (
  lines: readonly string[],
  index: number,
  value: string
): readonly string[] => [
  ...lines.slice(0, index),
  value,
  ...lines.slice(index + 1),
];

/**
 * Insert one line without mutating the original list.
 * @param lines - Source lines
 * @param index - Position the new line takes
 * @param value - Line to insert
 * @returns A new list
 */
const insertAt = (
  lines: readonly string[],
  index: number,
  value: string
): readonly string[] => [
  ...lines.slice(0, index),
  value,
  ...lines.slice(index),
];

/** A `types:` declaration located in the source text. */
interface TypesLine {
  /** Index of the `types:` line itself. */
  readonly index: number;
  /** Whether it is written inline as `[a, b]`. */
  readonly flow: boolean;
}

/** `types: [a, b]` written inline. */
const FLOW_TYPES = /^\s*types\s*:\s*\[[^[\]]*\]\s*$/;
/** `types:` introducing a block sequence. */
const BLOCK_TYPES = /^\s*types\s*:\s*$/;
/** A block-sequence item. */
const SEQUENCE_ITEM = /^\s*-\s/;
/** The `pull_request:` key, at any depth. */
const PULL_REQUEST_KEY = /^\s*pull_request\s*:/;

/**
 * Index of the `pull_request:` key line, or -1.
 *
 * Nested rather than top-level, which is what distinguishes the trigger key
 * from anything else. A wrong guess cannot produce a wrong file: every rewrite
 * built on this is verified by re-parsing the result before it is returned.
 * @param lines - Source lines
 * @returns Line index, or -1 when there is none
 */
const pullRequestKeyIndex = (lines: readonly string[]): number =>
  lines.findIndex(
    line =>
      !isSkippable(line) && indentOf(line) > 0 && PULL_REQUEST_KEY.test(line)
  );

/**
 * The lines belonging to the block a key introduces.
 * @param lines - Source lines
 * @param keyIndex - Index of the key line
 * @returns The block's lines, in order
 */
const blockBody = (
  lines: readonly string[],
  keyIndex: number
): readonly string[] => {
  const owner = indentOf(lines[keyIndex] ?? "");
  const rest = lines.slice(keyIndex + 1);
  const end = rest.findIndex(
    line => !isSkippable(line) && indentOf(line) <= owner
  );
  return end === -1 ? rest : rest.slice(0, end);
};

/**
 * Locate the `types:` line belonging to `on.pull_request`.
 *
 * Deliberately a line scan rather than a parse-and-re-emit. These files are
 * consumer-owned and dense with explanatory comments that say WHY each trigger
 * is present; round-tripping them through a YAML serializer would silently
 * delete every one of those comments.
 * @param lines - Source lines
 * @returns The located declaration, or undefined when the shape is unfamiliar
 */
const findPullRequestTypesLine = (
  lines: readonly string[]
): TypesLine | undefined => {
  const keyIndex = pullRequestKeyIndex(lines);
  if (keyIndex === -1) return undefined;
  const body = blockBody(lines, keyIndex);
  const offset = body.findIndex(
    line => FLOW_TYPES.test(line) || BLOCK_TYPES.test(line)
  );
  if (offset === -1) return undefined;
  const index = keyIndex + 1 + offset;
  return { index, flow: FLOW_TYPES.test(lines[index] ?? "") };
};

/**
 * Add `edited` inside an inline `[...]` list.
 *
 * String indexing rather than a regular expression: an unbounded class inside
 * brackets is the shape that backtracks badly on adversarial input, and this
 * runs over files Lisa did not write.
 * @param line - The `types: [...]` line
 * @returns The line with `edited` appended
 */
const appendToFlowList = (line: string): string => {
  const open = line.indexOf("[");
  const close = line.indexOf("]", open + 1);
  if (open === -1 || close === -1) return line;
  const inner = line.slice(open + 1, close).trimEnd();
  const extended =
    inner.trim() === ""
      ? BODY_CHANGE_ACTIVITY_TYPE
      : `${inner}, ${BODY_CHANGE_ACTIVITY_TYPE}`;
  return `${line.slice(0, open + 1)}${extended}${line.slice(close)}`;
};

/**
 * Add `- edited` to a block sequence, matching the style already in use.
 * @param lines - Source lines
 * @param located - The `types:` declaration introducing the sequence
 * @returns The rewritten lines
 */
const appendToBlockList = (
  lines: readonly string[],
  located: TypesLine
): readonly string[] => {
  const body = blockBody(lines, located.index);
  const items = body.filter(line => SEQUENCE_ITEM.test(line));
  const lastOffset = body.reduce(
    (accumulator, line, offset) =>
      SEQUENCE_ITEM.test(line) ? offset : accumulator,
    -1
  );
  const itemIndent =
    items[0] === undefined
      ? indentOf(lines[located.index] ?? "") + 2
      : indentOf(items[0]);
  return insertAt(
    lines,
    located.index + lastOffset + 2,
    `${" ".repeat(itemIndent)}- ${BODY_CHANGE_ACTIVITY_TYPE}`
  );
};

/**
 * Write an explicit `types:` under a `pull_request:` that declares none.
 *
 * The implicit default omits `edited`, so this case is vulnerable too, and
 * stating the defaults alongside `edited` is behaviour-preserving rather than a
 * widening. Only a `pull_request:` that already has a mapping body is extended;
 * a bare one is left to `doctor`, because inventing a body for it is a guess
 * about a consumer's intent rather than a repair.
 * @param lines - Source lines
 * @returns The rewritten lines, or undefined when no safe insertion exists
 */
const insertTypesDeclaration = (
  lines: readonly string[]
): readonly string[] | undefined => {
  const keyIndex = pullRequestKeyIndex(lines);
  if (keyIndex === -1) return undefined;
  const child = blockBody(lines, keyIndex).find(line => !isSkippable(line));
  if (child === undefined) return undefined;
  const declaration = [
    ...IMPLICIT_PULL_REQUEST_TYPES,
    BODY_CHANGE_ACTIVITY_TYPE,
  ];
  return insertAt(
    lines,
    keyIndex + 1,
    `${" ".repeat(indentOf(child))}types: [${declaration.join(", ")}]`
  );
};

/**
 * Produce the candidate lines that would arm a caller.
 * @param lines - Source lines
 * @returns The rewritten lines, or undefined when no safe edit exists
 */
const armedLines = (
  lines: readonly string[]
): readonly string[] | undefined => {
  const located = findPullRequestTypesLine(lines);
  if (located === undefined) return insertTypesDeclaration(lines);
  return located.flow
    ? replaceAt(
        lines,
        located.index,
        appendToFlowList(lines[located.index] ?? "")
      )
    : appendToBlockList(lines, located);
};

/**
 * Add `edited` to a caller's pull-request trigger list, in place and in style.
 *
 * Idempotent, and fails SAFE in both directions: a caller that is already armed
 * is returned untouched, and a shape this cannot confidently edit is also
 * returned untouched rather than guessed at. Every rewrite is verified by
 * re-parsing the result and confirming the gate is now armed — if the surgical
 * edit did not achieve that, the original source is returned and `doctor`
 * reports the caller for a human instead. Writing a broken workflow into a
 * consumer repository would take their gate from half-armed to not running at
 * all, which is strictly worse than the defect.
 * @param source - Workflow YAML source
 * @returns The armed source, or the original when no safe edit exists
 */
export const ensureBodyChangeTrigger = (source: string): string => {
  if (assessBodyChangeTrigger(source).armed) return source;
  const rewritten = armedLines(source.split("\n"));
  if (rewritten === undefined) return source;
  const candidate = rewritten.join("\n");
  return assessBodyChangeTrigger(candidate).armed ? candidate : source;
};
