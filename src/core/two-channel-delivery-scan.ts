/**
 * Read the fast channel: which caller-tree paths a `@main` reusable workflow
 * names, and whether anything on a faster channel already covers them.
 *
 * Split from `core/two-channel-delivery` on the seam the signatures already
 * drew: that module knows verdicts and remedies and nothing about YAML; this
 * one knows how a workflow spells a path and nothing about what the answer
 * means. Both are pure — reaching the filesystem belongs to the caller, so the
 * same functions serve Lisa's own CI gate and `lisa doctor` on a consumer.
 *
 * ## What counts as a caller-tree read
 *
 * A path under `scripts/`, `bin/`, or `tools/` carrying a file extension, not
 * preceded by another path segment. The negative lookbehind is what keeps
 * `node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs`
 * from being read as a caller-tree path — it is a PACKAGE path, and whether it
 * survives a release is a different question with its own gate (#2960).
 *
 * ## Why full-line comments are stripped and inline prose is not
 *
 * These workflows are heavily commented, and a comment naming a script is
 * prose rather than a claim. Full-line comments are dropped. Prose INSIDE a
 * `run:` block — an `echo "::error …"` naming the very script the step failed
 * to find — is not, because there is no reliable way to tell it from a command
 * without parsing shell. It costs nothing: such a mention is always in a step
 * that already reads the path, and couplings are deduplicated per workflow and
 * path, so the pair collapses to the one entry it should have been.
 *
 * ## Why deduplication resolves conservatively
 *
 * When one workflow reads the same path from several steps, `packageBacked` is
 * true only if EVERY occurrence names a package candidate — one host-only step
 * is enough to make the coupling host-only, because that step is the one that
 * will fail. `guarded` runs the other way and is true if ANY occurrence is
 * guarded, because one silent-skip path is enough to make the absence silent.
 * Both directions point at reporting more rather than less.
 * @module core/two-channel-delivery-scan
 */
import type { CouplingInput } from "./two-channel-delivery.js";

/** How a workflow spells a path inside the installed Lisa package. */
const PACKAGE_PREFIX = "node_modules/@codyswann/lisa/";

/** Directories a consumer keeps its own executable artifacts in. */
const CALLER_DIRECTORIES = "scripts|bin|tools";

/**
 * A caller-tree path literal: one of the caller directories, a body, and a
 * file extension, with nothing path-like immediately before it.
 */
const CALLER_PATH = new RegExp(
  `(?<![A-Za-z0-9_@./-])((?:${CALLER_DIRECTORIES})/[A-Za-z0-9._/-]*[A-Za-z0-9_-]\\.[A-Za-z0-9]+)`,
  "g"
);

/** A package path literal, used only to decide whether a step is covered. */
const PACKAGE_PATH = new RegExp(
  `${PACKAGE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9_@./-]+`,
  "g"
);

/** A line that is nothing but a YAML comment. */
const COMMENT_LINE = /^\s*#/;

/** The start of a step in a `steps:` list, capturing a `name:` value. */
const STEP_START = /^\s*-\s+(?:name:\s*(.*)|(?:uses|run|id):)/;

/** One step of a workflow, reduced to the text a scan needs. */
export interface WorkflowStep {
  /** The step's `name:`, or an empty string when it has none. */
  readonly name: string;
  /** Every line belonging to the step, joined. */
  readonly body: string;
}

/**
 * Split a workflow into steps, keeping the preamble as an unnamed first step.
 *
 * The preamble is not dead weight: `nightly-e2e-health.yml` declares
 * `inputs.health_script` with a default of `scripts/check-nightly-e2e-health.mjs`,
 * which is a caller-tree read that never appears in a step at all. Dropping the
 * preamble would lose it.
 * @param text - Raw workflow YAML
 * @returns Steps in file order, the first being the preamble
 */
export function extractSteps(text: string): readonly WorkflowStep[] {
  const lines = text.split("\n").filter(line => !COMMENT_LINE.test(line));
  return lines.reduce<WorkflowStep[]>(
    (steps, line) => {
      const started = STEP_START.exec(line);
      const current = steps[steps.length - 1];
      const appended: WorkflowStep = {
        name: current?.name ?? "",
        body: `${current?.body ?? ""}\n${line}`,
      };
      return started === null
        ? [...steps.slice(0, -1), appended]
        : [...steps, { name: (started[1] ?? "").trim(), body: line }];
    },
    [{ name: "", body: "" }]
  );
}

/**
 * Every distinct match of one global pattern in a chunk of text.
 * @param pattern - A global regular expression with one capturing group, or none
 * @param text - Text to search
 * @returns Distinct matches, in first-seen order
 */
function matchesIn(pattern: RegExp, text: string): readonly string[] {
  return [
    ...new Set([...text.matchAll(pattern)].map(match => match[1] ?? match[0])),
  ];
}

/**
 * Whether a step names a package-relative candidate for the same artifact.
 *
 * Compared by suffix rather than by basename: a package candidate for
 * `scripts/lisa-gates.mjs` spells the whole tail
 * `…/all/copy-overwrite/scripts/lisa-gates.mjs`, and matching on the bare file
 * name would let an unrelated package file with a colliding name vouch for a
 * caller path it has nothing to do with.
 * @param packagePaths - Package literals found in the step
 * @param callerPath - The caller-tree path
 * @returns Whether the fast channel already delivers this artifact
 */
function isPackageBacked(
  packagePaths: readonly string[],
  callerPath: string
): boolean {
  return packagePaths.some(candidate => candidate.endsWith(`/${callerPath}`));
}

