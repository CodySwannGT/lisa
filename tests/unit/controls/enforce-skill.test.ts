/**
 * The `lisa-enforce` skill and its `/lisa:enforce` command: that they exist
 * for every coding agent, that the commands the skill runs are real and run
 * in the order the commands themselves require, and that the skill never has
 * the agent change merge settings by itself.
 *
 * The skill's guidance prose is not pinned here; rewording it must not fail a
 * test. What is checked is structural (the frontmatter, the command's
 * argument pass-through, the copy each agent is given, how each agent invokes
 * it, what each step needs and hands on) and executable (every `lisa
 * controls` subcommand it runs is registered, and the ticket results it
 * teaches are ones the report command accepts). The commands themselves are
 * run for real by `tests/integration/controls-enforce.test.ts`
 * (CodySwannGT/lisa#4994).
 *
 * OpenCode has no entry below because Lisa builds no plugin folder for it: it
 * is given the same skill and command from `plugins/lisa` when Lisa is
 * installed for it, as `/lisa:enforce`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTROLS_COMMAND } from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import { ticketsProblems } from "../../../src/controls/enforce-input-rules.js";
import { ENFORCE_OUTCOMES } from "../../../src/controls/enforce-types.js";
import {
  enforceSkill,
  enforceSkillShellBlocks,
  enforceSkillTicketExamples,
} from "../../helpers/enforce-skill.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REPORT_COMMAND = "lisa controls enforce-report";
const SKILL = "skills/lisa-enforce/SKILL.md";
const REFERENCES = [
  "skills/lisa-enforce/references/missing-capability-tickets.md",
  "skills/lisa-enforce/references/pull-request-executor.md",
];

/** Where the skill and command are authored, and where Claude Code reads them. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The copy each coding agent is given, by the folder the build writes it to. */
const AGENT_COPIES: readonly {
  readonly agent: string;
  readonly files: readonly string[];
}[] = [
  {
    agent: "Claude Code",
    files: [`plugins/lisa/${SKILL}`, "plugins/lisa/commands/enforce.md"],
  },
  { agent: "Codex", files: [`plugins/lisa/.codex-plugin/${SKILL}`] },
  {
    agent: "Cursor",
    files: [
      `plugins/lisa-cursor/${SKILL}`,
      "plugins/lisa-cursor/commands/lisa/enforce.md",
    ],
  },
  {
    agent: "Antigravity",
    files: [
      `plugins/lisa-agy/${SKILL}`,
      "plugins/lisa-agy/commands/lisa/enforce.md",
    ],
  },
  {
    agent: "Copilot",
    files: [
      `plugins/lisa-copilot/${SKILL}`,
      "plugins/lisa-copilot/commands/lisa/enforce.md",
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

/**
 * The numbered steps of the skill, each with its own text.
 * @returns One entry per `### Step` heading, in order
 */
function steps(): readonly { readonly title: string; readonly body: string }[] {
  return enforceSkill()
    .split(/^### /mu)
    .slice(1)
    .map(section => ({
      title: section.slice(0, section.indexOf("\n")),
      body: section.slice(section.indexOf("\n")),
    }));
}

/**
 * Where a command first appears among the skill's shell blocks.
 * @param command - Text the block contains
 * @returns The block's position, or -1 when no block runs it
 */
function positionOf(command: string): number {
  return enforceSkillShellBlocks().findIndex(block => block.includes(command));
}

describe("lisa-enforce skill and /lisa:enforce command", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(`${root}/${SKILL}`);
    const command = read(`${root}/commands/enforce.md`);

    it("is a skill named lisa-enforce with a description and a body", () => {
      expect(skill).toMatch(/^---\nname: lisa-enforce\n/u);
      expect(skill).toMatch(/^description: /mu);
      expect(skill.length).toBeGreaterThan(2000);
    });

    it("is surfaced by a command that passes its arguments through", () => {
      expect(command).toMatch(/^argument-hint: /mu);
      expect(command).toContain("/lisa-enforce");
      expect(command).toContain("$ARGUMENTS");
    });

    it("comes with the two flows it tells the agent to follow", () => {
      expect(
        REFERENCES.filter(
          file =>
            !existsSync(path.join(REPO_ROOT, root, file)) ||
            !skill.includes(file.slice(file.indexOf("references/")))
        )
      ).toEqual([]);
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
    ["an agent with slash commands", "`/lisa:enforce`"],
    ["Codex", "`$lisa-enforce`"],
    ["Devin", "`/lisa:lisa-enforce`"],
  ])("says how %s runs it", (_agent, form) => {
    expect(enforceSkill()).toContain(form);
  });
});

describe("the steps of the enforce skill", () => {
  it("are numbered from 1 with none missing", () => {
    expect(
      steps().map(step => Number(/^Step (\d+):/u.exec(step.title)?.[1]))
    ).toEqual(steps().map((_step, index) => index + 1));
    expect(steps().length).toBeGreaterThan(5);
  });

  it("each say what they need and what they hand on", () => {
    expect(
      steps()
        .filter(
          step =>
            !step.body.includes("**Needs:**") ||
            !step.body.includes("**Hands on:**")
        )
        .map(step => step.title)
    ).toEqual([]);
  });
});

describe("the commands the enforce skill runs", () => {
  it("are lisa controls subcommands the CLI registers", () => {
    const registered = (
      createProgram().commands.find(
        command => command.name() === CONTROLS_COMMAND
      )?.commands ?? []
    ).map(command => command.name());
    const run = enforceSkillShellBlocks().flatMap(block =>
      [...block.matchAll(/\blisa controls ([a-z][a-z-]*)/gu)].map(
        match => match[1] ?? ""
      )
    );

    expect(run).toEqual(
      expect.arrayContaining([
        "gaps",
        "declaration-check",
        "install-carriers",
        "register",
        "protect",
        "enforce-report",
      ])
    );
    expect(run.filter(name => !registered.includes(name))).toEqual([]);
  });

  it("installs the carriers before the register is written, and reports last", () => {
    const order = [
      "lisa controls gaps",
      "lisa controls declaration-check",
      "lisa controls install-carriers --agents",
      "lisa controls register",
      "lisa controls register --check",
      "lisa controls protect",
      REPORT_COMMAND,
    ].map(command => positionOf(command));

    expect(order.filter(position => position < 0)).toEqual([]);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("never changes merge settings by itself", () => {
    expect(
      enforceSkillShellBlocks().filter(block => block.includes("--apply"))
    ).toEqual([]);
    expect(enforceSkill()).toContain("You never add `--apply` yourself");
  });

  it("hands each result to the report through a file in the results folder", () => {
    const report = enforceSkillShellBlocks().find(block =>
      block.includes(REPORT_COMMAND)
    );

    expect(
      ["carriers", "tickets", "protect"].filter(
        result =>
          report?.includes(`--${result} "<results folder>/${result}.json"`) !==
          true
      )
    ).toEqual([]);
  });

  it("are each one plain command, with nothing an agent's shell guard refuses", () => {
    expect(
      enforceSkillShellBlocks().filter(
        block => block.trim().includes("\n") || /[;|&]|\$\(|`/u.test(block)
      )
    ).toEqual([]);
  });
});

describe("what the enforce skill notes before it changes anything", () => {
  const LISTING = "git status --porcelain --untracked-files=all";

  it("lists the working tree before the first command that writes, and again at the end", () => {
    const listings = enforceSkillShellBlocks().flatMap((block, index) =>
      block.trim() === LISTING ? [index] : []
    );

    expect(listings).toHaveLength(2);
    expect(listings[0]).toBeLessThan(
      positionOf("lisa controls install-carriers --agents")
    );
    expect(listings[1]).toBeGreaterThan(positionOf(REPORT_COMMAND));
  });

  it("makes that first list in the preflight, and has the closing check read it", () => {
    const [preflight] = steps();
    const confirm = steps().find(step => step.body.includes("rm -r"));

    expect(preflight?.body).toContain(LISTING);
    expect(preflight?.body).toMatch(/already\s+changed\s+before\s+this\s+run/u);
    expect(confirm?.body).toMatch(/the\s+list\s+step\s+1\s+kept/u);
  });
});

describe("what the enforce skill teaches the agent to say and write", () => {
  it("says how the runner read each failing check, and that an unproved one is not known either way", () => {
    const skill = enforceSkill();

    expect(skill).toContain("`judged`");
    expect(skill).toContain("`unproved`");
    expect(skill).toMatch(
      /cannot\s+tell\s+a\s+broken\s+rule\s+from\s+a\s+command\s+that\s+could\s+not\s+run/u
    );
    // An unproved check can be one the code really fails, so the skill may
    // not call it a result that says nothing about the code.
    expect(skill).not.toMatch(/not\s+a\s+statement\s+about\s+the\s+code/u);
  });

  it("does not let a run that measured nothing be told as nothing failing", () => {
    const skill = enforceSkill();

    expect(skill).toContain("`checked`");
    expect(skill).toMatch(/never\s+say\s+that\s+nothing\s+fails/u);
  });

  it("does not offer the output of a check run as the carriers result", () => {
    expect(enforceSkill()).toMatch(
      /refuses\s+the\s+result\s+of\s+a\s+`--check`\s+run/u
    );
  });

  it("names every outcome the report can give", () => {
    expect(
      ENFORCE_OUTCOMES.filter(
        outcome => !enforceSkill().includes(`\`${outcome}\``)
      )
    ).toEqual([]);
  });

  it("shows ticket results the report command accepts", () => {
    const examples = enforceSkillTicketExamples();

    expect(examples.length).toBeGreaterThan(0);
    expect(
      examples.flatMap(example => ticketsProblems(example, "The example"))
    ).toEqual([]);
  });
});
