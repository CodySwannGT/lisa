/**
 * Structured, bounded reads of a repository's live GitHub rulesets through the
 * `gh` CLI, and the material projection health compares.
 * @module health/ruleset-gh
 */
import { execFile } from "node:child_process";

import { resolveExecutable } from "../utils/resolve-executable.js";

const GH_TIMEOUT_MS = 15_000;
const MAX_GH_OUTPUT_BYTES = 256 * 1024;
/**
 * The largest page the platform returns for a list. The ruleset list is asked
 * for at this size, and an answer this long may be cut off.
 *
 * This is the one bound on how many rulesets are read, and it is the same
 * one `readLivePolicy` in `lisa-reconcile-policy.mjs` applies. The two must
 * agree: `lisa controls protect` reads the rulesets with that script before a
 * change and with this reader after it, and a list the first read accepted
 * and the second refused left every change on such a repository reported as
 * not confirmed. `tests/unit/controls/protect-many-rulesets.test.ts` holds
 * the two to the same line.
 */
export const RULESET_PAGE_SIZE = 100;
/**
 * How many ruleset details are read at once. It is the most this reader ever
 * started together, kept so that reading a longer list does not start more
 * requests at one time than reading a short one did.
 */
const DETAIL_READS_AT_ONCE = 32;

/** Material ruleset fields health compares. */
export interface HealthRuleset {
  readonly name: string;
  readonly target: unknown;
  readonly enforcement: unknown;
  readonly conditions: unknown;
  readonly rules: unknown;
}

/**
 * Injectable structured ruleset reader. Implementations must honor `signal`
 * and release any owned handles before settling.
 */
export type RulesetReader = (
  owner: string,
  repo: string,
  projectRoot: string,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<readonly HealthRuleset[]>;

/**
 * Return a sorted copy without mutating caller-owned input.
 * @param items - Caller-owned items
 * @param compare - Stable comparator
 * @returns A new array holding the items in comparator order
 */
export function sortedCopy<T>(
  items: readonly T[],
  compare: (left: T, right: T) => number
): readonly T[] {
  return [...items].sort(compare);
}

/**
 * Run one fixed-argv bounded gh read, answering its stdout.
 *
 * Text rather than JSON, because not every bounded read this package makes is
 * one JSON document: `gh api --paginate` emits one array PER PAGE, so a
 * paginated read is a stream of values and its `--jq` output is lines. Shared
 * so there is one `gh` invocation site in this package rather than a second
 * one beside it.
 * @param argv - gh arguments after the executable
 * @param cwd - Working directory for the command
 * @param timeoutMs - Bound for the external command, in milliseconds
 * @param signal - Cancellation shared with the health deadline
 * @returns The command's standard output
 */
export function readGhText(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      resolveExecutable("gh"),
      [...argv],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_GH_OUTPUT_BYTES,
        signal,
        killSignal: "SIGKILL",
        timeout: Math.max(1, Math.min(timeoutMs, GH_TIMEOUT_MS)),
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * Run one fixed-argv bounded gh JSON read.
 * @param argv - gh arguments after the executable
 * @param cwd - Working directory for the command
 * @param timeoutMs - Bound for the external command, in milliseconds
 * @param signal - Cancellation shared with the health deadline
 * @returns The parsed JSON document
 */
async function readGhJson(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<unknown> {
  return JSON.parse(await readGhText(argv, cwd, timeoutMs, signal)) as unknown;
}

/**
 * Validate and project one detailed GitHub ruleset response.
 * @param candidate - Untrusted ruleset document
 * @returns The material fields health compares
 */
export function projectRuleset(candidate: unknown): HealthRuleset {
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("Ruleset detail was not an object");
  }
  const name = Reflect.get(candidate, "name");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Ruleset detail omitted its name");
  }
  return {
    name,
    target: Reflect.get(candidate, "target"),
    enforcement: Reflect.get(candidate, "enforcement"),
    conditions: Reflect.get(candidate, "conditions"),
    rules: Reflect.get(candidate, "rules"),
  };
}

/**
 * One bounded JSON read of the hosting platform, as fixed `gh` arguments.
 * Every argument list a ruleset reader passes is a `GET`.
 */
export type RulesetJsonReader = (
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<unknown>;

/**
 * Tell whether a ruleset list of some length can be taken for the whole list.
 *
 * The list is asked for one page at a time, at the largest page the platform
 * gives. A page that comes back full cannot be told from a list that goes
 * on, so only a shorter one is the whole list. A caller that is about to
 * make the list longer asks this first, about the length it would then have.
 * @param length - How many rulesets the list holds, or would hold
 * @returns True when a list of that length is the whole list
 */
export function isWholeRulesetList(length: number): boolean {
  return length < RULESET_PAGE_SIZE;
}

/**
 * Split a list into runs of at most some length, in order.
 * @param items - The list
 * @param size - The longest a run may be
 * @returns The runs, in order
 */
function inRunsOf<T>(
  items: readonly T[],
  size: number
): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, run) =>
    items.slice(run * size, (run + 1) * size)
  );
}

