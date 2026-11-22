#!/usr/bin/env node
/**
 * Render the operator questionnaire from the criterion catalogue
 * (CodySwannGT/lisa#4977).
 *
 * `docs/agentic-readiness-questionnaire.md` is the list of questions an
 * operator answers to learn whether agents can work unattended. It used to be
 * written by hand, apart from the specification, and the two drifted: the
 * document asked 122 questions while the specification stated 77 requirements
 * at Level 1. A question nobody maps to a requirement cannot be answered by an
 * audit, and a requirement with no question is never put to the operator.
 *
 * The catalogue (`spec/tasc-criteria.json`) now holds the one question each
 * requirement asks, in plain language. This script prints them, so the document
 * is output and cannot disagree with its source:
 *
 * - one numbered question per in-scope criterion, in the catalogue's order;
 * - grouped under the specification's own section titles, read from the
 *   specification on every run rather than copied here, with the criterion
 *   prefix removed so an operator is shown no id;
 * - a banner saying the file is generated and how to regenerate it.
 *
 * It reads the `question` of each entry and nothing else, so other tools can
 * add their own fields to the catalogue without moving this document.
 *
 * CLI:
 *   node scripts/generate-readiness-questionnaire.mjs [--check] [--root <dir>]
 *
 * With no flag it writes the document. `--check` writes nothing and compares.
 * `--root` reads and writes under another directory instead of this repository.
 *
 * Exit codes:
 *   0 — the document was written, or `--check` found it current.
 *   1 — `--check` found the document missing or different from its source.
 *   2 — the document could not be generated: an argument is wrong, the
 *       catalogue or the specification is unreadable, or the catalogue holds
 *       something this script will not guess a rendering for.
 *
 * @module scripts/generate-readiness-questionnaire
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** The criterion catalogue the questions are read from. */
export const CATALOGUE_PATH = "spec/tasc-criteria.json";

/** The generated document. */
export const QUESTIONNAIRE_PATH = "docs/agentic-readiness-questionnaire.md";

/** The command that regenerates the document, as an operator is told it. */
export const GENERATOR_COMMAND = "bun run build:readiness-questionnaire";

/** The repository this script lives in, used when `--root` is not given. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The introduction, kept word for word from the hand-written document.
 *
 * It lives here because the whole file is generated: an introduction read back
 * from the document would be a region a hand edit could change unnoticed.
 */
const INTRODUCTION = [
  "# Agentic Readiness Questionnaire",
  "",
  "This is intended for operators, teams, and stakeholders",
  "who want to understand what an autonomous software factory needs without reading",
  "the formal control specification first.",
].join("\n");

/** A criterion id: its family is the first group, or the second. */
const CRITERION_ID = /^(AC[1-9]\d*)\.[1-9]\d*$|^(SI|DP|UX)[1-9]\d*$/u;

/** A section heading of the specification: a family prefix, a dash, a title. */
const SECTION_HEADING = /^### (AC[1-9]\d*|SI|DP|UX) — (.+)$/u;

/** Where a section heading's trailing note starts, as in `*(mirrors CC1)*`. */
const HEADING_NOTE = " *(";

/**
 * The family a criterion belongs to: `AC1` for `AC1.1`, `SI` for `SI10`.
 * @param {string} id - Criterion id, as the specification writes it
 * @returns {string} The family prefix
 * @throws {Error} When the text is not a criterion id
 */
export function familyOf(id) {
  const match = CRITERION_ID.exec(id);
  const family = match?.[1] ?? match?.[2];
  if (family === undefined) {
    throw new Error(`"${id}" in ${CATALOGUE_PATH} is not a criterion id.`);
  }
  return family;
}

/**
 * The family and title one line of the specification names, if it is a
 * section heading.
 * @param {string} line - One line of the specification
 * @returns {[string, string][]} One pair for a section heading, otherwise none
 */
function sectionTitle(line) {
  const match = SECTION_HEADING.exec(line);
  if (match === null) return [];
  const [, family, rest] = match;
  const note = rest.indexOf(HEADING_NOTE);
  return [[family, (note === -1 ? rest : rest.slice(0, note)).trim()]];
}

/**
 * Every family's section title, as the specification states it.
 *
 * `### AC1 — Governance and Accountability *(mirrors CC1, …)*` yields
 * `AC1` → `Governance and Accountability`.
 * @param {string} specification - The specification's Markdown
 * @returns {Map<string, string>} Family prefix to title, in the specification's order
 */
export function familyTitles(specification) {
  return new Map(specification.split("\n").flatMap(sectionTitle));
}

/**
 * The question an in-scope criterion asks.
 * @param {{id: string, question?: unknown}} criterion - An in-scope catalogue entry
 * @returns {string} The question
 * @throws {Error} When the entry has no question to print
 */
