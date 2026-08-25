/**
 * Report a live ruleset that governs no branch this repository has.
 *
 * GitHub accepts a `conditions.ref_name.include` entry naming a branch that
 * does not exist — the entries are patterns, not references, and neither side
 * validates them. Two Lisa surfaces already touch ruleset conditions and both
 * miss the zero-reach case, for different reasons:
 *
 * - `compareRulesets` in `ruleset-inspection` holds Lisa's template against the
 *   live ruleset by string equality over `{target, enforcement, conditions,
 *   rules}`. Template says `refs/heads/dev`, live says `refs/heads/dev`, so it
 *   is NOT drifted and therefore healthy. It is a template-conformance check
 *   and cannot be a governance-reach check — and it is deceptive precisely
 *   because the field IS compared, which makes the surface read as covered.
 * - `mapRulesetRow` in `cli/ui-github-repo-map` does parse includes, but as a
 *   literal match on the string `~DEFAULT_BRANCH`, and its only consumer ORs
 *   across rows. One satisfying row makes the whole check green and masks
 *   every non-governing row. It answers "is at least one thing gating?", never
 *   "does each ruleset gate anything?".
 *
 * Nothing else in `src/` or `scripts/` enumerated a repository's branches to
 * test an include list against them, so there was no existence check to
 * repair. CodySwannGT/lisa#2781.
 *
 * ## Why here and not in doctor
 *
 * Answering this requires knowing which branches exist, which is a network
 * read, and doctor is documented as making none — that is why its declared-
 * context check is the OFFLINE half and `lisa health` carries the live one.
 * The same split applies here. The other surface that can answer it is the
 * applier, which is already holding a connection at the moment a ruleset is
 * written; it runs the same detector as a report-only sweep.
 *
 * ## Report only
 *
 * Nothing here creates a branch, edits an include list, or disables a ruleset.
 * All three are an automated actor LOOSENING a control it was not asked to
 * loosen. What an operator is owed is the ruleset's name and the patterns that
 * matched nothing.
 * @module health/ruleset-reach-inspection
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { HealthFinding } from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import {
  readGhText,
  type HealthRuleset,
  type RulesetReader,
} from "./ruleset-inspection.js";

/** This check's stable id. */
const CHECK = "github.ruleset-reach";

/** Repository slug parts this check will address. */
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/u;

/**
 * The most branches this check will reason about.
 *
 * Exceeding it throws rather than truncating. A truncated branch list makes
 * every ruleset look like it governs less than it does, and the resulting
 * report would name rulesets that are perfectly fine — which is how a report
 * becomes noise an operator learns to ignore.
 */
const MAX_BRANCHES = 2_000;

/** Every branch a repository has, and which one is its default. */
export interface RepositoryBranches {
  readonly branches: readonly string[];
  /** Undefined when it could not be resolved — never guessed. */
  readonly defaultBranch: string | undefined;
}

/**
 * Injectable bounded repository-branch reader. Implementations must honor
 * `signal` and release any owned handles before settling.
 */
