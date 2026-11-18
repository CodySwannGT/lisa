/**
 * `lisa controls attest --check [path]`: compute the verdict again and say
 * whether the committed one still stands.
 *
 * It runs no proof and writes nothing. It reads three committed files and
 * holds each to what produces it:
 *
 * 1. **The control register** is generated again from the gates declaration
 *    and the evidence file, and compared with the committed one — the same
 *    comparison `lisa controls register --check` makes. A register edited by
 *    hand fails here.
 * 2. **The evidence file** must be exactly what the attest step writes:
 *    every record closed, every value in its word list, every identifier
 *    the one its record's own fields give.
 * 3. **The verdict** is computed again from that register, that evidence
 *    and the current time, and compared with the committed one value for
 *    value, digest included. A verdict edited to read conforming fails
 *    here; so does one whose evidence was edited, because the digest no
 *    longer matches; so does one whose evidence has gone out of date,
 *    because the requirement now reads unknown.
 *
 * ## What this can and cannot show
 *
 * It shows that the three files agree with each other and with the gates
 * declaration, now. It cannot show that the evidence records are what a run
 * really produced: someone who rewrites the evidence, the register and the
 * verdict together, consistently, leaves three files that agree. Nothing
 * checked on the same machine with no secret can tell that apart from a real
 * run. What can: running `lisa controls attest` again at the recorded commit
 * and comparing, the history of the three files in version control, or a
 * signature made somewhere the author of the change cannot reach.
 * @module controls/attest-check
 */
import path from "node:path";

import { resolveRepositoryRoot } from "./audit-report-file.js";
import {
  loadCriterionCatalogue,
  type CriterionCatalogue,
} from "./catalogue.js";
import { readControlFile } from "./control-files.js";
import { EVIDENCE_PATH } from "./evidence.js";
import { parseEvidenceDocument } from "./evidence-document.js";
import type { EvidenceDocument } from "./evidence-types.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { controlRegisterDrift } from "./register-drift.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "./register.js";
import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
} from "./register-types.js";
import { computeVerdict } from "./verdict.js";
import { verdictDrift } from "./verdict-drift.js";
import { levelSummary } from "./verdict-summary.js";
import { VERDICT_PATH, type Verdict } from "./verdict-types.js";

/** The name the check's summary lines carry. */
export const ATTEST_CHECK_NAME = "attest --check";

/** What the check's exit code says. */
export const ATTEST_CHECK_EXIT = {
  /** The committed verdict is what the register and the evidence give. */
  MATCHES: 0,
  /** Something differs; each difference was named. */
  DIFFERS: 1,
  /**
   * Nothing could be compared: no repository, a refused declaration, or a
   * check that could not finish.
   */
  NOT_CHECKED: 2,
} as const;

/** What the operator does about any difference, said once. */
const HOW_TO_FIX = `The verdict, the evidence and the register are written by the attest step, so do not edit them by hand. Run "lisa controls attest" to prove the controls again and write all three.`;

/** What the check needs from outside, each replaceable in a test. */
export interface AttestCheckDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** Where the pass line goes. */
  readonly stdout?: (line: string) => void;
  /** Where differences go, one per call. */
  readonly stderr?: (line: string) => void;
  /** The clock freshness is judged against. */
  readonly clock?: () => Date;
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Loads the requirements catalogue. */
  readonly loadCatalogue?: () => CriterionCatalogue;
}

/** A committed file read as JSON, or the one line that says why not. */
type JsonRead =
  | { readonly problem: null; readonly value: unknown; readonly text: string }
  | { readonly problem: string };

/**
 * Read one committed file as JSON.
 * @param root - Real path of the repository
 * @param file - The file, from the repository root
 * @param what - What the file is, for the line that says it is missing
 * @returns The parsed file, or the one-line reason there is none
 */
async function readJson(
  root: string,
  file: string,
  what: string
): Promise<JsonRead> {
  const read = await readControlFile(root, file);
  if (read.kind === "blocked") return { problem: read.problem };
  if (read.kind === "missing") {
    return { problem: `No ${what} was found at ${file}.` };
  }
  try {
    return {
      problem: null,
      value: JSON.parse(read.text) as unknown,
      text: read.text,
    };
  } catch {
    return { problem: `${file} is not valid JSON, so it is not a ${what}.` };
  }
}

/**
 * Compare the committed register with the generated one.
 * @param root - Real path of the repository
 * @param register - The register the declaration and the evidence produce
 * @returns One line per difference
 */
