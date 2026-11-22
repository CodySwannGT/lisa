/**
 * The three results `lisa controls enforce-report` is handed, each held to
 * its shape before anything in it is used.
 *
 * | Option | What the file holds | Written by |
 * | --- | --- | --- |
 * | `--carriers` | The result of installing the carriers | `lisa controls install-carriers` (stdout) |
 * | `--tickets` | One result per missing requirement | The missing-capability ticket flow, which an agent carries out |
 * | `--protect` | The comparison of merge protection with the register | `lisa controls protect` (stdout) |
 *
 * All three are required, and a file that is absent, empty, not JSON or of
 * the wrong shape stops the command with one line per problem. Only the keys
 * the report derives from are checked: the commands may print more.
 *
 * The ticket results are the one document an agent writes by hand:
 *
 * ```json
 * {
 *   "schema_version": 1,
 *   "results": [
 *     {
 *       "criterion": "SI8",
 *       "scope": "api",
 *       "key": "21d606d43cb0",
 *       "outcome": "ticketed",
 *       "ticket": "#412",
 *       "ticket_state": "created",
 *       "reason": null,
 *       "question": null
 *     }
 *   ]
 * }
 * ```
 * @module controls/enforce-inputs
 */
import { readResultFile, type JsonObject } from "./enforce-input-shape.js";
import {
  carriersProblems,
  protectProblems,
  ticketsProblems,
} from "./enforce-input-rules.js";
import type {
  EnforceInputPaths,
  EnforceInputsRead,
  HandedCarriers,
  HandedProtect,
  HandedTicket,
} from "./enforce-input-types.js";

export type {
  EnforceInputPaths,
  EnforceInputs,
  EnforceInputsRead,
  HandedProtect,
  HandedTicket,
} from "./enforce-input-types.js";

/** One handed document: its option, what it is, and how it is checked. */
interface Handed {
  readonly option: keyof EnforceInputPaths;
  readonly what: string;
  readonly producedBy: string;
  readonly problems: (document: JsonObject, where: string) => readonly string[];
}

const HANDED: readonly Handed[] = [
  {
    option: "carriers",
    problems: carriersProblems,
    producedBy: '"lisa controls install-carriers"',
    what: "The carriers result",
  },
  {
    option: "tickets",
    problems: ticketsProblems,
    producedBy: "the missing-capability ticket flow",
    what: "The ticket results",
  },
  {
    option: "protect",
    problems: protectProblems,
    producedBy: '"lisa controls protect"',
    what: "The merge-protection result",
  },
];

/**
 * Read one handed document and hold it to its shape.
 * @param handed - Which document, and how it is checked
 * @param file - Where it was saved, or `undefined` when no path was given
 * @returns The document, or one line per problem
 */
async function readHanded(
  handed: Handed,
  file: string | undefined
): Promise<
  | { readonly problems: null; readonly document: JsonObject }
  | { readonly problems: readonly string[] }
> {
  if (file === undefined || file.trim() === "") {
    return {
      problems: [
        `${handed.what} was not given. Save what ${handed.producedBy} printed in a file outside the repository and pass its path with --${handed.option}.`,
      ],
    };
  }
  const read = await readResultFile(file, handed.what, handed.producedBy);
  if (read.problem !== null) return { problems: [read.problem] };
  const problems = handed.problems(
    read.document,
    `${handed.what} (--${handed.option})`
  );
  return problems.length > 0
    ? { problems }
    : { document: read.document, problems: null };
}

/**
 * Read the three results the enforce step saved.
 * @param paths - Where each one was saved
 * @returns The results, or every problem found in any of them
 */
export async function readEnforceInputs(
  paths: EnforceInputPaths
): Promise<EnforceInputsRead> {
  const [carriers, tickets, protect] = await Promise.all(
    HANDED.map(handed => readHanded(handed, paths[handed.option]))
  );
  if (
    carriers?.problems !== null ||
    tickets?.problems !== null ||
    protect?.problems !== null
  ) {
    return {
      problems: [carriers, tickets, protect].flatMap(
        read => read?.problems ?? []
      ),
    };
  }
  return {
    inputs: {
      carriers: carriers.document as unknown as HandedCarriers,
      protect: protect.document as unknown as HandedProtect,
      tickets: (
        tickets.document as { readonly results: readonly HandedTicket[] }
      ).results,
    },
    problems: null,
  };
}
