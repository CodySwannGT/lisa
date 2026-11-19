/**
 * The ids of the questions an audit asks, and the one way to form each.
 *
 * A question is asked again on every run until a person answers it, and a
 * later step cites an answered question by its id. Both only work when the id
 * of a question is the same on every run, and an agent left to name a question
 * does not name it the same way twice. So the id is never chosen. It is
 * derived:
 *
 * - a question about a requirement has the id `<requirement id>@<scope>`,
 *   built by {@link requirementQuestionId} from the two fields that already
 *   locate the finding it belongs to;
 * - a question about how the repository is set up, which belongs to no single
 *   requirement, has one of the fixed ids on {@link SETUP_QUESTION_IDS}. The
 *   list is closed and short on purpose: an id is added here, in code, when a
 *   later step needs the fact, never by an audit.
 *
 * A leaf module on purpose, like `./tracker-question.ts`, whose id it reuses
 * without restating it.
 * @module controls/question-ids
 */
import { CRITERION_ID_SOURCE } from "./catalogue.js";
import { TRACKER_QUESTION_ID } from "./tracker-question.js";

/** The id of the question that asks where the repository is hosted. */
export const HOSTING_PLATFORM_QUESTION_ID = "hosting-platform";

/** The id of the question that asks who administers the repository. */
export const REPOSITORY_ADMINISTRATOR_QUESTION_ID = "repository-administrator";

/**
 * Every question about the repository's setup an audit may ask, with what each
 * one asks, in the order the skill presents them.
 */
export const SETUP_QUESTIONS = [
  {
    id: TRACKER_QUESTION_ID,
    asks: "which tracker the team plans and follows its work in",
  },
  {
    id: HOSTING_PLATFORM_QUESTION_ID,
    asks: "which hosting platform holds the repository and its merge settings",
  },
  {
    id: REPOSITORY_ADMINISTRATOR_QUESTION_ID,
    asks: "who administers the repository on that platform",
  },
] as const;

/** The id of one question about the repository's setup. */
export type SetupQuestionId = (typeof SETUP_QUESTIONS)[number]["id"];

/** The closed list of setup question ids. */
export const SETUP_QUESTION_IDS: readonly SetupQuestionId[] =
  SETUP_QUESTIONS.map(question => question.id);

/** What stands between the requirement and the scope in a question's id. */
export const QUESTION_ID_SEPARATOR = "@";

/** What a question's id says the question is about. */
export type QuestionIdParts =
  | { readonly kind: "setup"; readonly id: SetupQuestionId }
  | {
      readonly kind: "requirement";
      /** The requirement the question is about. */
      readonly criterion: string;
      /** The scope of the finding the question belongs to. */
      readonly scope: string;
    };

const CRITERION_ID = new RegExp(String.raw`^(?:${CRITERION_ID_SOURCE})$`, "u");

/**
 * Form the id of the question that belongs to one finding.
 * @param criterion - The finding's requirement id
 * @param scope - The finding's scope; `.` is the whole repository
 * @returns The id, the same on every run
 */
export function requirementQuestionId(
  criterion: string,
  scope: string
): string {
  return `${criterion}${QUESTION_ID_SEPARATOR}${scope}`;
}

/**
 * Tell whether an id is one of the fixed setup question ids.
 * @param id - Candidate id
 * @returns Whether it is on the closed list
 */
function isSetupQuestionId(id: string): id is SetupQuestionId {
  return SETUP_QUESTION_IDS.some(known => known === id);
}

/**
 * Read a question's id.
 *
 * The scope is everything after the first separator, so a folder whose own
 * name holds the separator still reads back whole.
 * @param id - Candidate id
 * @returns What the question is about, or `null` when the id is formed in
 *   neither of the two ways
 */
export function parseQuestionId(id: string): QuestionIdParts | null {
  if (isSetupQuestionId(id)) return { kind: "setup", id };
  const at = id.indexOf(QUESTION_ID_SEPARATOR);
  if (at === -1) return null;
  const criterion = id.slice(0, at);
  const scope = id.slice(at + QUESTION_ID_SEPARATOR.length);
  const wellFormed =
    CRITERION_ID.test(criterion) &&
    scope !== "" &&
    scope === scope.trim() &&
    !/[\n\r]/u.test(scope);
  return wellFormed ? { kind: "requirement", criterion, scope } : null;
}
