/**
 * Does a Rails deploy workflow SAY why it does not deploy production?
 *
 * The Rails deploy template shipped `# - main` commented out with nothing
 * beside it, which reads exactly like a line someone forgot to restore. The
 * seed was fixed, but that file is `create-only`: Lisa writes it once and
 * never again, so every project seeded before the fix still carries the bare
 * marker and nothing in the toolchain looks for it. The population is not
 * merely unfixed, it is unknown — which is what this module exists to end
 * (CodySwannGT/lisa#3743, CodySwannGT/lisa#3779).
 *
 * The classification lives here, apart from both callers, because two
 * surfaces have to ask the identical question: the regression guard on the
 * shipped template, and the `lisa doctor` check that lets an already-seeded
 * project find itself. Two spellings of "bare" would drift, and the drift
 * would be silent in the direction that matters — a doctor check quietly
 * accepting a shape the seed guard rejects.
 *
 * Every answer here is derived from the workflow text alone, and the one
 * answer it cannot derive — a document it cannot parse — is thrown rather
 * than folded into "production is off". Guessing "no live `main`" out of
 * unparsed YAML would report an ENABLED production deploy as withheld.
 * @module core/rails-deploy-production-intent
 */
import { loadYaml } from "../utils/yaml.js";

/** Branch this template deploys production from. */
const PRODUCTION_BRANCH = "main";

/**
 * The repository secret that has to exist before `- main` may be uncommented.
 *
 * Load-bearing, and the reason this is the marker of an actionable
 * explanation rather than any prose at all: `noliran/branch-based-secrets`
 * expands `AWS_ACCOUNT_ID` into `AWS_ACCOUNT_ID_<BRANCH IN UPPERCASE>`, so a
 * `main` trigger without this secret resolves an empty account id and fails at
 * the credentials step. A comment saying only "enable when ready" is the bare
 * marker with more words.
 */
export const PRODUCTION_ACCOUNT_SECRET = "AWS_ACCOUNT_ID_MAIN";

/**
 * A commented-out production entry in a `branches:` list, in the spellings a
 * YAML sequence entry can take. Anchored end-to-end so a line that comments
 * out `- main` AND says something is not matched here — that text is what
 * `PRODUCTION_ACCOUNT_SECRET` is then asked about.
 */
const COMMENTED_PRODUCTION_ENTRY =
  /^[ \t]*#[ \t]*-[ \t]*(?:"main"|'main'|main)[ \t]*\r?$/mu;

/**
 * What a deploy workflow says about deploying production.
 *
 * `unstated` is the defect: production is off and the file gives no reason,
 * so a reader cannot tell a decision from an accident. The other three are
 * all fine, and are kept apart because they are different facts about the
 * project, not different renderings of "nothing to report".
 */
export type ProductionDeployIntent =
  /** A live `main` entry: production deploys, deliberately. */
  | "triggers"
  /** Commented out, with the enabling precondition named. */
  | "explained"
  /** Commented out, bare. */
  | "unstated"
  /** No `main` entry at all, live or commented. */
  | "unmentioned";

/**
 * Branches the workflow pushes on, as YAML actually parses them.
 *
 * `on:` is YAML 1.1 truthy, so a parser may key the trigger block as `true`;
 * both spellings are read. A scalar `branches:` is one branch.
 * @param workflowText - Full deploy workflow source
 * @returns Every push branch the workflow declares
 * @throws {Error} When the document cannot be parsed
 */
function pushBranches(workflowText: string): readonly string[] {
  const document = loadYaml(workflowText) as {
    readonly on?: { readonly push?: { readonly branches?: unknown } };
    readonly true?: { readonly push?: { readonly branches?: unknown } };
  } | null;
  const branches = (document?.on ?? document?.true)?.push?.branches;
  if (typeof branches === "string") return [branches];
  return Array.isArray(branches)
    ? branches.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Classify what a deploy workflow says about production deployment.
 * @param workflowText - Full deploy workflow source
 * @returns The intent the workflow states, or fails to
 * @throws {Error} When the workflow cannot be parsed as YAML
 */
export function classifyProductionDeployIntent(
  workflowText: string
): ProductionDeployIntent {
  if (pushBranches(workflowText).includes(PRODUCTION_BRANCH)) return "triggers";
  if (!COMMENTED_PRODUCTION_ENTRY.test(workflowText)) return "unmentioned";
  return workflowText.includes(PRODUCTION_ACCOUNT_SECRET)
    ? "explained"
    : "unstated";
}