function questionOf(criterion) {
  const { question } = criterion;
  if (typeof question !== "string" || question.trim() === "") {
    throw new Error(
      `${criterion.id} is in scope but has no question in ${CATALOGUE_PATH}.`
    );
  }
  return question.trim();
}

/**
 * The banner that opens the document.
 *
 * It is sentences, with no indented `Label: value` line, on purpose. The merge
 * driver for generated artifacts reads such a line as an entry it can merge,
 * and this document is declared out of that driver's reach
 * (`scripts/check-generated-artifact-merge-coverage.mjs`). A `Source: …` line
 * here made that declaration false, and the coverage check refused it.
 * @param {string} specificationPath - Repository-relative path of the specification
 * @returns {string} An HTML comment, invisible when the Markdown is rendered
 */
function banner(specificationPath) {
  return [
    "<!--",
    "  GENERATED FILE. Do not edit it by hand: the next regeneration overwrites it.",
    `  It is rendered from the \`question\` of every in-scope criterion in`,
    `  ${CATALOGUE_PATH}, under the section titles of`,
    `  ${specificationPath}.`,
    "  To change a question, edit the catalogue, then run:",
    `    ${GENERATOR_COMMAND}`,
    "-->",
  ].join("\n");
}

/**
 * Render the questionnaire.
 *
 * Families appear in the order the catalogue first names them, and a family
 * with no in-scope criterion gets no heading. The numbering runs on across
 * sections, so a question can be referred to by its number alone.
 * @param {{specification: string, criteria: readonly {id: string, in_scope: boolean, question?: unknown}[]}} catalogue - The parsed criterion catalogue
 * @param {string} specification - The Markdown of the specification the catalogue names
 * @returns {string} The document, newline-terminated
 * @throws {Error} When a family has no section title, or an in-scope criterion no question
 */
export function renderQuestionnaire(catalogue, specification) {
  const titles = familyTitles(specification);
  const asked = catalogue.criteria
    .filter(criterion => criterion.in_scope === true)
    .map(criterion => ({
      family: familyOf(criterion.id),
      question: questionOf(criterion),
    }));
  const families = [...new Set(asked.map(entry => entry.family))];
  const numbered = families
    .flatMap(family => asked.filter(entry => entry.family === family))
    .map((entry, index) => ({
      family: entry.family,
      line: `${String(index + 1)}. ${entry.question}`,
    }));

  const sections = families.map(family => {
    const title = titles.get(family);
    if (title === undefined) {
      throw new Error(
        `${family} has no section title in ${catalogue.specification}: no "### ${family} — <title>" heading was found, so its questions have no heading an operator could read.`
      );
    }
    const lines = numbered
      .filter(entry => entry.family === family)
      .map(entry => entry.line);
    return [`## ${title}`, "", ...lines].join("\n");
  });

  return `${[banner(catalogue.specification), INTRODUCTION, ...sections].join("\n\n")}\n`;
}

/**
 * Render the questionnaire from the files under a directory.
 * @param {string} root - Repository root to read from
 * @returns {string} The document the catalogue and specification there produce
 * @throws {Error} When either file is unreadable, or the catalogue cannot be rendered
 */
function generateQuestionnaire(root) {
  const catalogue = JSON.parse(
    readFileSync(path.join(root, CATALOGUE_PATH), "utf8")
  );
  if (typeof catalogue.specification !== "string") {
    throw new TypeError(`${CATALOGUE_PATH} does not name its specification.`);
  }
  if (!Array.isArray(catalogue.criteria)) {
    throw new TypeError(`${CATALOGUE_PATH} has no list of criteria.`);
  }
  const specification = readFileSync(
    path.join(root, catalogue.specification),
    "utf8"
  );
  return renderQuestionnaire(catalogue, specification);
}

/**
 * Generate the questionnaire and write it.
 * @param {string} [root] - Repository root to read from and write to
 * @returns {string} The document that was written
 * @throws {Error} When the document cannot be generated or written
 */
export function writeQuestionnaire(root = REPO_ROOT) {
  const rendered = generateQuestionnaire(root);
  writeFileSync(path.join(root, QUESTIONNAIRE_PATH), rendered);
  return rendered;
}

/**
 * The document as it is on disk.
 * @param {string} root - Repository root
 * @returns {string | undefined} Its contents, or undefined when it does not exist
 * @throws {Error} When the file exists and cannot be read
 */
