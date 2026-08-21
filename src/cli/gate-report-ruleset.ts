/**
 * Tier 2 — what a repository ruleset actually requires.
 *
 * `contextsFor()` derives what the required contexts *should* be; the ruleset
 * says what they *are*; nothing compares the two, so they are only ever equal
 * by hand. This module makes the comparison, and it is the one part of the
 * report that needs a network call.
 *
 * The failure mode it exists to avoid is the easy one - an unauthenticated run
 * reporting "this gate does not block a merge" when it simply did not look.
 * Every failure path here lands on `unknown` carrying a reason that separates
 * `not-authenticated` from `call-failed` from `offline`, and no path lands on
 * a verdict.
 * @module cli/gate-report-ruleset
 */
import type { Finding, RulesetComparison } from "./gate-report-types.js";
import { runGh } from "./ui-github-repo-gh.js";

/** Child-process budget for one `gh` call. */
const GH_TIMEOUT_MS = 10_000;

/** Reads the required status contexts guarding the default branch. */
export type RequiredContextsReader = (
  projectRoot: string
) => Promise<readonly string[]>;

/**
 * The required status-check contexts one branch rule names.
 * @param rule - One entry of the branch-rules response
 * @returns Its contexts, in the order the payload lists them
 */
function contextsOfRule(rule: unknown): string[] {
  if (rule === null || typeof rule !== "object") return [];
  const parameters: unknown = Reflect.get(rule, "parameters");
  if (parameters === null || typeof parameters !== "object") return [];
  const checks: unknown = Reflect.get(parameters, "required_status_checks");
  if (!Array.isArray(checks)) return [];
  return checks
    .map(check =>
      check === null || typeof check !== "object"
        ? undefined
        : Reflect.get(check, "context")
    )
    .filter((context): context is string => typeof context === "string");
}

/**
 * Pull every required status-check context out of a branch-rules payload.
 * @param payload - Parsed `rules/branches/{branch}` response
 * @returns Contexts, sorted and de-duplicated
 */
export function extractRequiredContexts(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    throw new TypeError("Branch rules response was not an array");
  }
  return [...new Set(payload.flatMap(contextsOfRule))].sort((left, right) =>
    left.localeCompare(right)
  );
}

/**
 * The repository slug and default branch, from `gh repo view`.
 * @param projectRoot - Project root
 * @param signal - Cancellation signal
 * @returns Slug and branch
 */
async function readRepoTarget(
  projectRoot: string,
  signal: AbortSignal
): Promise<{ slug: string; branch: string }> {
  const view = await runGh(
    ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
    projectRoot,
    GH_TIMEOUT_MS,
    signal
  );
  const parsed: unknown = JSON.parse(view);
  if (parsed === null || typeof parsed !== "object") {
    throw new TypeError("gh repo view did not return an object");
  }
  const slug: unknown = Reflect.get(parsed, "nameWithOwner");
  const branchRef: unknown = Reflect.get(parsed, "defaultBranchRef");
  const branch: unknown =
    branchRef !== null && typeof branchRef === "object"
      ? Reflect.get(branchRef, "name")
      : undefined;
  if (typeof slug !== "string" || typeof branch !== "string") {
    throw new TypeError("gh repo view omitted the repository or its branch");
  }
  return { slug, branch };
}

/**
 * Read the live ruleset through the `gh` CLI.
 * @param projectRoot - Project root, so `gh` resolves the right remote
 * @returns The required contexts guarding the default branch
 */
export const defaultRequiredContextsReader: RequiredContextsReader =
  async projectRoot => {
    const controller = new AbortController();
    const { slug, branch } = await readRepoTarget(
      projectRoot,
      controller.signal
    );
    const rules = await runGh(
      ["api", `repos/${slug}/rules/branches/${branch}`],
      projectRoot,
      GH_TIMEOUT_MS,
      controller.signal
    );
    return extractRequiredContexts(JSON.parse(rules));
  };

/**
 * Turn a `gh` failure into the narrowest honest reason.
 * @param error - Whatever the call threw
 * @returns A machine reason and a human message
 */
export function classifyGhFailure(error: unknown): {
  reason: string;
  message: string;
} {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("ENOENT")) {
    return {
      reason: "gh-not-installed",
      message:
        "The GitHub CLI is not installed, so branch protection could not be read. Nothing here claims a gate does or does not block a merge.",
    };
  }
  if (/auth|credential|HTTP 401|HTTP 403/i.test(text)) {
    return {
      reason: "not-authenticated",
      message:
        "The GitHub CLI is not authenticated for this repository's host, so branch protection could not be read. Nothing here claims a gate does or does not block a merge.",
    };
  }
  return {
    reason: "call-failed",
    message:
      "Reading branch protection failed, so what a merge actually requires is unknown for this run.",
  };
}

/**
 * Read the live required contexts, degrading to `unknown` and never to a pass.
 * @param options - Probe inputs
 * @param options.projectRoot - Project root
 * @param options.offline - Whether the run may make a network call
 * @param options.read - Injectable reader
 * @returns The contexts, or an honest unknown
 */
export async function readRequiredContexts(options: {
  projectRoot: string;
  offline: boolean;
  read: RequiredContextsReader;
}): Promise<Finding<readonly string[]>> {
  if (options.offline) {
    return {
      state: "unknown",
      reason: "offline",
      message:
        "This run was asked not to use the network, so branch protection was not read. The data exists; this run did not fetch it.",
    };
  }
  try {
    const value = await options.read(options.projectRoot);
    return { state: "verified", value };
  } catch (error) {
    return { state: "unknown", ...classifyGhFailure(error) };
  }
}

/**
 * Compare the contexts a declaration implies with the ones a ruleset requires.
 * @param declared - Contexts derived from the gates block
 * @param required - Contexts the ruleset actually requires
 * @returns The three-way comparison
 */
export function compareContexts(
  declared: readonly string[],
  required: readonly string[]
): RulesetComparison {
  const requiredSet = new Set(required);
  const declaredSet = new Set(declared);
  const sort = (values: readonly string[]): string[] =>
    [...values].sort((left, right) => left.localeCompare(right));
  return {
    matched: sort(declared.filter(context => requiredSet.has(context))),
    declaredNotRequired: sort(
      declared.filter(context => !requiredSet.has(context))
    ),
    requiredNotDeclared: sort(
      required.filter(context => !declaredSet.has(context))
    ),
  };
}
