/**
 * The `lisa-attest` skill and its `/lisa:attest` command: that they exist
 * for every coding agent, that the commands the skill runs are real, and
 * that its steps are complete (CodySwannGT/lisa#5001).
 *
 * The skill's guidance prose is not pinned here; rewording it must not fail
 * a test. What is checked is structural (the frontmatter, the command's
 * argument pass-through, the copy each agent is given, how each agent
 * invokes it, what each step needs and hands on) and executable (every `lisa
 * controls` subcommand it runs is registered, and each is one plain
 * command). What the skill promises about the verdict is in
 * `./attest-skill-verdict.test.ts`, and the commands themselves are run for
 * real by `tests/integration/controls-attest-skill.test.ts`.
 *
 * OpenCode has no entry below because Lisa builds no plugin folder for it: it
 * is given the same skill and command from `plugins/lisa` when Lisa is
 * installed for it, as `/lisa:attest`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTROLS_COMMAND } from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  attestSkill,
  attestSkillShellBlocks,
  attestSkillSteps,
  type AttestSkillRun,
} from "../../helpers/attest-skill.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SKILL = "skills/lisa-attest/SKILL.md";
const RUNS: readonly AttestSkillRun[] = ["attest", "before-enforce"];

/** Where the skill and command are authored, and where Claude Code reads them. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The copy each coding agent is given, by the folder the build writes it to. */
const AGENT_COPIES: readonly {
  readonly agent: string;
  readonly files: readonly string[];
}[] = [
  {
    agent: "Claude Code",
    files: [`plugins/lisa/${SKILL}`, "plugins/lisa/commands/attest.md"],
  },
  { agent: "Codex", files: [`plugins/lisa/.codex-plugin/${SKILL}`] },
  {
    agent: "Cursor",
    files: [
      `plugins/lisa-cursor/${SKILL}`,
      "plugins/lisa-cursor/commands/lisa/attest.md",
    ],
  },
  {
    agent: "Antigravity",
    files: [
      `plugins/lisa-agy/${SKILL}`,
      "plugins/lisa-agy/commands/lisa/attest.md",
    ],
  },
  {
    agent: "Copilot",
    files: [
      `plugins/lisa-copilot/${SKILL}`,
      "plugins/lisa-copilot/commands/lisa/attest.md",
    ],
  },
  { agent: "Devin", files: [`plugins/lisa-devin/${SKILL}`] },
];

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its content
 */
function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("lisa-attest skill and /lisa:attest command", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(`${root}/${SKILL}`);
    const command = read(`${root}/commands/attest.md`);

    it("is a skill named lisa-attest with a description and a body", () => {
      expect(skill).toMatch(/^---\nname: lisa-attest\n/u);
      expect(skill).toMatch(/^description: /mu);
      expect(skill.length).toBeGreaterThan(2000);
    });

    it("is surfaced by a command that passes its arguments through", () => {
      expect(command).toMatch(/^argument-hint: /mu);
      expect(command).toContain("/lisa-attest");
      expect(command).toContain("$ARGUMENTS");
    });
  });

  it.each(AGENT_COPIES)("is built for $agent", ({ files }) => {
    expect(
      files.filter(file => !existsSync(path.join(REPO_ROOT, file)))
    ).toEqual([]);
  });

  it("gives every agent the skill as authored", () => {
    const authored = read(`plugins/src/base/${SKILL}`);
    const body = authored.slice(authored.indexOf("\n# "));
    const copies = AGENT_COPIES.flatMap(({ files }) =>
      files.filter(file => file.endsWith("SKILL.md"))
    );

    expect(copies.filter(file => !read(file).endsWith(body))).toEqual([]);
  });

  it.each([
    ["an agent with slash commands", "`/lisa:attest`"],
    ["Codex", "`$lisa-attest`"],
    ["Devin", "`/lisa:lisa-attest`"],
  ])("says how %s runs it", (_agent, form) => {
    expect(attestSkill()).toContain(form);
  });
});

describe.each(RUNS)("the steps of the %s run", run => {
  const steps = attestSkillSteps(run);

  it("are numbered from 1 with none missing", () => {
    expect(steps.map(step => step.number)).toEqual(
      steps.map((_step, index) => index + 1)
    );
    expect(steps.length).toBeGreaterThan(3);
  });

  it("each say what they need and what they hand on", () => {
    expect(
      steps
        .filter(
          step =>
            !step.body.includes("**Needs:**") ||
            !step.body.includes("**Hands on:**")
        )
        .map(step => step.title)
    ).toEqual([]);
  });
});

describe("the commands the attest skill runs", () => {
  const blocks = RUNS.flatMap(run => attestSkillShellBlocks(run));

  it("are lisa controls subcommands the CLI registers", () => {
    const registered = (
      createProgram().commands.find(
        command => command.name() === CONTROLS_COMMAND
      )?.commands ?? []
    ).map(command => command.name());
    const run = blocks.flatMap(block =>
      [...block.matchAll(/\blisa controls ([a-z][a-z-]*)/gu)].map(
        match => match[1] ?? ""
      )
    );

    expect(run).toEqual(
      expect.arrayContaining(["attest", "reconcile", "report-check"])
    );
    expect(run.filter(name => !registered.includes(name))).toEqual([]);
  });

  it("pass only options the attest command really has", () => {
    const known = (
      createProgram()
        .commands.find(command => command.name() === CONTROLS_COMMAND)
        ?.commands.find(command => command.name() === "attest")?.options ?? []
    ).map(option => option.long);
    const passed = blocks
      .filter(block => block.includes("lisa controls attest"))
      .flatMap(block => block.match(/--[a-z][a-z-]*/gu) ?? []);

    expect(passed.length).toBeGreaterThan(0);
    expect(passed.filter(option => !known.includes(option))).toEqual([]);
  });

  it("are each one plain command, with nothing an agent's shell guard refuses", () => {
    expect(
      blocks.filter(
        block => block.trim().includes("\n") || /[;{}|&]|\$\(|`/u.test(block)
      )
    ).toEqual([]);
  });

  it("run the proofs, then the comparison, then the check, in that order", () => {
    const run = attestSkillShellBlocks("attest").map(block => block.trim());
    const order = [
      "lisa controls attest --json",
      "lisa controls reconcile",
      "lisa controls attest --check",
    ].map(command => run.indexOf(command));

    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("keep the before-enforce command out of the attest run, and the proofs out of the before-enforce run", () => {
    const beforeEnforce = attestSkillShellBlocks("before-enforce");

    expect(
      attestSkillShellBlocks("attest").filter(block =>
        block.includes("--before-enforce")
      )
    ).toEqual([]);
    expect(
      beforeEnforce.filter(
        block =>
          block.includes("lisa controls attest") &&
          !block.includes("--before-enforce")
      )
    ).toEqual([]);
    expect(beforeEnforce.map(block => block.trim())).toContain(
      "lisa controls attest --before-enforce --json"
    );
  });
});