async function registerDifferences(
  root: string,
  register: ControlRegister
): Promise<readonly string[]> {
  const read = await readJson(root, CONTROL_REGISTER_PATH, "control register");
  return read.problem === null
    ? controlRegisterDrift(read.text, register)
    : [read.problem];
}

/**
 * Read the committed evidence file as exactly what the attest step writes.
 * @param root - Real path of the repository
 * @returns The file, or one line per reason it cannot be used
 */
async function committedEvidence(
  root: string
): Promise<
  | { readonly problems: null; readonly evidence: EvidenceDocument }
  | { readonly problems: readonly string[] }
> {
  const read = await readJson(root, EVIDENCE_PATH, "evidence file");
  if (read.problem !== null) return { problems: [read.problem] };
  const parsed = parseEvidenceDocument(read.value);
  return parsed.problems === null
    ? { problems: null, evidence: parsed.document }
    : {
        problems: parsed.problems.map(
          problem => `${EVIDENCE_PATH}: ${problem}`
        ),
      };
}

/** What comparing the three files found. */
interface Comparison {
  /** One line per difference. */
  readonly differences: readonly string[];
  /** The verdict the files give now, when it could be computed. */
  readonly verdict: Verdict | null;
}

/**
 * Compare the three committed files with what produces each.
 * @param root - Real path of the repository
 * @param register - The register the declaration and the evidence produce
 * @param now - The current time
 * @param catalogue - The requirements catalogue
 * @returns Every difference, and the verdict the files give now
 */
async function compare(
  root: string,
  register: ControlRegister,
  now: Date,
  catalogue: CriterionCatalogue
): Promise<Comparison> {
  const registerLines = await registerDifferences(root, register);
  const evidence = await committedEvidence(root);
  const committed = await readJson(root, VERDICT_PATH, "verdict");
  const verdict =
    evidence.problems === null
      ? computeVerdict({
          catalogue,
          register,
          evidence: evidence.evidence,
          now,
        })
      : null;
  return {
    differences: [
      ...registerLines,
      ...(evidence.problems ?? []),
      ...(committed.problem === null
        ? verdict === null
          ? []
          : verdictDrift(committed.value, verdict)
        : [committed.problem]),
    ],
    verdict,
  };
}

/**
 * Check the committed verdict of one repository.
 * @param targetPath - The repository; the working directory when left out
 * @param dependencies - Replaceable collaborators
 * @returns The exit code; see {@link ATTEST_CHECK_EXIT}
 */
export async function runAttestCheck(
  targetPath: string | undefined,
  dependencies: AttestCheckDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (
    problems: readonly string[],
    summary: string,
    code: number
  ): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(`${ATTEST_CHECK_NAME}: FAIL. ${summary}`);
    return code;
  };
  const named = path.resolve(
    dependencies.cwd ?? process.cwd(),
    targetPath ?? "."
  );
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail(
      [`${targetPath ?? named} is not a folder.`],
      "Give the path of the repository whose verdict to check",
      ATTEST_CHECK_EXIT.NOT_CHECKED
    );
  }
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) {
    return fail(
      generated.problems,
      `The gates declaration in ${GATES_DECLARATION_PATH} was refused, so the verdict could not be computed again. Fix the declaration, then run this again`,
      ATTEST_CHECK_EXIT.NOT_CHECKED
    );
  }
  // The catalogue is loaded inside the call, so a copy of Lisa that cannot
  // load it is reported like any other failure to compare.
  const compared = await Promise.resolve()
    .then(() =>
      compare(
        root,
        generated.register,
        (dependencies.clock ?? (() => new Date()))(),
        (dependencies.loadCatalogue ?? loadCriterionCatalogue)()
      )
    )
    .catch((error: unknown) => ({
      failure: error instanceof Error ? error.message : String(error),
    }));
  if ("failure" in compared) {
    return fail(
      [compared.failure],
      "The check could not finish, so nothing was compared",
      ATTEST_CHECK_EXIT.NOT_CHECKED
    );
  }
  const { differences, verdict } = compared;
  if (differences.length > 0 || verdict === null) {
    return fail(
      differences,
      `${differences.length} ${differences.length === 1 ? "difference" : "differences"} between ${VERDICT_PATH} and what ${CONTROL_REGISTER_PATH} and ${EVIDENCE_PATH} give now. ${HOW_TO_FIX}`,
      ATTEST_CHECK_EXIT.DIFFERS
    );
  }
  stdout(
    `${ATTEST_CHECK_NAME}: PASS. ${VERDICT_PATH} is what ${CONTROL_REGISTER_PATH} and ${EVIDENCE_PATH} give. ${levelSummary(verdict)}`
  );
  return ATTEST_CHECK_EXIT.MATCHES;
}
