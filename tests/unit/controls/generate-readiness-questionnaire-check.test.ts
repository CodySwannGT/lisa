/**
 * A hand-edited operator questionnaire is refused (CodySwannGT/lisa#4977).
 *
 * The questionnaire is generated from the criterion catalogue, which
 * `generate-readiness-questionnaire.test.ts` holds. This suite pins the other
 * half: an edit made to the document by hand is refused by the
 * derived-artifact check, which names the command that regenerates it.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/controls/generate-readiness-questionnaire-check
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  requiresReadinessQuestionnaireCheck,
  staleArtifacts,
} from "../../../scripts/check-derived-artifacts.mjs";
import {
  inspectQuestionnaire,
  writeQuestionnaire,
} from "../../../scripts/generate-readiness-questionnaire.mjs";
import {
  CATALOGUE_PATH,
  SPECIFICATION_PATH,
} from "../../helpers/criterion-catalogue.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  committed,
  GENERATOR_COMMAND,
  GENERATOR_SCRIPT,
  inScope,
  numberedQuestions,
  QUESTIONNAIRE_PATH,
  REPO_ROOT,
} from "./support/readiness-questionnaire-helpers.js";

/** Temporary repositories this file built, removed after each case. */
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Build a directory holding only what the generator reads — the catalogue and
 * the specification — and the questionnaire generated from them.
 * @returns The directory, standing in for a repository root
 */
function temporaryRepository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "readiness-questionnaire-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "docs"));
  cpSync(path.join(REPO_ROOT, "spec"), path.join(root, "spec"), {
    recursive: true,
  });
  writeQuestionnaire(root);
  return root;
}

/**
 * Change one question in a generated questionnaire, the way a hand edit would.
 * @param root - Directory built by {@link temporaryRepository}
 */
function editByHand(root: string): void {
  const file = path.join(root, QUESTIONNAIRE_PATH);
  const [first] = numberedQuestions(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      first?.text ?? "",
      "Do your agents sign their own work?"
    )
  );
}

/**
 * Run the generator from the command line.
 * @param args - Arguments after the script name
 * @param script - Repository-relative generator path
 * @returns Its exit code and everything it printed
 */
function runGenerator(
  args: readonly string[],
  script: string = GENERATOR_SCRIPT
): { status: number | null; output: string } {
  const child = boundedSpawnSync({
    label: `${script} ${args.join(" ")}`,
    command: process.execPath,
    args: [script, ...args],
    cwd: REPO_ROOT,
  });
  return {
    status: child.status,
    output: `${child.stdout}${child.stderr}`.trim(),
  };
}

/**
 * Run the generator's `--check` against a directory, as the derived-artifact
 * check runs it against the repository.
 * @param root - Directory to check
 * @param script - Repository-relative generator path
 * @returns Whether the check passed, and what it printed
 */
function runCheckAt(
  root: string,
  script: string
): { ok: boolean; output: string } {
  const { status, output } = runGenerator(["--check", "--root", root], script);
  return { ok: status === 0, output };
}

