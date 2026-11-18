/**
 * The README and the wiki describe the four control commands (audit,
 * configure, enforce, attest). This holds what they say to the code they
 * describe (CodySwannGT/lisa#5003).
 *
 * The guidance prose is reviewed, not pinned: rewording it must not fail a
 * test (#4867). What is checked is derived from the things the documents
 * describe, so a document that falls behind the code fails here:
 *
 * - the way to start each command on each coding agent comes from the parity
 *   record the plugin build is held to;
 * - the files each command leaves behind are the constants the commands write
 *   to;
 * - every `lisa controls` subcommand and option a document names is one the
 *   CLI registers;
 * - the wiki page exists, every link in it leads somewhere, and the wiki's
 *   index and log both lead to it.
 * @module tests/unit/docs/control-audit-docs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTROL_COMMANDS,
  PARITY_FIXTURE,
} from "../../../scripts/lib/control-command-parity.mjs";
import {
  CATALOGUE_PATH,
  QUESTIONNAIRE_PATH,
} from "../../../scripts/generate-readiness-questionnaire.mjs";
import { CONTROLS_COMMAND } from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
} from "../../../src/controls/audit-report-types.js";
import { CARRIER_RECORD_PATH } from "../../../src/controls/carrier-types.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { GATES_DECLARATION_PATH } from "../../../src/controls/gates-declaration.js";
import { PROOF_FOLDER } from "../../../src/controls/proof-patch.js";
import { MERGE_PROTECTION_CHANGE_PATH } from "../../../src/controls/protect-types.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { VERDICT_PATH } from "../../../src/controls/verdict-types.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The wiki page, from the repository root. */
const WIKI_PAGE = "wiki/documentation/workflows/control-audit.md";

/** The wiki page that describes the specification the verdict is measured against. */
const SPECIFICATION_PAGE = "wiki/concepts/tasc-specification.md";

/** What each command leaves behind, in the order the commands are run. */
const WRITTEN_PATHS: readonly string[] = [
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  GATES_DECLARATION_PATH,
  CONTROL_REGISTER_PATH,
  PROOF_FOLDER,
  CARRIER_RECORD_PATH,
  MERGE_PROTECTION_CHANGE_PATH,
  EVIDENCE_PATH,
  VERDICT_PATH,
];

/** One coding agent of the parity record: its name and how a command is started on it. */
interface ParityAgent {
  readonly name: string;
  readonly invocation: string;
}

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its content
 */
function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * The agents of the parity record.
 * @returns Each agent's name and invocation template
 */
function parityAgents(): readonly ParityAgent[] {
  const record = JSON.parse(read(PARITY_FIXTURE)) as {
    readonly agents: readonly ParityAgent[];
  };
  return record.agents;
}

/**
 * How one command is started on one agent.
 * @param agent - The agent
 * @param command - The command, as the parity record names it
 * @returns What the operator types
 */
function invocationOf(agent: ParityAgent, command: string): string {
  return agent.invocation.replace("{command}", command);
}

/**
 * The one README section that is about the four commands: the second-level
 * section that says how to start the first of them.
 * @returns The sections that qualify
 */