export type BranchReader = (
  owner: string,
  repo: string,
  projectRoot: string,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<RepositoryBranches>;

/** One classified ruleset, as the shipped detector answers. */
interface ReachEntry {
  readonly name: string;
  readonly verdict: string;
  readonly patterns: readonly string[];
  readonly reason: string;
}

/** The shipped detector's sweep result. */
export interface ReachSweep {
  readonly zeroReach: readonly ReachEntry[];
  readonly undetermined: readonly ReachEntry[];
  readonly governing: readonly ReachEntry[];
}

/** The sweep entry point the shipped detector exports. */
type ReachSweeper = (input: {
  rulesets: readonly HealthRuleset[];
  branches: readonly string[] | undefined;
  defaultBranch: string | undefined;
}) => ReachSweep;

/** The shipped detector's module shape. */
interface ReachModule {
  readonly sweepRulesetReach?: ReachSweeper;
}

/**
 * Default bounded branch reader.
 *
 * `--paginate` emits one JSON array PER PAGE rather than one merged document,
 * so the `--jq` filter runs per page and the names arrive as lines. A reader
 * that parsed stdout as a single JSON value would see page one only, and a
 * partial branch list is worse than none here: it reports governing rulesets
 * as governing nothing.
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param projectRoot - Canonical host root
 * @param timeoutMs - Remaining shared deadline
 * @param signal - Shared cancellation signal
 * @returns Every branch, and the default branch
 */
export const readGithubBranches: BranchReader = async (
  owner,
  repo,
  projectRoot,
  timeoutMs,
  signal
) => {
  const listed = await readGhText(
    [
      "api",
      "--paginate",
      `repos/${owner}/${repo}/branches?per_page=100`,
      "--jq",
      ".[].name",
    ],
    projectRoot,
    timeoutMs,
    signal
  );
  const branches = listed
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (branches.length > MAX_BRANCHES) {
    throw new Error("Branch list exceeded its bounded contract");
  }
  const defaultBranch = await readGhText(
    ["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"],
    projectRoot,
    timeoutMs,
    signal
  ).catch(() => "");
  const trimmed = defaultBranch.trim();
  return {
    branches,
    defaultBranch: trimmed.length === 0 ? undefined : trimmed,
  };
};

/**
 * The repository this check would read, when the settings file names one.
 * @param config - Safe project config
 * @returns The owner and repository, or undefined
 */
function githubTarget(
  config: Readonly<Record<string, unknown>>
): { readonly owner: string; readonly repo: string } | undefined {
  const github = config.github;
  if (github === null || typeof github !== "object" || Array.isArray(github)) {
    return undefined;
  }
  const owner = Reflect.get(github, "org");
  const repo = Reflect.get(github, "repo");
  return typeof owner === "string" &&
    typeof repo === "string" &&
    REPOSITORY_PART.test(owner) &&
    REPOSITORY_PART.test(repo)
    ? { owner, repo }
    : undefined;
}

/**
 * Load the shipped reach detector from the installed Lisa package.
 *
 * Loaded rather than reimplemented, for the reason the generated base ruleset
 * is: the applier runs the same detector at apply time, and a second
 * implementation of the matching rules would let the two surfaces disagree
 * about which rulesets govern nothing, with nothing comparing them.
 * @param lisaRoot - Lisa package root
 * @returns The sweep function, or undefined when unavailable
 */
async function loadDetector(
  lisaRoot: string
): Promise<ReachSweeper | undefined> {
  const entry = pathToFileURL(
    path.join(lisaRoot, "scripts", "lisa-ruleset-reach.mjs")
  ).href;
  const loaded = await (import(entry) as Promise<ReachModule>).catch(
    () => null
  );
  const sweep = loaded?.sweepRulesetReach;
  return typeof sweep === "function" ? sweep : undefined;
}

/**
 * Build the finding for one completed sweep.
 *
 * Zero reach FAILS. Everything such a ruleset requires is required on no ref,
 * so the protection an operator believes they have is not in force anywhere —
 * a contradiction between what is configured and what is live, not a silence.
 * An `undetermined` ruleset WARNS and is named, because a source this run
 * could not read is never reported clean.
 * @param sweep - The completed classification
 * @returns The finding
 */
export function rulesetReachFindingFor(sweep: ReachSweep): HealthFinding {
  if (sweep.zeroReach.length > 0) {
    return deterministicFinding(
      CHECK,
      "fail",
      namedReason(
        "Live rulesets govern no branch in this repository — what they require is required nowhere, and nothing fails to say so",
        sweep.zeroReach.map(
          entry => `${entry.name} (includes: ${entry.patterns.join(", ")})`
        )
      )
    );
  }
  if (sweep.undetermined.length > 0) {
    return deterministicFinding(
      CHECK,
      "warn",
      namedReason(
        "Unproven: these rulesets could not be tested against this repository's branches, which is not the same as their governing one",
        sweep.undetermined.map(entry => `${entry.name} (${entry.reason})`)
      )
    );
  }
  return deterministicFinding(
    CHECK,
    "pass",
    "Every live ruleset governs at least one branch this repository has."
  );
}

/**
 * Call a reader, surviving one that throws synchronously.
 *
 * `.catch()` on the returned promise handles a rejection and nothing else; a
 * reader whose failure happens before it returns one would take the whole
 * health run down, turning "this source was unreadable" into no report at all.
 * @param read - The read to attempt
 * @returns The value, or undefined when it could not be read
 */
async function readSafely<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/**
 * Hold every live ruleset's include patterns against the branches that exist.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param config - Safe project config
 * @param reader - Structured remote ruleset reader
 * @param branchReader - Bounded repository branch reader
 * @param timeoutMs - Remaining shared deadline
 * @param signal - Shared cancellation signal
 * @returns The finding, never a pass on an unread source
 */
export async function rulesetReachFinding(
  lisaRoot: string,
  projectRoot: string,
  config: Readonly<Record<string, unknown>>,
  reader: RulesetReader,
  branchReader: BranchReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HealthFinding> {
  const target = githubTarget(config);
  if (target === undefined) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: no GitHub repository is configured, so no ruleset's include patterns were tested against a branch list."
    );
  }
  const sweepRulesetReach = await loadDetector(lisaRoot);
  if (sweepRulesetReach === undefined) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: Lisa's shipped ruleset-reach detector could not be located, so no include pattern was expanded."
    );
  }
  const rulesets = await readSafely(() =>
    reader(target.owner, target.repo, projectRoot, timeoutMs, signal)
  );
  if (rulesets === undefined) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: live rulesets could not be read within the deterministic deadline, so nothing here claims one does or does not govern a branch."
    );
  }
  // An empty sweep and a repository with no rulesets are indistinguishable
  // from here — a token without the ruleset scope and an organization-level
  // ruleset this reader cannot see both arrive as zero rows — so this run
  // inspected nothing rather than finding nothing.
  if (rulesets.length === 0) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: the repository reported no rulesets at all, so this run inspected nothing rather than finding nothing."
    );
  }
  const repository = await readSafely(() =>
    branchReader(target.owner, target.repo, projectRoot, timeoutMs, signal)
  );
  if (repository === undefined) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: this repository's branches could not be listed, and an unread branch list is not an empty repository."
    );
  }
  return rulesetReachFindingFor(
    sweepRulesetReach({
      rulesets,
      branches: repository.branches,
      defaultBranch: repository.defaultBranch,
    })
  );
}