/**
 * Build a detailed ruleset reader over one JSON read function.
 *
 * The walk — list the rulesets, read each one's detail, keep the material
 * fields, sort by name — is the same whoever makes the requests. A caller
 * that has to account for every request it sends (`lisa controls protect`
 * reads the settings back after changing them) hands in its own read function
 * and gets this walk rather than a second copy of it.
 * @param readJson - Makes one read and answers the parsed document
 * @returns A reader that walks the rulesets through `readJson`
 */
export function rulesetReaderOver(readJson: RulesetJsonReader): RulesetReader {
  return async (owner, repo, projectRoot, timeoutMs, signal) => {
    // The platform lists thirty rulesets unless a request asks for more, so
    // a read without a page size dropped the thirty-first ruleset and read
    // the list as whole. The largest page is asked for, and a page that
    // comes back full is refused: see `isWholeRulesetList`.
    const listed = await readJson(
      [
        "api",
        "-X",
        "GET",
        `repos/${owner}/${repo}/rulesets?per_page=${String(RULESET_PAGE_SIZE)}`,
      ],
      projectRoot,
      timeoutMs,
      signal
    );
    if (!Array.isArray(listed)) {
      throw new TypeError("The ruleset list was not a list");
    }
    if (!isWholeRulesetList(listed.length)) {
      throw new Error(
        `The ruleset list came back as a full page of ${String(listed.length)}, so there may be more rulesets than were read`
      );
    }
    const readDetail = async (entry: unknown): Promise<HealthRuleset> => {
      if (entry === null || typeof entry !== "object") {
        throw new Error("Ruleset list entry was not an object");
      }
      const id = Reflect.get(entry, "id");
      if (!Number.isSafeInteger(id)) {
        throw new Error("Ruleset list entry omitted its id");
      }
      return projectRuleset(
        await readJson(
          ["api", "-X", "GET", `repos/${owner}/${repo}/rulesets/${String(id)}`],
          projectRoot,
          timeoutMs,
          signal
        )
      );
    };
    // One run of reads at a time, each run started only when the one before
    // it has answered, so a long list never has more requests under way than
    // a short one could.
    const details = await inRunsOf(
      listed as readonly unknown[],
      DETAIL_READS_AT_ONCE
    ).reduce<Promise<readonly HealthRuleset[]>>(
      async (earlier, run) => [
        ...(await earlier),
        ...(await Promise.all(run.map(readDetail))),
      ],
      Promise.resolve([])
    );
    return sortedCopy(details, (left, right) =>
      left.name.localeCompare(right.name)
    );
  };
}

/** Default fixed-argv detailed GitHub ruleset reader. */
export const readGithubRulesets: RulesetReader = rulesetReaderOver(readGhJson);