function readmeSections(): readonly string[] {
  const first = `/lisa:${CONTROL_COMMANDS[0] ?? ""}`;
  return read("README.md")
    .split(/^## /mu)
    .filter(section => section.includes(first));
}

/**
 * The options each `lisa controls` subcommand registers, by subcommand name.
 * @returns Subcommand name to its long option names
 */
function registeredOptions(): ReadonlyMap<string, readonly string[]> {
  const group = createProgram().commands.find(
    command => command.name() === CONTROLS_COMMAND
  );
  return new Map(
    (group?.commands ?? []).map(command => [
      command.name(),
      ["--help", ...command.options.flatMap(option => option.long ?? [])],
    ])
  );
}

/**
 * Every `lisa controls` call a document names, up to the end of its code
 * span or line.
 * @param text - The document
 * @returns Each call's subcommand and the options written after it
 */
function controlCalls(
  text: string
): readonly { readonly name: string; readonly flags: readonly string[] }[] {
  return [...text.matchAll(/\blisa controls ([a-z][a-z-]*)([^`\n]*)/gu)].map(
    match => ({
      name: match[1] ?? "",
      flags: [...(match[2] ?? "").matchAll(/--[a-z][a-z-]*/gu)].map(
        flag => flag[0]
      ),
    })
  );
}

/**
 * The calls a document names that the CLI does not have: an unregistered
 * subcommand, or an option that subcommand does not take.
 * @param text - The document
 * @returns One line per call the CLI would refuse
 */
function unknownCalls(text: string): readonly string[] {
  const registered = registeredOptions();
  return controlCalls(text).flatMap(({ name, flags }) => {
    const options = registered.get(name);
    if (options === undefined) return [`lisa controls ${name}`];
    return flags
      .filter(flag => !options.includes(flag))
      .map(flag => `lisa controls ${name} ${flag}`);
  });
}

/**
 * The relative links of a Markdown document that lead nowhere.
 * @param relative - The document, from the repository root
 * @returns Each link target that does not exist
 */
function deadLinks(relative: string): readonly string[] {
  const folder = path.dirname(path.join(REPO_ROOT, relative));
  return [...read(relative).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)]
    .map(match => match[1] ?? "")
    .filter(target => !/^[a-z]+:/u.test(target))
    .filter(target => !existsSync(path.resolve(folder, target)));
}

describe("the README section on the four control commands", () => {
  it("is one section", () => {
    expect(readmeSections()).toHaveLength(1);
  });

  it("names the four commands in the order they are run", () => {
    const [section = ""] = readmeSections();
    const positions = CONTROL_COMMANDS.map(command =>
      section.indexOf(`/lisa:${command}`)
    );

    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("says how to start each command on every coding agent", () => {
    const [section = ""] = readmeSections();
    const missing = parityAgents().flatMap(agent =>
      [
        agent.name,
        ...CONTROL_COMMANDS.map(command => invocationOf(agent, command)),
      ].filter(expected => !section.includes(expected))
    );

    expect(parityAgents()).toHaveLength(7);
    expect(missing).toEqual([]);
  });

  it("names every file the commands leave behind", () => {
    const [section = ""] = readmeSections();

    expect(WRITTEN_PATHS.filter(file => !section.includes(file))).toEqual([]);
  });

  it("names only lisa controls subcommands and options the CLI registers", () => {
    const [section = ""] = readmeSections();

    expect(controlCalls(section).length).toBeGreaterThan(0);
    expect(unknownCalls(section)).toEqual([]);
  });

  it("leads to the wiki page", () => {
    const [section = ""] = readmeSections();

    expect(section).toContain(`(${WIKI_PAGE})`);
  });
});

describe("the wiki page on the four control commands", () => {
  it("exists, and every link in it leads somewhere", () => {
    expect(existsSync(path.join(REPO_ROOT, WIKI_PAGE))).toBe(true);
    expect(deadLinks(WIKI_PAGE)).toEqual([]);
  });

  it("names every file the commands leave behind", () => {
    const page = read(WIKI_PAGE);

    expect(WRITTEN_PATHS.filter(file => !page.includes(file))).toEqual([]);
  });

  it("says how to start each command on every coding agent", () => {
    const page = read(WIKI_PAGE);
    const missing = parityAgents().flatMap(agent =>
      CONTROL_COMMANDS.map(command => invocationOf(agent, command)).filter(
        expected => !page.includes(expected)
      )
    );

    expect(missing).toEqual([]);
  });

  it("names only lisa controls subcommands and options the CLI registers", () => {
    const page = read(WIKI_PAGE);

    expect(controlCalls(page).length).toBeGreaterThan(0);
    expect(unknownCalls(page)).toEqual([]);
  });

  it("is reached from the wiki index, the wiki log and the documentation index", () => {
    const page = path.relative("wiki", WIKI_PAGE);

    expect(read("wiki/index.md")).toContain(`(${page})`);
    expect(read("wiki/log.md")).toContain(WIKI_PAGE);
    expect(read("wiki/documentation/index.md")).toContain(
      `(${path.relative("wiki/documentation", WIKI_PAGE)})`
    );
  });
});

describe("the wiki page on the specification", () => {
  it("points at the criterion catalogue and the questionnaire generated from it", () => {
    const page = read(SPECIFICATION_PAGE);

    expect(existsSync(path.join(REPO_ROOT, CATALOGUE_PATH))).toBe(true);
    expect(page).toContain(CATALOGUE_PATH);
    expect(page).toContain(QUESTIONNAIRE_PATH);
    expect(deadLinks(SPECIFICATION_PAGE)).toEqual([]);
  });
});
