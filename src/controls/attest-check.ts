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
 * Then it asks whether what was proved is still what is here. The evidence
 * file holds a digest of what defined the checks when the proofs ran, and
 * the list of what that digest covers. The same digest is taken from the
 * repository as it is, and a difference fails the check and names what
 * differs. See `./checks-binding.ts`.
 *
 * ## It reads content, never history
 *
 * Git is not started. So the answer is the same in a shallow clone, in a
 * clone made after a squash or rebase merge replaced the commit the proofs
 * ran on, and in a checkout another user owns. The evidence records still
 * name the commit the run's copy was cloned from; that commit is printed
 * for the reader, and nothing is decided by it.
 *
 * ## Evidence from before the binding
 *
 * An evidence file with no digest was written before evidence was bound to
 * what defines the checks. Nothing in it says which checks its records are
 * about, so the check does not call it current: it says the evidence
 * predates the binding and exits non-zero.
 *
 * ## What this can and cannot show
 *
 * It shows that the three files agree with each other and with the gates
 * declaration, now, and that what defines the checks is what the proofs ran
 * against. It does not see a change to the checked tool's own
 * configuration, such as a rule switched off in a linter's settings: there
 * is no list of such files, so none is in the digest. Running the proofs
 * again sees it. And it cannot show that the evidence records are what a
 * run really produced: someone who rewrites the evidence, the register and
 * the verdict together, consistently, leaves three files that agree.
 * Nothing checked on the same machine with no secret can tell that apart
 * from a real run. What can: running `lisa controls attest` again and
 * comparing, the history of the three files in version control, or a
 * signature made somewhere the author of the change cannot reach.
 * @module controls/attest-check
 */
import path from "node:path";

import { resolveRepositoryRoot } from "./audit-report-file.js";
import { compareCodeUnits } from "./canonical-json.js";
import {
  loadCriterionCatalogue,
  type CriterionCatalogue,
} from "./catalogue.js";
import { bindChecks, bindingDifferenceLines } from "./checks-binding.js";
import { readControlFile } from "./control-files.js";
import { EVIDENCE_PATH } from "./evidence.js";
import {
  EVIDENCE_PREDATES_BINDING,
  evidencePredatesBinding,
} from "./evidence-binding.js";
import { parseEvidenceDocument } from "./evidence-document.js";
import type { ChecksBinding, EvidenceDocument } from "./evidence-types.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { shortCommit } from "./proof-copy-wording.js";
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
  /**
   * The committed verdict is what the register and the evidence give, and
   * what defines the checks is what the proofs ran against.
   */
  MATCHES: 0,
  /**
   * Something differs; each difference was named. That includes evidence
   * written before it was bound to what defines the checks.
   */
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
  /**
   * Takes the digest of what defines the checks in the repository as it
   * is, over the paths an evidence file's own digest covers and any the
   * repository has gained.
   */
  readonly bindChecks?: (
    root: string,
    recorded: ChecksBinding
  ) => Promise<ChecksBinding>;
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
  // Said once, and not once more for every record that lacks a digest.
  if (evidencePredatesBinding(read.value)) {
    return { problems: [EVIDENCE_PREDATES_BINDING] };
  }
  const parsed = parseEvidenceDocument(read.value);
  return parsed.problems === null
    ? { problems: null, evidence: parsed.document }
    : {
        problems: parsed.problems.map(
          problem => `${EVIDENCE_PATH}: ${problem}`
        ),
      };
}

/**
 * Take the digest of what defines the checks in a repository as it is.
 * @param root - Real path of the repository
 * @param recorded - What the evidence file's digest covers
 * @returns The digest of the same paths now, and of any the repository has
 *   gained
 */
function boundNow(
  root: string,
  recorded: ChecksBinding
): Promise<ChecksBinding> {
  // No hook file is looked for: that needs git, and this check starts none.
  // The ones the run recorded are read again with everything else it covers.
  return bindChecks({
    repository: root,
    also: recorded.covered.map(file => file.path),
  });
}

