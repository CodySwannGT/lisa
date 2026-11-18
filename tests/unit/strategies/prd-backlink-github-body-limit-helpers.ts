/**
 * Shared machinery for the prd-backlink GitHub body-limit suite
 * (CodySwannGT/lisa#5004).
 *
 * The suite lifts the fitting program out of each shipped copy of the skill
 * and RUNS it against a PRD rendered to the documented standard form, so it
 * needs a fixture, a renderer, an extractor and a runner. They live here
 * because `max-lines` is a real constraint the cases and their machinery
 * cannot share.
 * @module tests/unit/strategies/prd-backlink-github-body-limit-helpers
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** GitHub's issue body limit, in characters. */
export const BODY_LIMIT = 65_536;

/** Repository the fixture PRD and all but one of its tickets live in. */
export const PRD_REPO = "CodySwannGT/lisa";

/** First line of the managed comment that holds a moved coverage list. */
export const COVERAGE_MARKER = "<!-- lisa:prd-backlink-coverage -->";

/** Where the skill sits beneath one plugin surface. */
const SKILL_PATH = "skills/lisa-prd-backlink/SKILL.md";

/** The canonical copy every other copy is built from. */
export const SOURCE_COPY = `plugins/src/base/${SKILL_PATH}`;

/** One requirement from the PRD's register. */
export interface Requirement {
  readonly id: string;
  readonly heading: string;
  readonly text: string;
}

/** One created ticket. */
export interface Ticket {
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly type: "Epic" | "Story" | "Sub-task";
  readonly parent: Ticket | null;
  readonly reqs: readonly string[];
}

/** A PRD body with the standard-form section in place, and what made it. */
export interface Prd {
  /** The PRD as written, before any `## Tickets` section. */
  readonly source: string;
  /** The full body: PRD, standard-form section, trailing PRD section. */
  readonly standardBody: string;
  readonly requirements: readonly Requirement[];
  readonly tickets: readonly Ticket[];
}

/**
 * Count characters the way the limit is stated: code points, not bytes.
 * @param text Text to measure.
 * @returns Its length in characters.
 */
export const chars = (text: string): number => [...text].length;

/**
 * Every `lisa:gw` token in a body, in document order.
 * @param body Body to scan.
 * @returns The tokens, verbatim.
 */
export const tokensOf = (body: string): readonly string[] =>
  body.match(/<!-- lisa:gw .*?-->/gu) ?? [];

const STORY_COUNT = 8;
const SUBTASK_COUNT = 32;
const REQUIREMENT_COUNT = 60;
const FIRST_NUMBER = 4961;

/**
 * The PRD heading a requirement sits under.
 * @param story Zero-based story index.
 * @returns The heading text, without its `###`.
 */
const storyHeading = (story: number): string =>
  `Story ${story + 1} — As an operator, I can rely on outcome ${story + 1} in every repository`;

/**
 * Requirement text carrying everything a rewrite could damage: backticks,
 * double quotes, an em dash after a quote, a non-ASCII character and a
 * same-repository link that must stay a link because it is quoted text.
 * @param index Zero-based requirement index.
 * @returns The requirement, as the PRD words it.
 */
const requirementText = (index: number): string =>
  `When an operator runs \`step-${index + 1}\`, it shall finish in ≤ ${index + 2} minutes with only its "report path" — and nothing else — changed (see [the specification](https://github.com/${PRD_REPO}/issues/1)).`;

const REQUIREMENTS: readonly Requirement[] = Array.from(
  { length: REQUIREMENT_COUNT },
  (_, index) => ({
    id: `R${index + 1}`,
    heading: storyHeading(index % STORY_COUNT),
    text: requirementText(index),
  })
);

/**
 * The requirement ids a ticket at one position in its tier carries.
 * @param tier How many tickets share the requirements.
 * @param position This ticket's index in the tier.
 * @returns Requirement ids.
 */
const reqsFor = (tier: number, position: number): readonly string[] =>
  REQUIREMENTS.filter((_, index) => index % tier === position).map(
    requirement => requirement.id
  );

const EPIC: Ticket = {
  repo: PRD_REPO,
  number: FIRST_NUMBER,
  title: "Audit, configure, enforce and attest any repository",
  type: "Epic",
  parent: null,
  reqs: REQUIREMENTS.map(requirement => requirement.id),
};

const STORIES: readonly Ticket[] = Array.from(
  { length: STORY_COUNT },
  (_, index) => ({
    repo: PRD_REPO,
    number: FIRST_NUMBER + 1 + index,
    title: `Deliver outcome ${index + 1} for operators on every stack`,
    type: "Story",
    parent: EPIC,
    reqs: reqsFor(STORY_COUNT, index),
  })
);

/** Sub-tasks; the last one lives in another repository. */
const SUBTASKS: readonly Ticket[] = Array.from(
  { length: SUBTASK_COUNT },
  (_, index) => ({
    repo: index === SUBTASK_COUNT - 1 ? "example-org/elsewhere" : PRD_REPO,
    number: FIRST_NUMBER + 1 + STORY_COUNT + index,
    title: `Build and prove part ${index + 1} of the outcome with a regression test`,
    type: "Sub-task",
    parent: STORIES[index % STORY_COUNT] ?? EPIC,
    reqs: reqsFor(SUBTASK_COUNT, index),
  })
);

const TICKETS: readonly Ticket[] = [EPIC, ...STORIES, ...SUBTASKS];

const ref = (ticket: Ticket): string => `${ticket.repo}#${ticket.number}`;

const url = (ticket: Ticket): string =>
  `https://github.com/${ticket.repo}/issues/${ticket.number}`;

/**
 * The visible link the standard form gives a ticket.
 * @param ticket Ticket to link.
 * @returns `[<key>](<url>)`.
 */