function existingQuestionnaire(root) {
  try {
    return readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * The lines of a document, without the empty one its final newline leaves.
 * @param {string} text - A document
 * @returns {string[]} Its lines
 */
function linesOf(text) {
  return text.replace(/\n$/u, "").split("\n");
}

/**
 * One line as a person is shown it, so an absent or empty line is not a gap.
 * @param {string | undefined} line - The line, or undefined past the last one
 * @param {string} ending - What to say when there is no such line
 * @returns {string} The line, or words standing in for it
 */
function shown(line, ending) {
  if (line === undefined) return ending;
  return line === "" ? "(a blank line)" : line;
}

/**
 * Say where a document on disk first departs from the generated one.
 * @param {string} existing - The document on disk
 * @param {string} rendered - The document its sources produce
 * @returns {string[]} Lines naming the first line that differs
 */
function firstDifference(existing, rendered) {
  const found = linesOf(existing);
  const expected = linesOf(rendered);
  const index = expected.findIndex((line, at) => line !== found[at]);
  const at = index === -1 ? expected.length : index;
  if (found[at] === undefined && expected[at] === undefined) {
    return ["  The only difference is the line ending at the end of the file."];
  }
  return [
    `  First difference, at line ${String(at + 1)}:`,
    `    in the file:  ${shown(found[at], "(nothing: the file ends here)")}`,
    `    generated:    ${shown(expected[at], "(nothing: the document ends here)")}`,
  ];
}

/**
 * Explain a questionnaire that does not match its source, and how to fix it.
 * @param {string | undefined} existing - The document on disk, if there is one
 * @param {string} rendered - The document its sources produce
 * @returns {string} A message for the person whose commit was refused
 */
function describeStale(existing, rendered) {
  const finding =
    existing === undefined
      ? [`${QUESTIONNAIRE_PATH} is missing.`]
      : [
          `${QUESTIONNAIRE_PATH} is stale.`,
          "",
          `  It no longer matches the questions in ${CATALOGUE_PATH}.`,
          ...firstDifference(existing, rendered),
        ];
  return [
    ...finding,
    "",
    "  This file is generated and is never edited by hand. To change a",
    `  question, edit its \`question\` in ${CATALOGUE_PATH}.`,
    "",
    `  Regenerate it: ${GENERATOR_COMMAND}`,
  ].join("\n");
}

/**
 * Compare the document on disk with what its sources produce. Writes nothing.
 * @param {string} [root] - Repository root to read from
 * @returns {{current: boolean, message: string}} Whether the document is
 *   current, and what to tell the operator when it is not
 * @throws {Error} When the document cannot be generated
 */
export function inspectQuestionnaire(root = REPO_ROOT) {
  const rendered = generateQuestionnaire(root);
  const existing = existingQuestionnaire(root);
  return existing === rendered
    ? { current: true, message: "" }
    : { current: false, message: describeStale(existing, rendered) };
}

/**
 * Read the command line.
 *
 * An argument this script does not know is refused rather than ignored: a
 * mistyped `--check` would otherwise fall through to writing the file and
 * exit 0, which reads as a check that passed.
 * @param {readonly string[]} argv - Arguments after the script name
 * @returns {{check: boolean, root: string} | {refusal: string}} What was asked
 *   for, or why it cannot be done
 */
function parseArguments(argv) {
  const flag = argv.indexOf("--root");
  const directory = flag === -1 ? undefined : argv[flag + 1];
  if (flag !== -1 && (directory === undefined || directory.startsWith("-"))) {
    return { refusal: "--root requires a directory after it." };
  }
  const unknown = argv.filter(
    (argument, index) =>
      argument !== "--check" &&
      argument !== "--root" &&
      !(flag !== -1 && index === flag + 1)
  );
  if (unknown.length > 0) {
    return { refusal: `Unknown argument: ${unknown.join(" ")}.` };
  }
  return {
    check: argv.includes("--check"),
    root: directory === undefined ? REPO_ROOT : path.resolve(directory),
  };
}

/**
 * CLI entry point.
 * @param {readonly string[]} argv - Arguments after the script name
 * @returns {number} Process exit code
 */
function main(argv) {
  const request = parseArguments(argv);
  if ("refusal" in request) {
    process.stderr.write(
      `${request.refusal}\nUsage: node scripts/generate-readiness-questionnaire.mjs [--check] [--root <dir>]\nNothing was generated or checked.\n`
    );
    return 2;
  }
  try {
    if (!request.check) {
      const rendered = writeQuestionnaire(request.root);
      const questions = rendered.match(/^\d+\. /gmu)?.length ?? 0;
      process.stdout.write(
        `Wrote ${QUESTIONNAIRE_PATH}: ${String(questions)} questions from ${CATALOGUE_PATH}.\n`
      );
      return 0;
    }
    const verdict = inspectQuestionnaire(request.root);
    if (verdict.current) {
      process.stdout.write(
        `${QUESTIONNAIRE_PATH} matches ${CATALOGUE_PATH}.\n`
      );
      return 0;
    }
    process.stderr.write(`${verdict.message}\n`);
    return 1;
  } catch (error) {
    process.stderr.write(
      `${QUESTIONNAIRE_PATH} could not be generated, so nothing was ${request.check ? "checked" : "written"}.\n  ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 2;
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