describe("a hand-edited questionnaire is caught", () => {
  it("passes when the document is what the generator renders", () => {
    const root = temporaryRepository();

    expect(readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8")).toBe(
      committed
    );
    expect(inspectQuestionnaire(root)).toEqual({ current: true, message: "" });
  });

  it("names the document, the line that differs and the generator command", () => {
    const root = temporaryRepository();
    editByHand(root);

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain(`${QUESTIONNAIRE_PATH} is stale.`);
    expect(verdict.message).toContain("Do your agents sign their own work?");
    expect(verdict.message).toContain(CATALOGUE_PATH);
    expect(verdict.message).toContain(GENERATOR_COMMAND);
  });

  it("is caught when a question is added below the last one", () => {
    // Every generated line still matches, so the difference is the first line
    // the generator did not print.
    const root = temporaryRepository();
    const file = path.join(root, QUESTIONNAIRE_PATH);
    writeFileSync(file, `${committed}78. Is the office coffee any good?\n`);

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain("78. Is the office coffee any good?");
    expect(verdict.message).toContain("the document ends here");
  });

  it("says so when only the end of the file differs", () => {
    // An editor that drops the final newline changes no line a person can
    // see, so pointing at a line would send them looking for nothing.
    const root = temporaryRepository();
    writeFileSync(path.join(root, QUESTIONNAIRE_PATH), committed.trimEnd());

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain("line ending at the end of the file");
  });

  it("is caught when the document is missing altogether", () => {
    const root = temporaryRepository();
    rmSync(path.join(root, QUESTIONNAIRE_PATH));

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain(GENERATOR_COMMAND);
  });

  it("is caught when the catalogue changes and the document does not", () => {
    const root = temporaryRepository();
    const file = path.join(root, CATALOGUE_PATH);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        inScope[0]?.question ?? "",
        "Does every agent act under its own account?"
      )
    );

    expect(inspectQuestionnaire(root).current).toBe(false);
  });

  it("exits 1 from the command line and leaves the edit in place", () => {
    const root = temporaryRepository();
    editByHand(root);
    const edited = readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8");

    const result = runGenerator(["--check", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(`${QUESTIONNAIRE_PATH} is stale.`);
    expect(result.output).toContain(GENERATOR_COMMAND);
    expect(readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8")).toBe(
      edited
    );
  });

  it("is repaired by running the generator again", () => {
    const root = temporaryRepository();
    editByHand(root);

    const result = runGenerator(["--root", root]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("77 questions");
    expect(inspectQuestionnaire(root).current).toBe(true);
  });

  it("reports a missing catalogue as an error, not as a stale document", () => {
    const root = temporaryRepository();
    rmSync(path.join(root, CATALOGUE_PATH));

    const result = runGenerator(["--check", "--root", root]);

    expect(result.status).toBe(2);
    expect(result.output).toContain("could not be generated");
    expect(result.output).not.toContain("is stale");
  });

  it("refuses --root with no directory after it", () => {
    expect(runGenerator(["--check", "--root"]).status).toBe(2);
  });

  it("refuses a mistyped flag instead of writing the document", () => {
    // Ignored, `--chekc` would fall through to generation and exit 0, which
    // reads as a check that passed.
    const root = temporaryRepository();
    editByHand(root);
    const edited = readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8");

    const result = runGenerator(["--chekc", "--root", root]);

    expect(result.status).toBe(2);
    expect(result.output).toContain("--chekc");
    expect(readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8")).toBe(
      edited
    );
  });
});

describe("the derived-artifact check owns the questionnaire", () => {
  it("owes the check when the document, its sources or its generator are staged", () => {
    for (const staged of [
      QUESTIONNAIRE_PATH,
      CATALOGUE_PATH,
      SPECIFICATION_PATH,
      GENERATOR_SCRIPT,
    ]) {
      expect(requiresReadinessQuestionnaireCheck([staged])).toBe(true);
    }
  });

  it("owes nothing for an unrelated file or an empty commit", () => {
    expect(
      requiresReadinessQuestionnaireCheck(["README.md", "docs/npm-updater.md"])
    ).toBe(false);
    expect(requiresReadinessQuestionnaireCheck([])).toBe(false);
  });

  it("fails on a hand-edited questionnaire and names the generator command", () => {
    const root = temporaryRepository();
    editByHand(root);
    const ran: string[] = [];

    const failures = staleArtifacts([QUESTIONNAIRE_PATH], script => {
      ran.push(script);
      return runCheckAt(root, script);
    });

    expect(ran).toEqual([GENERATOR_SCRIPT]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("readiness questionnaire is stale.");
    expect(failures[0]).toContain(`${QUESTIONNAIRE_PATH} is stale.`);
    expect(failures[0]).toContain(`Fix: ${GENERATOR_COMMAND}`);
  });

  it("passes a questionnaire nobody edited", () => {
    const root = temporaryRepository();

    expect(
      staleArtifacts([QUESTIONNAIRE_PATH], script => runCheckAt(root, script))
    ).toEqual([]);
  });

  it("passes against this repository, from the command line", () => {
    expect(runGenerator(["--check"]).status).toBe(0);
  });
});