export const standardLink = (ticket: Ticket): string =>
  `[${ref(ticket)}](${url(ticket)})`;

/**
 * One entry line, to the skill's documented Format.
 * @param ticket Ticket to render.
 * @returns The line, ending in its machine-readable token.
 */
const entryLine = (ticket: Ticket): string => {
  const depth = { Epic: 0, Story: 1, "Sub-task": 2 }[ticket.type];
  const label =
    ticket.type === "Epic" ? "Epic" : `${ticket.type}: ${ticket.title}`;
  const parent = ticket.parent === null ? "" : ref(ticket.parent);
  return `${"  ".repeat(depth)}- ${standardLink(ticket)} — ${label} <!-- lisa:gw ref=${ref(ticket)} url=${url(ticket)} type=${ticket.type} parent=${parent} reqs=${ticket.reqs.join(",")} -->`;
};

/**
 * One requirement-coverage line in the standard form.
 * @param requirement Requirement to render.
 * @returns The line: full heading, verbatim text, a full link per ticket.
 */
const coverageLine = (requirement: Requirement): string => {
  const links = TICKETS.filter(ticket => ticket.reqs.includes(requirement.id))
    .map(standardLink)
    .join(", ");
  return `- **${requirement.id}** §"${requirement.heading}": "${requirement.text}" — ${links}`;
};

const STANDARD_SECTION = [
  "## Tickets",
  "",
  "_Generated by `lisa-prd-backlink`. Regenerated on every Plan run; do not edit by hand._",
  "",
  "### Requirement coverage",
  "",
  ...REQUIREMENTS.map(coverageLine),
  "",
  `### ${ref(EPIC)}: ${EPIC.title}`,
  "",
  entryLine(EPIC),
  ...STORIES.flatMap(story => [
    entryLine(story),
    ...SUBTASKS.filter(subtask => subtask.parent === story).map(entryLine),
  ]),
  "",
].join("\n");

/**
 * Build a PRD of a chosen size with the standard-form section in place.
 * @param sourceChars Length of the PRD itself, before the section.
 * @returns The PRD and the 60 requirements and 41 tickets behind it.
 */
export const buildPrd = (sourceChars: number): Prd => {
  const stated = [
    "# Product requirements",
    "",
    ...REQUIREMENTS.map(
      requirement => `### ${requirement.heading}\n\n${requirement.text}\n`
    ),
    "## Background",
    "",
  ].join("\n");
  const source = `${stated.padEnd(sourceChars - 1, "Background detail. ")}\n`;
  const trailer = "## Target Backend Environment\n\nNone — container.\n";
  return {
    source,
    standardBody: `${source}\n${STANDARD_SECTION}\n${trailer}`,
    requirements: REQUIREMENTS,
    tickets: TICKETS,
  };
};

/**
 * Every shipped copy of the skill: the source and each plugin projection.
 * @returns Repository-relative paths, source first.
 */
export const skillCopies = (): readonly string[] => [
  SOURCE_COPY,
  ...readdirSync("plugins", { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "src")
    .flatMap(entry => [
      `plugins/${entry.name}/${SKILL_PATH}`,
      `plugins/${entry.name}/.codex-plugin/${SKILL_PATH}`,
    ])
    .filter(copy => existsSync(copy)),
];

/**
 * Lift the fitting program verbatim out of one copy of the skill.
 * @param copy Repository-relative path of the skill document.
 * @returns The program text, exactly as it ships.
 */
export const liftProgram = (copy: string): string => {
  const match = /```js\n(\/\/ fit-backlink-body\.mjs\n[\s\S]*?\n)```/u.exec(
    readFileSync(copy, "utf8")
  );
  if (match?.[1] === undefined) {
    throw new Error(`${copy} carries no fit-backlink-body.mjs program`);
  }
  return match[1];
};

/** What one run of the fitting program produced. */
export interface FitRun {
  readonly status: number | null;
  /** The form it printed: standard, compact, comment or too-large. */
  readonly form: string;
  readonly stderr: string;
  /** The body it wrote, or null when it wrote none. */
  readonly body: string | null;
  /** The managed comment it wrote, or null when it wrote none. */
  readonly comment: string | null;
}

/**
 * Read a file the program may or may not have written.
 * @param file Absolute path.
 * @returns Its text, or null when absent.
 */
const readIfPresent = (file: string): string | null =>
  existsSync(file) ? readFileSync(file, "utf8") : null;

/**
 * Run the fitting program the way the skill says to: saved to a file, with
 * the body file, the PRD's repository and an output directory as arguments.
 * @param program Program text lifted from the skill.
 * @param body Full PRD body with the standard-form section in place.
 * @param commentUrl URL of the managed coverage comment, once it exists.
 * @param repo The PRD's repository, as `<owner>/<repo>`.
 * @returns The printed form and whatever files were written.
 */
export const runFit = (
  program: string,
  body: string,
  commentUrl?: string,
  repo: string = PRD_REPO
): FitRun => {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-backlink-fit-"));
  try {
    const programFile = path.join(root, "fit-backlink-body.mjs");
    const bodyFile = path.join(root, "standard-body.md");
    const outDir = path.join(root, "out");
    writeFileSync(programFile, program);
    writeFileSync(bodyFile, body);
    const outcome = boundedSpawnSync({
      label: "fit-backlink-body.mjs",
      command: process.execPath,
      args: [
        programFile,
        bodyFile,
        repo,
        outDir,
        ...(commentUrl === undefined ? [] : [commentUrl]),
      ],
    });
    return {
      status: outcome.status,
      form: outcome.stdout.trim(),
      stderr: outcome.stderr,
      body: readIfPresent(path.join(outDir, "body.md")),
      comment: readIfPresent(path.join(outDir, "coverage-comment.md")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