/**
 * Say where the checks stand when nothing differs.
 * @param evidence - The committed evidence file
 * @returns One sentence about what was compared, and one that names the
 *   commit the proofs' copy was cloned from when the records name one
 */
function standingOf(evidence: EvidenceDocument): string {
  const count = evidence.checks.covered.length;
  const compared = `What defines the checks is what the proofs ran against (${String(count)} ${count === 1 ? "file" : "files"} compared by content).`;
  const commits = [
    ...new Set(
      evidence.records.flatMap(record =>
        record.commit === null ? [] : [shortCommit(record.commit)]
      )
    ),
  ].sort(compareCodeUnits);
  return commits.length === 0
    ? compared
    : `${compared} The proofs ran in a copy cloned from commit ${commits.join(", ")}; that is for your information, and nothing was compared with it.`;
}

/** What comparing the three files found. */
interface Comparison {
  /** One line per difference. */
  readonly differences: readonly string[];
  /** The verdict the files give now, when it could be computed. */
  readonly verdict: Verdict | null;
  /** Where the checks stand, when nothing differs. */
  readonly standing: string;
}

/** What comparing needs beside the repository. */
interface CompareInputs {
  /** The register the declaration and the evidence produce. */
  readonly register: ControlRegister;
  /** The current time. */
  readonly now: Date;
  /** The requirements catalogue. */
  readonly catalogue: CriterionCatalogue;
  /** Takes the digest of what defines the checks now. */
  readonly bind: NonNullable<AttestCheckDependencies["bindChecks"]>;
}

/**
 * Compare the three committed files with what produces each, and what
 * defines the checks with what the proofs ran against.
 * @param root - Real path of the repository
 * @param inputs - The register, the time, the catalogue and the binder
 * @returns Every difference, and the verdict the files give now
 */
async function compare(
  root: string,
  inputs: CompareInputs
): Promise<Comparison> {
  const { register, now, catalogue, bind } = inputs;
  const registerLines = await registerDifferences(root, register);
  const evidence = await committedEvidence(root);
  const committed = await readJson(root, VERDICT_PATH, "verdict");
  if (evidence.problems !== null) {
    return {
      differences: [
        ...registerLines,
        ...evidence.problems,
        ...(committed.problem === null ? [] : [committed.problem]),
      ],
      verdict: null,
      standing: "",
    };
  }
  const verdict = computeVerdict({
    catalogue,
    register,
    evidence: evidence.evidence,
    now,
  });
  // Is what was proved still what is here? Asked of content.
  const { checks } = evidence.evidence;
  const bound = bindingDifferenceLines(checks, await bind(root, checks));
  return {
    differences: [
      ...registerLines,
      ...(committed.problem === null
        ? verdictDrift(committed.value, verdict)
        : [committed.problem]),
      ...bound,
    ],
    verdict,
    standing: standingOf(evidence.evidence),
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
      compare(root, {
        register: generated.register,
        now: (dependencies.clock ?? (() => new Date()))(),
        catalogue: (dependencies.loadCatalogue ?? loadCriterionCatalogue)(),
        bind: dependencies.bindChecks ?? boundNow,
      })
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
  const { differences, verdict, standing } = compared;
  if (differences.length > 0 || verdict === null) {
    return fail(
      differences,
      `${differences.length} ${differences.length === 1 ? "difference" : "differences"} between ${VERDICT_PATH} and what ${CONTROL_REGISTER_PATH}, ${EVIDENCE_PATH} and this repository give now. ${HOW_TO_FIX}`,
      ATTEST_CHECK_EXIT.DIFFERS
    );
  }
  stdout(
    `${ATTEST_CHECK_NAME}: PASS. ${VERDICT_PATH} is what ${CONTROL_REGISTER_PATH} and ${EVIDENCE_PATH} give. ${levelSummary(verdict)} ${standing}`
  );
  return ATTEST_CHECK_EXIT.MATCHES;
}
