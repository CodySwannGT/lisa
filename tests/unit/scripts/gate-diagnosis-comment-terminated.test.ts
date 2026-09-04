/**
 * A doc comment that ends early, and the failure that gets blamed on it.
 *
 * ## The defect is ATTRIBUTION, not detection
 *
 * A path example containing the block terminator closes the comment it sits
 * in. Everything below is then parsed as source: path segments become
 * identifiers and the separator between them becomes division. This is loud —
 * `bun run typecheck` fails, `bun run lint` fails, the test run fails with a
 * parse error naming the file and a line. Nothing is silent, so a detector
 * would only duplicate the compiler.
 *
 * What is wrong is where it points. Measured on the real reproduction, with
 * the true cause on line 88:
 *
 * ```text
 * src/configs/repo-scan.ts(90,9):  error TS1005: ';' expected.
 * src/configs/repo-scan.ts(90,20): error TS1443: Module declaration names may only use ' or " quoted strings.
 * src/configs/repo-scan.ts(95,1):  error TS1160: Unterminated template literal.
 * ```
 *
 * None of those name a comment, a terminator, or line 88, and the reported
 * lines are all BELOW the cause — so the natural search direction, read the
 * error line then look a little above it, walks away from the answer.
 *
 * ## Why these cases assert on the MESSAGE
 *
 * A change that makes the build fail satisfies nothing; it already fails. The
 * load-bearing assertion is that the verdict names the comment and the line it
 * ended on. The negative control matters just as much: every file has ordinary
 * block comments, so a check that fires on those is worse than the defect.
 * @module tests/unit/scripts/gate-diagnosis-comment-terminated
 */

import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS,
  diagnoseFailure,
  terminatedDocComments,
} from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

/** One broken block, typed at the same boundary. */
type Broken = {
  endsAt: number;
  line: string;
  opensAt: number;
  realEndsAt: number;
};

/**
 * The block terminator, assembled rather than written.
 *
 * Spelled out because a literal here would end the very comment describing it
 * — which is the whole subject of this suite, and would be an entertaining way
 * to break the file that proves it.
 */
const TERM = `${"*"}${"/"}`;

/** A JSDoc opener, assembled for the same reason. */
const OPEN = `${"/"}${"**"}`;

const FILE = "src/configs/repo-scan.ts";

/**
 * The real reproduction: a Stryker sandbox glob inside a path example.
 * @returns The file's text, with the broken block starting on line 3.
 */
function brokenSource(): string {
  return [
    "export const FIRST = 1;",
    "",
    OPEN,
    " * Debris lands at",
    ` * \`.stryker-tmp/bite-guard-intact/sandbox-${TERM}rails/copy-overwrite/scripts/foo.sh\``,
    " * and `tempDirName` decides the root under `typescript/` and `src/`.",
    " * More prose that is still inside what the author thinks is a comment.",
    ` ${TERM}`,
    "export const EXAMPLE = 1;",
  ].join("\n");
}

/**
 * The same file with the example written the way the convention says.
 * @returns The file's text, with no block that ends early.
 */
function healthySource(): string {
  return [
    "export const FIRST = 1;",
    "",
    OPEN,
    " * Debris lands at",
    " * `.stryker-tmp/bite-guard-intact/sandbox-<id>/rails/copy-overwrite/scripts/foo.sh`",
    " * and `tempDirName` decides the root under `typescript/` and `src/`.",
    ` ${TERM}`,
    "export const EXAMPLE = 1;",
  ].join("\n");
}

/** What `tsc` actually printed for the real instance. */
const TSC_OUTPUT = [
  `${FILE}(90,9): error TS1005: ';' expected.`,
  `${FILE}(90,20): error TS1443: Module declaration names may only use ' or " quoted strings.`,
  `${FILE}(95,1): error TS1160: Unterminated template literal.`,
].join("\n");

/**
 * Diagnose a transcript against staged file contents.
 * @param output - What the failing command printed.
 * @param files - Path to source text, for every file that can be read.
 * @returns The verdict.
 */
function diagnose(
  output: string,
  files: Record<string, string> = {}
): Diagnosis {
  return diagnoseFailure(output, 1, null, (path: string) =>
    // `hasOwnProperty.call` rather than `Object.hasOwn`, which is ES2022. The
    // call site is what moves; raising the shipped `lib` target so one line
    // compiles would change the compilation target for every consumer.
    Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null
  ) as Diagnosis;
}