/** Shell file-test flags whose operand is a path that may be absent. */
const FILE_TEST_FLAG = /-[defrswx]$/;

/** How the Actions expression language asks whether a path exists. */
const HASH_FILES = "hashFiles(";

/** Quoting and leading-`./` noise sitting between a flag and its operand. */
const OPERAND_NOISE = new Set(['"', "'", ".", "/", " ", "\t"]);

/**
 * Drop trailing quoting and path noise, so a flag sits at the end or does not.
 *
 * A loop rather than a `/["\'./]+$/` replace: a quantified class anchored at
 * the end of a caller-supplied slice is the shape linters flag for
 * super-linear backtracking, and nothing here needs a pattern.
 * @param value - Text to trim
 * @returns The same text without its trailing noise characters
 */
function withoutOperandNoise(value: string): string {
  return value.length > 0 && OPERAND_NOISE.has(value.slice(-1))
    ? withoutOperandNoise(value.slice(0, -1))
    : value;
}

/** How far back to look for whatever introduced an occurrence. */
const LOOKBEHIND = 32;

/**
 * Every index at which `needle` occurs in `haystack`.
 *
 * Written with `split` rather than a global regular expression because the
 * needle is a caller-supplied path: compiling it into a pattern is where a
 * super-linear match would come from, and there is nothing here to match
 * loosely.
 * @param haystack - Text to search
 * @param needle - Literal to find
 * @returns Start indices, ascending
 */
function occurrenceIndices(
  haystack: string,
  needle: string
): readonly number[] {
  return haystack
    .split(needle)
    .slice(0, -1)
    .reduce<number[]>((indices, chunk) => {
      const previous = indices.at(-1) ?? -needle.length;
      return [...indices, previous + needle.length + chunk.length];
    }, []);
}

/**
 * Whether a step tests for the path's existence before reading it.
 *
 * Recognises the two spellings that actually occur — a shell file test
 * (`[ -f scripts/x.mjs ]`, `test -e …`) and the Actions `hashFiles()`
 * expression. It does not attempt to decide what the absent branch DOES,
 * because that needs a shell parser and the answer would still be a guess.
 * What it reports is narrower and checkable: the step can tell the path is
 * missing, so its absence need not be loud.
 * @param body - The step's text
 * @param callerPath - The caller-tree path
 * @returns Whether the read sits behind an existence test
 */
function isGuarded(body: string, callerPath: string): boolean {
  return occurrenceIndices(body, callerPath).some(index => {
    const before = body.slice(Math.max(0, index - LOOKBEHIND), index);
    return (
      FILE_TEST_FLAG.test(withoutOperandNoise(before)) ||
      before.includes(HASH_FILES)
    );
  });
}

/** One occurrence of a caller-tree read, before deduplication. */
interface Occurrence {
  readonly step: string;
  readonly path: string;
  readonly packageBacked: boolean;
  readonly guarded: boolean;
}

/**
 * Every caller-tree read in one step.
 * @param step - The step
 * @returns One occurrence per distinct caller path
 */
function occurrencesIn(step: WorkflowStep): readonly Occurrence[] {
  const packagePaths = matchesIn(PACKAGE_PATH, step.body);
  return matchesIn(CALLER_PATH, step.body).map(callerPath => ({
    step: step.name,
    path: callerPath,
    packageBacked: isPackageBacked(packagePaths, callerPath),
    guarded: isGuarded(step.body, callerPath),
  }));
}

/**
 * Collapse repeated reads of one path into the single coupling they are.
 * @param workflow - Workflow file name
 * @param occurrences - Every occurrence found in that workflow
 * @param lanesFor - Delivery lanes shipping a caller path
 * @returns One coupling per distinct path, sorted by path
 */
function collapse(
  workflow: string,
  occurrences: readonly Occurrence[],
  lanesFor: (callerPath: string) => readonly string[]
): readonly CouplingInput[] {
  const paths = [...new Set(occurrences.map(occurrence => occurrence.path))];
  return paths
    .map(callerPath => {
      const found = occurrences.filter(
        occurrence => occurrence.path === callerPath
      );
      return {
        workflow,
        step: found[0]?.step ?? "",
        path: callerPath,
        lanes: lanesFor(callerPath),
        packageBacked: found.every(occurrence => occurrence.packageBacked),
        guarded: found.some(occurrence => occurrence.guarded),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Read every caller-tree coupling out of one reusable workflow.
 * @param options - Inputs
 * @param options.workflow - Workflow file name, as a consumer spells it after `@main`
 * @param options.text - Raw workflow YAML
 * @param options.lanesFor - Delivery lanes shipping a caller path
 * @returns One coupling per distinct caller path, sorted by path
 */
export function scanWorkflow(options: {
  workflow: string;
  text: string;
  lanesFor: (callerPath: string) => readonly string[];
}): readonly CouplingInput[] {
  const steps = extractSteps(options.text);
  return collapse(
    options.workflow,
    steps.flatMap(occurrencesIn),
    options.lanesFor
  );
}

/**
 * Whether a workflow can be called by another repository at all.
 *
 * Only a `workflow_call` workflow travels the `@main` channel; the rest run in
 * this repository and reach no consumer, so a caller-tree read in one of them
 * is a claim about this checkout and not about anybody else's.
 * @param text - Raw workflow YAML
 * @returns Whether the workflow declares `workflow_call`
 */
export function isReusable(text: string): boolean {
  return text
    .split("\n")
    .some(line => line.trimStart().startsWith("workflow_call:"));
}