describe("terminatedDocComments: what counts as a block that ends early", () => {
  it("finds the block a path example closed, and where it really ends", () => {
    const found = terminatedDocComments(brokenSource()) as Broken[];
    expect(found).toHaveLength(1);
    const [broken] = found as [Broken];
    expect(broken.opensAt).toBe(3);
    expect(broken.endsAt).toBe(5);
    expect(broken.realEndsAt).toBe(8);
  });

  it("finds NOTHING in the same file written to the convention", () => {
    // The negative control, and the reason the rule cannot simply ban the
    // terminator inside a comment: the terminator is legitimate, and every
    // file in this repository has one on nearly every declaration.
    expect(terminatedDocComments(healthySource())).toEqual([]);
  });

  it("leaves an ordinary multi-line block alone", () => {
    const source = [OPEN, " * Does a thing.", ` ${TERM}`, "const x = 1;"].join(
      "\n"
    );
    expect(terminatedDocComments(source)).toEqual([]);
  });

  it("leaves a one-line block alone", () => {
    expect(
      terminatedDocComments(`${OPEN} Does a thing. ${TERM}\nconst x = 1;`)
    ).toEqual([]);
  });

  it("leaves a block followed by code ON THE SAME LINE alone", () => {
    // Deliberate and legal. What separates it from the defect is that the next
    // line is code rather than more prose, so the block does not continue.
    expect(
      terminatedDocComments(`${OPEN} @internal ${TERM} export const x = 1;`)
    ).toEqual([]);
  });

  it("does not treat an unterminated block as one that ended early", () => {
    expect(terminatedDocComments(`${OPEN}\n * prose with no end`)).toEqual([]);
  });

  it("finds a second broken block after the first", () => {
    const found = terminatedDocComments(
      `${brokenSource()}\n${brokenSource()}`
    ) as Broken[];
    expect(found).toHaveLength(2);
  });

  it("reads empty and absent sources as nothing to say", () => {
    expect(terminatedDocComments("")).toEqual([]);
    expect(terminatedDocComments(undefined as never)).toEqual([]);
  });
});

describe("diagnoseFailure: a transcript whose real cause is a closed comment", () => {
  it("names the comment and the line it ended on", () => {
    // The load-bearing assertion. `tsc` reported lines 90 and 95 and named no
    // comment; the verdict has to say line 5 and the word comment, or a reader
    // is still 25 lines away from the cause.
    const verdict = diagnose(TSC_OUTPUT, { [FILE]: brokenSource() });

    expect(verdict.kind).toBe(DIAGNOSIS.COMMENT_TERMINATED);
    expect(verdict.summary).toContain("doc comment");
    expect(verdict.summary).toContain(FILE);
    expect(verdict.summary).toContain("line 5");
    expect(verdict.evidence.join("\n")).toContain(`${FILE}:5`);
  });

  it("says the errors below it are downstream, so they are not chased", () => {
    const verdict = diagnose(TSC_OUTPUT, { [FILE]: brokenSource() });
    expect(verdict.summary).toContain("downstream");
  });

  it("quotes the offending line and the remedy", () => {
    const verdict = diagnose(TSC_OUTPUT, { [FILE]: brokenSource() });
    const evidence = verdict.evidence.join("\n");
    expect(evidence).toContain("stryker-tmp");
    expect(evidence).toContain("sandbox-<id>/");
  });

  it("names the line the block was MEANT to end on", () => {
    const verdict = diagnose(TSC_OUTPUT, { [FILE]: brokenSource() });
    expect(verdict.evidence.join("\n")).toContain("line 8");
  });

  it("says nothing when the same transcript's file is written correctly", () => {
    // Same errors, healthy file. The transcript alone must never be enough:
    // the verdict is grounded in what the file actually contains.
    expect(diagnose(TSC_OUTPUT, { [FILE]: healthySource() }).kind).not.toBe(
      DIAGNOSIS.COMMENT_TERMINATED
    );
  });

  it("says nothing when no file the transcript names can be read", () => {
    expect(diagnose(TSC_OUTPUT).kind).not.toBe(DIAGNOSIS.COMMENT_TERMINATED);
  });

  it("outranks the test signatures in the same transcript", () => {
    // Precedence, and the reason it exists: a file that does not compile
    // produces failing suites too, and reporting those describes the effect.
    const withFailures = [
      TSC_OUTPUT,
      " FAIL  tests/unit/a.test.ts > does a thing",
      "Tests  3 failed | 900 passed (903)",
    ].join("\n");

    expect(diagnose(withFailures, { [FILE]: brokenSource() }).kind).toBe(
      DIAGNOSIS.COMMENT_TERMINATED
    );
  });

  it("does NOT outrank a killed run", () => {
    // The opposite direction: a kill is a fact about the machine, and a
    // transcript truncated by one may name files incidentally.
    const killed = diagnoseFailure(TSC_OUTPUT, 143, null, () =>
      brokenSource()
    ) as Diagnosis;
    expect(killed.kind).toBe(DIAGNOSIS.KILLED);
  });

  it("attributes the failure to no single gate", () => {
    // Honest rather than tidy: a closed comment breaks type-correctness,
    // code-style and test-correctness at once, so it is not one gate's
    // property. The runner treats an unattributed failure as NOT PROVED, which
    // still blocks — it just stops naming a cause it does not have.
    expect(diagnose(TSC_OUTPUT, { [FILE]: brokenSource() }).proves).toBeNull();
  });
});
